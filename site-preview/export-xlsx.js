// Browser-generated workbook: numeric cells stay numeric, names/codes stay text.
export async function createExportWorkbook(ExcelJS, { rows, columns }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '藥庫調藥 · 月結算觀測';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('月別調藥明細', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((name) => ({ header: name === '調撥月份' ? '月份' : name, key: name, width: name === '藥品名稱' ? 48 : name === '藥品代碼' ? 16 : 20 }));
  for (const record of rows) {
    sheet.addRow(columns.map((name) => name === '調撥月份' ? `${String(record[name]).slice(0, 4)}/${String(record[name]).slice(4)}` : record[name]));
  }
  sheet.autoFilter = { from: 'A1', to: { row: rows.length + 1, column: columns.length } };
  sheet.eachRow((row, number) => {
    row.font = { name: 'Microsoft JhengHei', size: 11 };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = number === 1 ? 32 : 30;
    if (number === 1) {
      row.font = { name: 'Microsoft JhengHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B96' } };
    } else if (number % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FA' } };
  });
  columns.forEach((name, index) => { if (!['調撥月份', '藥品名稱', '藥品代碼'].includes(name)) sheet.getColumn(index + 1).numFmt = '#,##0'; });
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return workbook.xlsx.writeBuffer();
}
