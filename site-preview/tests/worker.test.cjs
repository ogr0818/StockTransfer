const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const initSqlJs = require(path.join(root, 'vendor/sql-wasm.js'));
const sourceCounts = [5, 6, 8, 8, 6, 6, 6, 4, 4, 5];
const selectedKey = JSON.stringify(['Sod. Chloride 0.45% 20ml Amp', 'SOD02I']);

async function createWorker() {
  const initialize = () => initSqlJs({ locateFile: (file) => path.join(root, 'vendor', file) });
  const SQL = await initialize();
  const db = new SQL.Database();
  db.run('CREATE TABLE stock_transfer (調撥月份 INTEGER, 藥品名稱 TEXT, 藥品代碼 TEXT, 從藥庫調藥次數 INTEGER, 基準量 INTEGER, 安全量 INTEGER, 住院用量 INTEGER, 出院帶藥用量 INTEGER)');
  db.run('CREATE TABLE import_history (month INTEGER, imported_rows INTEGER, imported_at TEXT)');
  sourceCounts.forEach((count, index) => {
    db.run('INSERT INTO stock_transfer VALUES (?, ?, ?, ?, 0, 0, 0, 0)', [202601 + index, 'Sod. Chloride 0.45% 20ml Amp', 'SOD02I', count]);
    db.run("INSERT INTO import_history VALUES (?, 1, '2026-11-25 07:09:57')", [202601 + index]);
  });
  db.run("INSERT INTO stock_transfer VALUES (202601, 'Unrelated drug', 'OTHER', 7, 0, 0, 0, 0)");
  const bytes = db.export();
  db.close();
  const messages = [];
  const context = {
    Intl, Set, Map, Number, JSON, Uint8Array, Error,
    importScripts() {}, initSqlJs: initialize,
    fetch: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }),
    postMessage: (message) => messages.push(message),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'worker.js'), 'utf8'), context);
  await context.onmessage({ data: { type: 'init' } });
  assert.equal(messages.at(-1).type, 'ready');
  return async (overrides = {}) => {
    await context.onmessage({ data: { type: 'query', id: 1, filters: {
      start: 202601, end: 202610, minimum: 1, maximum: 50, selected: [selectedKey], ...overrides,
    } } });
    const result = messages.at(-1);
    assert.equal(result.type, 'result');
    return result;
  };
}

test('SOD02I: use ten filtered monthly records as the pie denominator', async () => {
  const query = await createWorker();
  const result = await query();
  assert.equal(result.total, 58, 'transfer total remains a separate summary');
  assert.equal(result.recordCount, 10, 'unrelated drugs must not enter the pie denominator');
  assert.equal(result.rows.length, 10, 'monthly values are <=50 even though their sum is 58');
  assert.equal(result.matched.length, 1);
  assert.deepEqual(Array.from(result.buckets, (b) => b.total), [0, 0, 0, 8, 10]);
  assert.equal(result.other, 40);
  assert.deepEqual(Array.from(result.buckets, (b) => b.records), [0, 0, 0, 2, 2]);
  assert.equal(result.otherRecords, 6);
  assert.equal((result.buckets[3].records / result.recordCount * 100).toFixed(2), '20.00');
  assert.equal((result.buckets[4].records / result.recordCount * 100).toFixed(2), '20.00');
  assert.equal((result.otherRecords / result.recordCount * 100).toFixed(2), '60.00');
  assert.equal(result.buckets.reduce((sum, b) => sum + b.records, 0) + result.otherRecords, result.recordCount);
});

test('exact monthly count and month range also filter the denominator and detail rows', async () => {
  const query = await createWorker();
  const exact = await query({ minimum: 4, maximum: 4 });
  assert.equal(exact.total, 8);
  assert.equal(exact.rows.length, 2);
  assert.equal(exact.recordCount, 2);
  assert.equal(exact.buckets[3].records / exact.recordCount, 1);
  assert.equal(exact.otherRecords, 0);
  assert.ok(exact.rows.every((r) => r['從藥庫調藥次數'] === 4));
  assert.equal(exact.buckets[3].total, 8);
  assert.equal(exact.other, 0);
  const monthly = await query({ start: 202601, end: 202601 });
  assert.equal(monthly.total, 5);
  assert.equal(monthly.rows.length, 1);
  assert.equal(monthly.recordCount, 1);
  assert.equal(monthly.buckets[4].records, 1);
  assert.equal(monthly.buckets[4].total, 5);
  const other = await query({ minimum: 6, maximum: 8 });
  assert.equal(other.total, 40);
  assert.equal(other.rows.length, 6);
  assert.equal(other.recordCount, 6);
  assert.equal(other.otherRecords, 6);
  assert.equal(other.other, 40);
});

test('empty selection result has no fake other slice', async () => {
  const query = await createWorker();
  const result = await query({ minimum: 1, maximum: 1 });
  assert.equal(result.total, 0);
  assert.equal(result.other, 0);
  assert.equal(result.rows.length, 0);
  assert.equal(result.recordCount, 0);
  assert.equal(result.otherRecords, 0);
  assert.ok(result.buckets.every((b) => b.total === 0));
});
