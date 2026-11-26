const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ExcelJS = require('../vendor/exceljs.min.js');

test('XLSX preserves only the detail sheet with all rows, types and spreadsheet structure', async () => {
  const { createExportWorkbook } = await import(pathToFileURL(path.join(__dirname, '../export-xlsx.js')).href);
  const columns = ['調撥月份', '藥品名稱', '藥品代碼', '從藥庫調藥次數', '基準量', '安全量', '住院用量', '出院帶藥用量'];
  const rows = Array.from({ length: 31 }, (_, n) => ({ 調撥月份: 202610, 藥品名稱: n === 0 ? '=1+1' : `測試藥品 ${n}`, 藥品代碼: `000${n}`, 從藥庫調藥次數: 1, 基準量: 0, 安全量: 10, 住院用量: -n, 出院帶藥用量: n }));
  const buffer = await createExportWorkbook(ExcelJS, { rows, columns, filters: { start: 202610, end: 202610, minimum: 1, maximum: 10 }, category: '全部符合紀錄', selectedNames: [], sortLabel: '調撥月份 升冪' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ['月別調藥明細']);
  const sheet = workbook.getWorksheet('月別調藥明細');
  assert.equal(sheet.rowCount, 32, 'all 31 records, not only one page of 25');
  assert.equal(sheet.getCell('A2').value, '2026/10');
  assert.equal(sheet.getCell('B2').value, '=1+1', 'drug names must not become formulas');
  assert.equal(sheet.getCell('C2').value, '0000', 'leading zeros in identifiers remain text');
  assert.equal(sheet.getCell('G32').value, -30);
  assert.equal(typeof sheet.getCell('D2').value, 'number');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.getColumn(4).numFmt, '#,##0');
  assert.equal(workbook.worksheets.length, 1);
});
