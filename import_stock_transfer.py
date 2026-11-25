#!/usr/bin/env python3
"""將月報中有藥庫調撥紀錄的資料匯入 SQLite。"""
import argparse
import re
import sqlite3
import sys
from zipfile import BadZipFile
from pathlib import Path

from openpyxl import load_workbook

from normalize_rawdata import convert

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'RawData'
DATABASE = ROOT / 'stock_transfer.db'
HEADERS = ('藥品代碼', '藥品名稱', '基準量', '安全量', '住院用量', '出院帶藥用量', '從藥庫調藥次數')
FILENAME = re.compile(r'調撥_([0-9]{4})(0[1-9]|1[0-2])\.xlsx\Z')


def read_month(path):
    match = FILENAME.fullmatch(path.name)
    if not match or int(match.group(1)) == 0:
        raise ValueError('檔名須為調撥_YYYYMM.xlsx，且年月有效')
    month = int(match.group(1) + match.group(2))
    workbook = load_workbook(path, read_only=True, data_only=False)
    try:
        if len(workbook.worksheets) != 1:
            raise ValueError('檔案須包含一個工作表，請確認來源')
        sheet = workbook.worksheets[0]
        header = [c.value for c in next(sheet.iter_rows(min_row=1, max_row=1))]
        for name in HEADERS:
            if header.count(name) != 1:
                raise ValueError(f'{sheet.title}: 欄位「{name}」缺少或重複')
        indices = [header.index(name) for name in HEADERS]
        records, seen = [], {}
        data_rows = 0
        has_complete_row = False
        for row in sheet.iter_rows(min_row=2, max_col=len(header)):
            if all(c.value is None for c in row):
                continue
            data_rows += 1
            cells = [row[i] for i in indices]
            if all(c.value is not None and (not isinstance(c.value, str) or c.value.strip()) for c in cells):
                has_complete_row = True
            def parse(cell, text=False):
                try:
                    if cell.value == '未設定' and not text:
                        raise ValueError('請先執行原始資料標準化')
                    value = convert(cell, text)
                    if text and (not isinstance(cell.value, str) or not value.strip()):
                        raise ValueError('必須為非空白文字，請先標準化')
                    if not text and not -(2**63) <= value < 2**63:
                        raise ValueError('整數超出 SQLite 範圍')
                    return value
                except ValueError as exc:
                    raise ValueError(f'{sheet.title}!{cell.coordinate}: {exc}') from exc
            count = parse(cells[-1])
            if count == 0:
                continue
            values = [parse(c, i < 2) for i, c in enumerate(cells[:-1])] + [count]
            code = values[0]
            if code in seen:
                raise ValueError(f'{sheet.title}!{cells[0].coordinate}: 藥品代碼 {code!r} 重複（首次出現於 {seen[code]}）')
            seen[code] = cells[0].coordinate
            records.append((*values, month, f'{month}{code}'))
        if not data_rows or not has_complete_row:
            raise ValueError(f'{sheet.title}: 來源至少須有一筆指定欄位完整的資料列')
        return month, records, data_rows
    finally:
        workbook.close()


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS stock_transfer (
        "藥品代碼" TEXT NOT NULL, "藥品名稱" TEXT NOT NULL,
        "基準量" INTEGER NOT NULL, "安全量" INTEGER NOT NULL,
        "住院用量" INTEGER NOT NULL, "出院帶藥用量" INTEGER NOT NULL,
        "從藥庫調藥次數" INTEGER NOT NULL CHECK ("從藥庫調藥次數" != 0),
        "調撥月份" INTEGER NOT NULL, "調撥月份＋藥品代碼" TEXT NOT NULL UNIQUE,
        UNIQUE ("調撥月份", "藥品代碼"))''')
    db.execute('''CREATE TABLE IF NOT EXISTS import_history (
        month INTEGER PRIMARY KEY, filename TEXT NOT NULL,
        source_rows INTEGER NOT NULL, imported_rows INTEGER NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
    db.commit()


def save_month(db, month, records, source_rows, filename):
    with db:
        db.execute('DELETE FROM stock_transfer WHERE "調撥月份" = ?', (month,))
        db.executemany('INSERT INTO stock_transfer VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', records)
        db.execute('''INSERT INTO import_history(month, filename, source_rows, imported_rows, imported_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(month) DO UPDATE SET
            filename=excluded.filename, source_rows=excluded.source_rows,
            imported_rows=excluded.imported_rows, imported_at=excluded.imported_at''',
            (month, filename, source_rows, len(records)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', nargs='?', help='單一檔案名稱或路徑；省略則處理 RawData 全部 Excel')
    args = parser.parse_args()
    if args.file:
        path = Path(args.file).expanduser()
        if not path.exists() and not path.is_absolute():
            path = RAW / path
        paths = [path]
    else:
        paths = sorted(p for p in RAW.glob('*.xlsx') if not p.name.startswith('~$'))
    if not paths:
        print('找不到 Excel 檔案', file=sys.stderr)
        return 1
    failed = False
    try:
        with sqlite3.connect(DATABASE, timeout=10) as db:
            initialize(db)
            for path in paths:
                try:
                    month, records, source_rows = read_month(path)
                    save_month(db, month, records, source_rows, path.name)
                    print(f'{path.name}: 來源 {source_rows} 筆，匯入 {len(records)} 筆（{month}）')
                except (OSError, ValueError, sqlite3.Error, KeyError, IndexError, BadZipFile) as exc:
                    failed = True
                    print(f'{path.name}: 未更新：{exc}', file=sys.stderr)
    except sqlite3.Error as exc:
        print(f'資料庫錯誤：{exc}', file=sys.stderr)
        return 1
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
