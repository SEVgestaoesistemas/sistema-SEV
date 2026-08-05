import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNfeXml } from '../../src/finance/nfe-xml.js';

const validNfeXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe35160812345678000190550010000001231000001234" versao="4.00">
      <ide><nNF>123</nNF><dhEmi>2026-08-05T10:30:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor XML Ltda</xNome></emit>
      <det nItem="1"><prod><cProd>A-01</cProd><xProd>Produto de teste</xProd><qCom>2.0000</qCom><uCom>UN</uCom><vUnCom>50.0000</vUnCom><vProd>100.00</vProd></prod></det>
      <det nItem="2"><prod><cProd>B-02</cProd><xProd>Segundo produto</xProd><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>25.5000</vUnCom><vProd>25.50</vProd></prod></det>
      <total><ICMSTot><vNF>125.50</vNF></ICMSTot></total>
      <cobr><dup><dVenc>2026-08-20</dVenc></dup></cobr>
    </infNFe>
  </NFe>
</nfeProc>`;

test('extracts supplier, total, dates and items from a valid NF-e XML', () => {
  const invoice = parseNfeXml(validNfeXml);

  assert.equal(invoice.supplierName, 'Fornecedor XML Ltda');
  assert.equal(invoice.supplierCnpj, '12345678000190');
  assert.equal(invoice.documentNumber, '123');
  assert.equal(invoice.documentKey, '35160812345678000190550010000001231000001234');
  assert.equal(invoice.issueDate, '2026-08-05');
  assert.equal(invoice.dueDate, '2026-08-20');
  assert.equal(invoice.amountCents, 12550);
  assert.equal(invoice.items.length, 2);
  assert.deepEqual(invoice.items[0], {
    code: 'A-01',
    description: 'Produto de teste',
    quantity: '2.0000',
    unit: 'UN',
    unitPrice: '50.0000',
    totalCents: 10000
  });
});

test('rejects malformed, unsafe and unrecognized XML clearly', () => {
  assert.throws(
    () => parseNfeXml('<nfeProc><NFe></nfeProc>'),
    error => error.code === 'NFE_XML_INVALID'
  );
  assert.throws(
    () => parseNfeXml('<!DOCTYPE note [<!ENTITY secret "blocked">]><note>&secret;</note>'),
    error => error.code === 'NFE_XML_UNSAFE'
  );
  assert.throws(
    () => parseNfeXml('<invoice><supplier>Não é NF-e</supplier></invoice>'),
    error => error.code === 'NFE_XML_UNRECOGNIZED'
  );
});
