"""Serve the local UI and the original SQLite file without changing either."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import base64
import io
import json
import os
import tempfile
from zipfile import ZipFile, BadZipFile

HERE = Path(__file__).resolve().parent
DATABASE = HERE.parent / "stock_transfer.db"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/export-options":
            if not self.local_host():
                self.send_error(403)
                return
            self.send_json(200, {"desktop": str(Path.home() / "Desktop"), "downloads": str(Path.home() / "Downloads")})
            return
        if self.path.split("?", 1)[0] == "/stock_transfer.db":
            if not DATABASE.is_file():
                self.send_error(404, "stock_transfer.db not found")
                return
            content = DATABASE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.sqlite3")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)
            return
        super().do_GET()

    def local_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def send_json(self, status, value):
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != "/api/save-export":
            self.send_error(404)
            return
        if not self.local_host() or self.headers.get("Origin") != f"http://{self.headers.get('Host')}":
            self.send_json(403, {"error": "僅接受本機網頁的儲存請求。"})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            self.send_json(415, {"error": "請使用 JSON 儲存請求。"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 20 * 1024 * 1024:
                raise ValueError("匯出檔案大小不符限制。")
            payload = json.loads(self.rfile.read(length))
            folder = Path(payload["folder"]).expanduser().resolve()
            if not folder.is_dir():
                raise ValueError("指定資料夾不存在，請選擇現有資料夾。")
            filename = payload["filename"]
            if not isinstance(filename, str) or not filename.strip() or filename.startswith(".") or any(c in filename for c in '/\\\0') or not filename.lower().endswith(".xlsx"):
                raise ValueError("請提供有效的 .xlsx 檔名，不可包含路徑分隔符號。")
            content = base64.b64decode(payload["content"], validate=True)
            with ZipFile(io.BytesIO(content)) as archive:
                if not {"[Content_Types].xml", "xl/workbook.xml"}.issubset(archive.namelist()):
                    raise ValueError("檔案不是有效的 XLSX 活頁簿。")
            target = folder / filename
            if payload.get("overwrite") is True:
                # Replace atomically only when the user explicitly selected it.
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(dir=folder, prefix='.stock-transfer-', suffix='.xlsx', delete=False) as output:
                        temporary = Path(output.name)
                        output.write(content)
                    os.replace(temporary, target)
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
            else:
                # Exclusive creation keeps existing files unless replacement was selected.
                for number in range(1, 1001):
                    try:
                        with target.open("xb") as output:
                            output.write(content)
                        break
                    except FileExistsError:
                        target = folder / f"{Path(filename).stem} ({number}).xlsx"
                else:
                    raise ValueError("同名檔案過多，請變更檔名。")
            self.send_json(201, {"path": str(target), "bytes": len(content)})
        except (ValueError, KeyError, TypeError, OSError, BadZipFile) as error:
            self.send_json(400, {"error": str(error)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Local: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
