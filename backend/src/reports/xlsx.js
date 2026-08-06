import ExcelJS from '@excel.js/exceljs';

const colors = {
  navy: 'FF123B5D',
  blue: 'FF1F5E8C',
  headerText: 'FFFFFFFF',
  metaText: 'FF4B6478',
  border: 'FFD9E2EA',
  stripe: 'FFF5F9FC'
};

const currencyFormat = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const integerFormat = '#,##0;[Red]-#,##0';
const formatByType = {
  currency: currencyFormat,
  integer: integerFormat,
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm'
};

const columnLetter = index => {
  let current = index;
  let letter = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    current = Math.floor((current - 1) / 26);
  }
  return letter;
};

const periodLabel = period => {
  if (period.startDate && period.endDate) return `Período: ${period.startDate} a ${period.endDate}`;
  if (period.startDate) return `Período: a partir de ${period.startDate}`;
  if (period.endDate) return `Período: até ${period.endDate}`;
  return 'Período: todos os registros';
};

const displayValue = (value, type) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const date = value.toLocaleDateString('pt-BR');
    return type === 'datetime'
      ? `${date} ${value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      : date;
  }
  if (type === 'currency') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return String(value);
};

const columnWidth = (column, rows, index) => {
  const largest = Math.max(
    column.header.length,
    ...rows.map(row => displayValue(row[index], column.type).length)
  );
  return Math.min(column.maxWidth || 42, Math.max(column.minWidth || 11, largest + 2));
};

const rowHeight = (row, columns) => {
  const wrappedLines = columns.reduce((largest, column, index) => {
    if (!column.wrapText) return largest;
    const width = column.width || 11;
    return Math.max(largest, Math.ceil(displayValue(row[index], column.type).length / width));
  }, 1);
  return Math.min(72, Math.max(20, wrappedLines * 15));
};

export const createXlsxReport = async ({ title, sheetName, columns, rows, period }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SEV Gestão & Sistemas';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    properties: { tabColor: { argb: colors.blue } },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  const lastColumn = columnLetter(columns.length);

  worksheet.mergeCells(`A1:${lastColumn}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `SEV Gestão & Sistemas — ${title}`;
  titleCell.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: colors.headerText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells(`A2:${lastColumn}2`);
  const metaCell = worksheet.getCell('A2');
  metaCell.value = `${periodLabel(period)} • Gerado em ${new Date().toLocaleString('pt-BR')}`;
  metaCell.font = { name: 'Aptos', size: 10, color: { argb: colors.metaText } };
  metaCell.alignment = { horizontal: 'left', vertical: 'middle' };
  worksheet.getRow(2).height = 20;

  const headerRow = worksheet.getRow(4);
  headerRow.values = columns.map(column => column.header);
  headerRow.height = 25;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.blue } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: colors.navy } },
      right: { style: 'thin', color: { argb: colors.border } }
    };
  });

  columns.forEach((column, index) => {
    const worksheetColumn = worksheet.getColumn(index + 1);
    column.width = columnWidth(column, rows, index);
    worksheetColumn.width = column.width;
    worksheetColumn.alignment = {
      horizontal: ['currency', 'integer'].includes(column.type) ? 'right' : 'left',
      vertical: 'top',
      wrapText: Boolean(column.wrapText)
    };
    if (formatByType[column.type]) worksheetColumn.numFmt = formatByType[column.type];
  });

  rows.forEach((values, rowIndex) => {
    const row = worksheet.addRow(values);
    row.height = rowHeight(values, columns);
    row.eachCell({ includeEmpty: true }, (cell, cellIndex) => {
      if (rowIndex % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.stripe } };
      }
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1F2933' } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: colors.border } },
        right: { style: 'thin', color: { argb: 'FFE8EFF5' } }
      };
      const column = columns[cellIndex - 1];
      if (formatByType[column.type]) cell.numFmt = formatByType[column.type];
    });
  });

  worksheet.autoFilter = `A4:${lastColumn}${Math.max(4, rows.length + 4)}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
