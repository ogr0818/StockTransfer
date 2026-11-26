import { createExportWorkbook } from './export-xlsx.js?v=single-sheet-20261126';

const $ = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('zh-TW');
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'variant' });
// Fixed category colors: blue, orange, green, magenta and purple.
const colors = ['#1466a8', '#aa5a00', '#007c62', '#b33164', '#7250ad'];
const month = (value) => `${String(value).slice(0, 4)}/${String(value).slice(4, 6)}`;
const productKey = (row) => JSON.stringify([row['藥品名稱'], row['藥品代碼']]);
const nameOrder = (a, b) => collator.compare(a['藥品名稱'], b['藥品名稱']) || collator.compare(a['藥品代碼'], b['藥品代碼']);
const selected = new Set();
const worker = new Worker('worker.js');
let products = [], history = [], result, applied, requestId = 0, focused = null, page = 0;
let sortColumn = '調撥月份', sortDirection = 1;
let exportJob = null, exportFolders = null, exportBusy = false;
const columns = ['調撥月份', '藥品名稱', '藥品代碼', '從藥庫調藥次數', '基準量', '安全量', '住院用量', '出院帶藥用量'];

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function showError(message) {
  $('fatal').textContent = `資料未能載入：${message}。請確認資料庫存在並重新整理頁面。`;
  $('fatal').hidden = false;
  $('apply').disabled = !history.length;
  $('status').textContent = message;
}
worker.onerror = () => showError('查詢執行程式無法啟動');
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    history = data.history;
    products = data.products;
    if (!history.length) return showError('資料庫沒有月份匯入紀錄');
    for (const id of ['start', 'end']) {
      const element = $(id);
      for (const row of history) element.add(new Option(month(row.month), row.month));
      element.disabled = false;
    }
    $('start').value = history.at(-1).month;
    $('end').value = history.at(-1).month;
    $('coverage').textContent = `${month(history[0].month)} – ${month(history.at(-1).month)}`;
    const lastImport = history.map((h) => h.imported_at).sort().at(-1);
    $('data-info').textContent = `stock_transfer.db · 最後匯入 ${lastImport} UTC`;
    $('apply').disabled = false;
    renderProducts();
    apply();
  } else if (data.type === 'result') {
    if (data.id !== requestId) return;
    result = data;
    $('apply').disabled = false;
    $('fatal').hidden = true;
    renderResults();
  } else if (data.type === 'error' && (data.id === undefined || data.id === requestId)) showError(data.message);
};

function renderProducts() {
  const term = $('product-search').value.trim().toLocaleLowerCase();
  const visible = products.filter((p) => `${p['藥品名稱']} ${p['藥品代碼']}`.toLocaleLowerCase().includes(term));
  const fragment = document.createDocumentFragment();
  for (const product of visible) {
    const label = textElement('label', '', 'product-option');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(product.key);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(product.key); else selected.delete(product.key);
      updateProductLabel();
    });
    const name = textElement('span', product['藥品名稱']);
    name.append(textElement('small', product['藥品代碼']));
    label.append(checkbox, name);
    fragment.append(label);
  }
  if (!visible.length) fragment.append(textElement('p', '找不到相符品項，請換個名稱或代碼。'));
  $('product-options').replaceChildren(fragment);
  updateProductLabel();
}
function updateProductLabel() {
  $('product-summary').textContent = selected.size ? `已選 ${selected.size} 項` : '全部品項';
  $('selection-count').textContent = selected.size ? `已選 ${selected.size} / ${products.length} 項` : `未限定品項 · 共 ${products.length} 項`;
}
$('product-search').addEventListener('input', renderProducts);
$('clear-products').addEventListener('click', () => { selected.clear(); renderProducts(); });
document.addEventListener('click', (event) => {
  if (!$('product-picker').contains(event.target)) $('product-picker').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('product-picker').open) {
    $('product-picker').open = false;
    $('product-summary').focus();
  }
});

function apply() {
  if (!history.length) return;
  const start = Number($('start').value), end = Number($('end').value);
  const minimum = Number($('minimum').value), maximum = Number($('maximum').value);
  $('start').setCustomValidity(start > end ? '起始月份不得晚於結束月份。' : '');
  $('minimum').setCustomValidity(minimum > maximum ? '次數下限不得大於上限；兩者可以相等。' : '');
  const valid = $('filters').reportValidity();
  $('filter-error').textContent = start > end ? '起始月份不得晚於結束月份。' : minimum > maximum ? '次數下限不得大於上限；兩者可以相等。' : '';
  if (!valid) return;
  $('filter-notice').textContent = '';
  applied = { start, end, minimum, maximum, selected: [...selected] };
  focused = null; page = 0;
  $('product-picker').open = false;
  $('apply').disabled = true;
  $('download-xlsx').disabled = true;
  $('filter-description').textContent = '正在彙總資料…';
  worker.postMessage({ type: 'query', id: ++requestId, filters: applied });
}
$('filters').addEventListener('submit', (event) => { event.preventDefault(); apply(); });
for (const id of ['minimum', 'maximum', 'start', 'end']) {
  $(id).addEventListener('input', () => {
    $('minimum').setCustomValidity('');
    $('start').setCustomValidity('');
    $('filter-error').textContent = '';
  });
}
$('reset').addEventListener('click', () => {
  // Reload the initial view, including worker, errors, selection and table state.
  // This also works while loading or after a failed query.
  window.history.replaceState(null, '', '#overview');
  window.location.reload();
});

function renderResults() {
  $('period-label').textContent = `${month(applied.start)} – ${month(applied.end)}`;
  $('filter-description').textContent = `每月 ${applied.minimum}–${applied.maximum} 次 · ${applied.selected.length ? `已選 ${applied.selected.length} 項` : '全部品項'}`;
  $('total').textContent = format.format(result.total);
  $('matched').textContent = format.format(result.matched.length);
  $('matched-total').textContent = format.format(result.rows.length);
  $('detail-count').textContent = format.format(result.rows.length);
  $('empty').hidden = result.matched.length > 0;
  $('status').textContent = `已更新：區間總計 ${format.format(result.total)} 次，符合 ${result.matched.length} 個品項、${result.rows.length} 筆月結算資料。`;
  renderPie();
  renderTable();
}
function openBucket(bucket) {
  focused = bucket.other ? 'other' : bucket.count;
  page = 0;
  renderTable();
  if (location.hash !== '#details') location.hash = 'details';
  switchPage();
  $('detail-title').setAttribute('tabindex', '-1');
  $('detail-title').focus();
}
function renderPie() {
  const svg = $('pie');
  svg.replaceChildren();
  const namespace = 'http://www.w3.org/2000/svg';
  const title = document.createElementNS(namespace, 'title');
  title.id = 'pie-title'; title.textContent = '指定區間調藥次數分布';
  const description = document.createElementNS(namespace, 'desc');
  description.id = 'pie-description';
  description.textContent = `篩選後共 ${result.recordCount} 筆月結算紀錄；按每月調藥次數分成調撥 1 次至調撥 5 次及其他。每類占比為該類筆數除以篩選後總筆數。其他 ${result.otherRecords} 筆。完整數值列於分類清單。`;
  svg.append(title, description);
  const slices = result.buckets.map((bucket, index) => ({ ...bucket, label: `調撥 ${bucket.count} 次`, color: colors[index] }));
  slices.push({ label: '其他', records: result.otherRecords, total: result.other, color: '#63748a', other: true });
  let angle = -Math.PI / 2;
  const percent = (count) => result.recordCount ? `${(count / result.recordCount * 100).toFixed(2)}%` : '0.00%';
  const labels = [];
  for (const slice of slices.filter((slice) => slice.records > 0)) {
    const portion = slice.records / result.recordCount;
    const end = angle + portion * Math.PI * 2;
    const path = document.createElementNS(namespace, 'path');
    const point = (radians) => [220 + 195 * Math.cos(radians), 220 + 195 * Math.sin(radians)];
    if (portion >= 1) {
      path.setAttribute('d', 'M220,25 A195,195 0 1,1 220,415 A195,195 0 1,1 220,25 Z');
    } else {
      const [x1, y1] = point(angle), [x2, y2] = point(end);
      path.setAttribute('d', `M220,220 L${x1},${y1} A195,195 0 ${portion > .5 ? 1 : 0},1 ${x2},${y2} Z`);
    }
    path.setAttribute('fill', slice.color);
    const label = `${slice.label}，${slice.records} 筆月結算紀錄，占 ${percent(slice.records)}`;
    const tooltip = document.createElementNS(namespace, 'title'); tooltip.textContent = label; path.append(tooltip);
    path.setAttribute('role', 'button'); path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${label}，查看月別明細`);
    path.addEventListener('click', () => openBucket(slice));
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBucket(slice); }
    });
    svg.append(path);
    const middle = (angle + end) / 2;
    labels.push({ slice, middle, portion });
    angle = end;
  }
  // Labels render after every wedge, so later wedges cannot cover them.
  let smallLabelY = 30;
  for (const { slice, middle, portion } of labels) {
    const text = document.createElementNS(namespace, 'text');
    text.setAttribute('class', 'pie-label');
    text.setAttribute('text-anchor', 'middle');
    let x = 220 + (portion > .8 ? 65 : 140) * Math.cos(middle);
    let y = 220 + (portion > .8 ? 65 : 140) * Math.sin(middle);
    if (portion < .055) {
      const line = document.createElementNS(namespace, 'polyline');
      const edgeX = 220 + 188 * Math.cos(middle), edgeY = 220 + 188 * Math.sin(middle);
      x = 365; y = smallLabelY + 15; smallLabelY += 65;
      line.setAttribute('points', `${edgeX},${edgeY} 305,${y} ${x - 10},${y}`);
      line.setAttribute('fill', 'none'); line.setAttribute('stroke', slice.color); line.setAttribute('stroke-width', '2');
      svg.append(line);
      text.classList.add('pie-label-outside');
    }
    text.setAttribute('x', x); text.setAttribute('y', y - (slice.other ? 8 : 17));
    const lines = slice.other ? ['其他', percent(slice.records)] : ['調撥', `${slice.count} 次`, percent(slice.records)];
    lines.forEach((value, index) => {
      const span = document.createElementNS(namespace, 'tspan');
      span.setAttribute('x', x); span.setAttribute('dy', index ? '21' : '0');
      span.textContent = value; text.append(span);
    });
    svg.append(text);
  }
  if (!result.recordCount) {
    const emptyCircle = document.createElementNS(namespace, 'circle');
    emptyCircle.setAttribute('cx', '220'); emptyCircle.setAttribute('cy', '220'); emptyCircle.setAttribute('r', '195'); emptyCircle.setAttribute('fill', '#edf2f6');
    const text = document.createElementNS(namespace, 'text'); text.setAttribute('x', '220'); text.setAttribute('y', '225'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('fill', '#617185'); text.textContent = '此區間沒有調藥紀錄';
    svg.append(emptyCircle, text);
  }
  const legend = document.createDocumentFragment();
  for (const slice of slices) {
    const row = document.createElement('button');
    row.className = 'legend-row';
    row.type = 'button'; row.disabled = !slice.records; row.addEventListener('click', () => openBucket(slice));
    const swatch = textElement('span', '', 'swatch'); swatch.style.background = slice.color; swatch.setAttribute('aria-hidden', 'true');
    const name = textElement('span', slice.label, 'legend-name');
    name.append(textElement('small', slice.other ? '每月調撥超過 5 次的紀錄' : `每筆月結算調撥 ${slice.count} 次`));
    const value = textElement('span', `${format.format(slice.records)} 筆`, 'legend-value');
    value.append(textElement('small', percent(slice.records)));
    row.append(swatch, name, value); legend.append(row);
  }
  $('legend').replaceChildren(legend);
  $('pie-caption').textContent = result.recordCount ? `篩選後共 ${format.format(result.recordCount)} 筆 · 依分類筆數計算占比` : '沒有符合資料，不計算占比';
}

function detailRows() {
  if (!result) return [];
  let rows = focused === null ? [...result.rows] : result.rows.filter((row) => focused === 'other' ? row['從藥庫調藥次數'] > 5 : row['從藥庫調藥次數'] === focused);
  rows.sort((a, b) => {
    const comparison = typeof a[sortColumn] === 'number' ? a[sortColumn] - b[sortColumn] : collator.compare(a[sortColumn], b[sortColumn]);
    return comparison * sortDirection || a['調撥月份'] - b['調撥月份'] || nameOrder(a, b);
  });
  return rows;
}
function renderTable() {
  if (!result) return;
  const rows = detailRows();
  const focusedItemCount = new Set(rows.map(productKey)).size;
  $('download-xlsx').disabled = !rows.length;
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  page = Math.min(page, pages - 1);
  const header = document.createDocumentFragment();
  for (const column of columns) {
    const th = document.createElement('th'); th.scope = 'col';
    const active = column === sortColumn;
    if (active) th.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
    const button = textElement('button', column === '調撥月份' ? '月份' : column);
    button.type = 'button';
    if (active) { const indicator = textElement('span', sortDirection === 1 ? ' ▴' : ' ▾'); indicator.setAttribute('aria-hidden', 'true'); button.append(indicator); }
    button.addEventListener('click', () => {
      sortDirection = sortColumn === column ? -sortDirection : 1;
      sortColumn = column; page = 0; renderTable();
      $('table-head').children[columns.indexOf(column)].querySelector('button').focus();
      $('status').textContent = `已依${column}${sortDirection === 1 ? '升冪' : '降冪'}排序。`;
    });
    th.append(button); header.append(th);
  }
  $('table-head').replaceChildren(header);
  const body = document.createDocumentFragment();
  for (const row of rows.slice(page * 25, (page + 1) * 25)) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const value = row[column];
      const td = textElement('td', column === '調撥月份' ? month(value) : typeof value === 'number' ? format.format(value) : value);
      if (column === '藥品名稱') td.className = 'name';
      else if (typeof value === 'number' && column !== '調撥月份') td.className = 'numeric';
      tr.append(td);
    }
    body.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'); const td = textElement('td', '沒有符合條件的月別紀錄，請調整篩選。'); td.colSpan = columns.length; tr.append(td); body.append(tr); }
  $('table-body').replaceChildren(body);
  $('page-label').textContent = rows.length ? `第 ${page * 25 + 1}–${Math.min((page + 1) * 25, rows.length)} 筆，共 ${format.format(rows.length)} 筆 · ${page + 1} / ${pages} 頁` : '共 0 筆';
  $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1;
  $('clear-focus').hidden = !focused;
  const category = focused === 'other' ? '超過 5' : focused;
  $('detail-description').textContent = focused === null ? `${month(applied.start)}–${month(applied.end)} · 全部符合篩選紀錄，共 ${result.matched.length} 項` : `每月調撥 ${category} 次的紀錄 · ${focusedItemCount} 項 · ${month(applied.start)}–${month(applied.end)}`;
}
$('prev').addEventListener('click', () => { page--; renderTable(); });
$('next').addEventListener('click', () => { page++; renderTable(); });
$('clear-focus').addEventListener('click', () => { focused = null; page = 0; renderTable(); });

function updateExportFolder() {
  const destination = $('export-destination').value;
  $('export-folder').readOnly = destination !== 'custom';
  if (destination !== 'custom') $('export-folder').value = exportFolders[destination];
  else { $('export-folder').value = ''; $('export-folder').focus(); }
}
$('export-destination').addEventListener('change', updateExportFolder);
$('export-cancel').addEventListener('click', () => $('export-dialog').close());
$('export-dialog').addEventListener('cancel', (event) => { if (exportBusy) event.preventDefault(); });
$('download-xlsx').addEventListener('click', async () => {
  const rows = detailRows();
  if (!rows.length || !applied) return;
  exportJob = {
    rows, columns: [...columns],
    category: focused === null ? '全部符合紀錄' : focused === 'other' ? '其他（每月超過 5 次）' : `每月調撥 ${focused} 次`,
  };
  $('export-filename').value = `藥品調撥明細_${applied.start}-${applied.end}.xlsx`;
  $('export-scope').textContent = `將匯出 ${format.format(rows.length)} 筆完整紀錄（不受分頁限制）。分類：${exportJob.category}。`;
  $('export-error').textContent = '';
  $('export-overwrite').checked = false;
  try {
    const localPreview = ['127.0.0.1', 'localhost'].includes(location.hostname);
    if (localPreview) {
      const response = await fetch('/api/export-options', { cache: 'no-store' });
      exportFolders = response.ok ? await response.json() : null;
    } else exportFolders = null;
  } catch { exportFolders = null; }
  $('local-save-options').hidden = !exportFolders;
  $('browser-save-note').hidden = !!exportFolders;
  $('export-folder').required = !!exportFolders;
  if (exportFolders) { $('export-destination').value = 'desktop'; updateExportFolder(); }
  $('export-dialog').showModal();
});
$('export-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!exportJob || exportBusy) return;
  const filename = $('export-filename').value.trim();
  if (!filename.toLowerCase().endsWith('.xlsx') || /[/\\\u0000]/.test(filename)) {
    $('export-error').textContent = '請輸入 .xlsx 檔名，不可包含路徑分隔符號。';
    return;
  }
  exportBusy = true;
  $('export-save').disabled = true; $('export-cancel').disabled = true;
  $('export-error').textContent = '';
  try {
    let handle = null;
    if (!exportFolders && typeof window.showSaveFilePicker === 'function') {
      handle = await window.showSaveFilePicker({ suggestedName: filename, startIn: 'desktop', types: [{ description: 'Excel 活頁簿', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
    }
    const buffer = await createExportWorkbook(window.ExcelJS, exportJob);
    if (exportFolders) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
      const response = await fetch('/api/save-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: $('export-folder').value.trim(), filename, content: btoa(binary), overwrite: $('export-overwrite').checked }) });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || '儲存失敗，請選擇其他資料夾。');
      $('export-status').textContent = `已儲存 ${format.format(exportJob.rows.length)} 筆資料。檔案路徑：${saved.path}`;
    } else if (handle) {
      const writable = await handle.createWritable();
      await writable.write(buffer); await writable.close();
      $('export-status').textContent = `已儲存 ${format.format(exportJob.rows.length)} 筆至您選擇的位置，檔名：${handle.name}。瀏覽器未提供完整資料夾路徑。`;
    } else {
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('export-status').textContent = `已交由瀏覽器下載 ${format.format(exportJob.rows.length)} 筆：${filename}。實際儲存位置請查看瀏覽器下載紀錄。`;
    }
    $('export-dialog').close();
  } catch (error) {
    if (error.name !== 'AbortError') $('export-error').textContent = `無法匯出：${error.message}`;
  } finally {
    exportBusy = false; $('export-save').disabled = false; $('export-cancel').disabled = false;
  }
});
function switchPage() {
  const details = location.hash === '#details';
  $('overview').hidden = details; $('details').hidden = !details;
  for (const [id, active] of [['overview-link', !details], ['details-link', details]]) {
    if (active) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
}
$('details-link').addEventListener('click', () => { focused = null; page = 0; renderTable(); });
window.addEventListener('hashchange', switchPage);
switchPage();
worker.postMessage({ type: 'init' });

