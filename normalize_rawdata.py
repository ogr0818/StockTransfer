#!/usr/bin/env python3
"""標準化 RawData Excel 欄位；預設批次處理，亦可指定單一檔案。"""

import argparse
import math
import os
from pathlib import Path
import re
import sys
import tempfile

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent
RAW_DATA = ROOT / "RawData"
TEXT_HEADERS = {"藥品代碼", "藥品名稱"}
INTEGER = re.compile(r"[+-]?\d+\Z")


def convert(cell, is_text):
    value = cell.value
    if cell.data_type == "f":
        raise ValueError("含公式，無法直接轉換")
    if is_text:
        if value is None or isinstance(value, bool):
            raise ValueError("文字欄位空白或型態不正確")
        if isinstance(value, str):
            return value
        if isinstance(value, int):
            # 數字儲存格的顯示格式可能包含前導零，不可直接轉成文字。
            if cell.number_format not in ("General", "0"):
                raise ValueError("數字格式可能影響代碼，請人工確認")
            return str(value)
        raise ValueError("無法安全轉為文字")
    if value == "未設定":
        return 0
    if isinstance(value, bool) or value is None:
        raise ValueError("數值欄位空白或型態不正確")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    if isinstance(value, str) and INTEGER.fullmatch(value.strip()):
        return int(value.strip())
    raise ValueError("不是可安全轉換的整數")


def process(path):
    workbook = load_workbook(path)
    changes = []
    errors = []
    checked = 0
    for sheet in workbook.worksheets:
        headers = [cell.value for cell in sheet[1]]
        if any(headers.count(name) != 1 for name in TEXT_HEADERS):
            errors.append(f"{sheet.title}: 缺少或重複「藥品代碼」「藥品名稱」欄位")
            continue
        if any(value is None for value in headers):
            errors.append(f"{sheet.title}: 第一列含空白欄名，請確認資料範圍")
            continue
        for row in sheet.iter_rows(min_row=2, max_col=len(headers)):
            if all(cell.value is None for cell in row):
                continue
            for cell, header in zip(row, headers):
                checked += 1
                try:
                    new = convert(cell, header in TEXT_HEADERS)
                except ValueError as exc:
                    errors.append(f"{sheet.title}!{cell.coordinate} ({header}): {cell.value!r} — {exc}")
                    continue
                if type(cell.value) is not type(new) or cell.value != new:
                    changes.append((cell, new))
    if errors:
        workbook.close()
        print(f"{path.name}: 未修改，發現 {len(errors)} 個問題", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return False
    if changes:
        for cell, value in changes:
            cell.value = value
        fd, tmp = tempfile.mkstemp(prefix=".normalize_", suffix=".xlsx", dir=path.parent)
        os.close(fd)
        try:
            workbook.save(tmp)
            os.chmod(tmp, path.stat().st_mode)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    workbook.close()
    print(f"{path.name}: 檢查 {checked} 格，轉換 {len(changes)} 格")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", help="指定單一 .xlsx 檔案；可輸入完整路徑或 RawData 內的檔名")
    args = parser.parse_args()
    if args.file:
        path = Path(args.file).expanduser()
        if not path.exists() and not path.is_absolute():
            path = RAW_DATA / path
        paths = [path]
    else:
        paths = sorted(p for p in RAW_DATA.glob("*.xlsx") if not p.name.startswith("~$"))
    if not paths:
        parser.error(f"找不到 Excel 檔案：{RAW_DATA}")
    failed = False
    for path in paths:
        if not path.is_file() or path.suffix.lower() != ".xlsx":
            print(f"找不到 .xlsx 檔案：{path}", file=sys.stderr)
            failed = True
            continue
        try:
            if not process(path):
                failed = True
        except (OSError, ValueError, KeyError) as exc:
            print(f"{path.name}: 處理失敗：{exc}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
