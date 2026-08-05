import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError } from '../errors.js';

const maximumXmlCharacters = 1500000;
const maximumItems = 250;
const maximumCents = 1000000000000n;

const xmlError = (message, code = 'NFE_XML_UNRECOGNIZED') => new AppError(message, {
  statusCode: 400,
  code
});

const asArray = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const compactText = (value, maximum = 240) => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
  : '';

const validDate = value => {
  const date = compactText(value, 32).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month - 1
    && normalized.getUTCDate() === day
    ? date
    : null;
};

const decimalToCents = value => {
  const normalized = compactText(value, 32);
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt(`${match[2] || ''}00`.slice(0, 2));
  if (cents < 1n || cents > maximumCents) return null;
  return Number(cents);
};

const optionalQuantity = value => {
  const quantity = compactText(value, 32);
  return /^\d+(?:\.\d{1,4})?$/.test(quantity) ? quantity : null;
};

const safeDocumentKey = value => {
  const digits = compactText(value, 80).replace(/^NFe/i, '').replace(/\D/g, '');
  return digits.length === 44 ? digits : null;
};

const buildDescription = (documentNumber, items) => {
  const names = items.slice(0, 3).map(item => item.description).join(', ');
  const suffix = items.length > 3 ? ` e mais ${items.length - 3} item(ns)` : '';
  return compactText(`NF-e ${documentNumber}: ${names}${suffix}`, 240);
};

export const parseNfeXml = xmlContent => {
  if (typeof xmlContent !== 'string' || !xmlContent.trim()) {
    throw xmlError('Envie um arquivo XML de NF-e válido.', 'NFE_XML_INVALID');
  }
  if (xmlContent.length > maximumXmlCharacters) {
    throw xmlError('O XML excede o limite de 1,5 MB para leitura segura.', 'NFE_XML_TOO_LARGE');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlContent)) {
    throw xmlError('O XML contém declarações não permitidas para leitura segura.', 'NFE_XML_UNSAFE');
  }

  const validation = XMLValidator.validate(xmlContent);
  if (validation !== true) {
    throw xmlError('O arquivo XML está inválido ou incompleto.', 'NFE_XML_INVALID');
  }

  let parsed;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      trimValues: true,
      processEntities: false,
      removeNSPrefix: true
    }).parse(xmlContent);
  } catch {
    throw xmlError('Não foi possível interpretar o arquivo XML.', 'NFE_XML_INVALID');
  }

  const nfe = parsed?.nfeProc?.NFe || parsed?.NFe;
  const infNfe = nfe?.infNFe;
  const ide = infNfe?.ide;
  const issuer = infNfe?.emit;
  const total = infNfe?.total?.ICMSTot;
  if (!infNfe || !ide || !issuer || !total) {
    throw xmlError('O XML não corresponde a uma NF-e reconhecida.');
  }

  const supplierName = compactText(issuer.xNome, 140);
  const documentNumber = compactText(ide.nNF, 60);
  const issueDate = validDate(ide.dhEmi || ide.dEmi);
  const amountCents = decimalToCents(total.vNF);
  if (supplierName.length < 3 || !documentNumber || !issueDate || !amountCents) {
    throw xmlError('A NF-e não possui fornecedor, número, data de emissão ou valor total válidos.');
  }

  const rawItems = asArray(infNfe.det);
  if (!rawItems.length || rawItems.length > maximumItems) {
    throw xmlError('A NF-e precisa possuir entre 1 e 250 itens válidos.');
  }
  const items = rawItems.map((detail, index) => {
    const product = detail?.prod;
    const description = compactText(product?.xProd, 160);
    const totalCents = decimalToCents(product?.vProd);
    if (description.length < 1 || !totalCents) {
      throw xmlError(`O item ${index + 1} da NF-e está inválido.`);
    }
    return {
      code: compactText(product?.cProd, 60) || null,
      description,
      quantity: optionalQuantity(product?.qCom),
      unit: compactText(product?.uCom, 12) || null,
      unitPrice: compactText(product?.vUnCom, 32) || null,
      totalCents
    };
  });

  const duplicate = asArray(infNfe?.cobr?.dup)[0];
  const issuerCnpj = compactText(issuer.CNPJ, 20).replace(/\D/g, '');
  return {
    supplierName,
    supplierCnpj: issuerCnpj.length === 14 ? issuerCnpj : null,
    documentNumber,
    documentKey: safeDocumentKey(infNfe['@_Id']),
    issueDate,
    dueDate: validDate(duplicate?.dVenc),
    amountCents,
    category: 'Fornecedores',
    description: buildDescription(documentNumber, items),
    items
  };
};
