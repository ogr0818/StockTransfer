/* SQLite runs off the UI thread. The source database is opened in memory only. */
importScripts('vendor/sql-wasm.js');
let db;
let products;
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'variant' });
const key = (row) => JSON.stringify([row['藥品名稱'], row['藥品代碼']]);
const byName = (a, b) => collator.compare(a['藥品名稱'], b['藥品名稱']) || collator.compare(a['藥品代碼'], b['藥品代碼']);
function query(sql, values = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(values);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally { statement.free(); }
}
onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
      const response = await fetch('stock_transfer.db', { cache: 'no-store' });
      if (!response.ok) throw new Error(`無法讀取資料庫（HTTP ${response.status}）`);
      db = new SQL.Database(new Uint8Array(await response.arrayBuffer()));
      db.run('PRAGMA query_only=ON');
      const history = query('SELECT month, imported_rows, imported_at FROM import_history ORDER BY month');
      products = query('SELECT DISTINCT 藥品名稱, 藥品代碼 FROM stock_transfer').sort(byName).map((p) => ({ ...p, key: key(p) }));
      postMessage({ type: 'ready', history, products });
    } else if (data.type === 'query') {
      const { start, end, minimum, maximum, selected } = data.filters;
      if (![start, end, minimum, maximum].every(Number.isInteger) || start > end || minimum < 1 || maximum > 50 || minimum > maximum) throw new Error('請檢查月份與次數上下限。');
      const selection = new Set(selected);
      // Every calculation starts from the SAME filtered monthly records.
      const rows = query('SELECT 調撥月份, 藥品名稱, 藥品代碼, 從藥庫調藥次數, 基準量, 安全量, 住院用量, 出院帶藥用量 FROM stock_transfer WHERE 調撥月份 BETWEEN ? AND ? AND 從藥庫調藥次數 BETWEEN ? AND ? ORDER BY 調撥月份, 藥品名稱, 藥品代碼', [start, end, minimum, maximum]).filter((row) => !selection.size || selection.has(key(row)));
      const total = rows.reduce((sum, row) => sum + row['從藥庫調藥次數'], 0);
      const groups = new Map();
      for (const row of rows) {
        const id = key(row);
        if (!groups.has(id)) groups.set(id, { 藥品名稱: row['藥品名稱'], 藥品代碼: row['藥品代碼'], key: id, total: 0 });
        groups.get(id).total += row['從藥庫調藥次數'];
      }
      const matched = [...groups.values()].sort(byName);
      const buckets = Array.from({ length: 5 }, (_, index) => {
        const count = index + 1;
        const records = rows.filter((row) => row['從藥庫調藥次數'] === count);
        return { count, records: records.length, total: records.reduce((sum, row) => sum + row['從藥庫調藥次數'], 0) };
      });
      const other = total - buckets.reduce((sum, bucket) => sum + bucket.total, 0);
      const recordCount = rows.length;
      const otherRecords = recordCount - buckets.reduce((sum, bucket) => sum + bucket.records, 0);
      postMessage({ type: 'result', id: data.id, total, recordCount, matched, buckets, other, otherRecords, rows });
    }
  } catch (error) { postMessage({ type: 'error', id: data.id, message: error.message }); }
};
