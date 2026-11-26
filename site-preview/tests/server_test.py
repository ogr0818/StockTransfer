"""Exercise the save handler without network access or Desktop writes."""
import base64
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('preview_server', Path(__file__).resolve().parents[1] / 'server.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SaveTests(unittest.TestCase):
    def request(self, folder, *, filename='test.xlsx', origin='http://127.0.0.1:8765', overwrite=False):
        output = io.BytesIO()
        with ZipFile(output, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('xl/workbook.xml', '<workbook/>')
        body = json.dumps({'folder': str(folder), 'filename': filename, 'content': base64.b64encode(output.getvalue()).decode(), 'overwrite': overwrite}).encode()
        handler = module.Handler.__new__(module.Handler)
        handler.path = '/api/save-export'
        handler.server = SimpleNamespace(server_port=8765)
        handler.headers = Message()
        for key, value in [('Host', '127.0.0.1:8765'), ('Origin', origin), ('Content-Type', 'application/json'), ('Content-Length', str(len(body)))]:
            handler.headers[key] = value
        handler.rfile = io.BytesIO(body)
        responses = []
        handler.send_json = lambda status, value: responses.append((status, value))
        handler.do_POST()
        return responses[-1]

    def test_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path(folder) / 'test.xlsx'
            original.write_bytes(b'original')
            status, result = self.request(folder)
            self.assertEqual(status, 201)
            self.assertEqual(original.read_bytes(), b'original')
            self.assertEqual(Path(result['path']).name, 'test (1).xlsx')
            self.assertTrue(Path(result['path']).is_file())

    def test_cross_origin_request_cannot_save(self):
        with tempfile.TemporaryDirectory() as folder:
            status, _ = self.request(folder, origin='https://example.com')
            self.assertEqual(status, 403)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_explicit_replacement_keeps_original_path(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'test.xlsx'
            target.write_bytes(b'original')
            status, result = self.request(folder, overwrite=True)
            self.assertEqual(status, 201)
            self.assertEqual(result['path'], str(target.resolve()))
            with ZipFile(target) as archive:
                self.assertIn('xl/workbook.xml', archive.namelist())
            self.assertEqual(list(Path(folder).iterdir()), [target])

    def test_filename_cannot_escape_selected_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            for filename in ['../test.xlsx', 'test.txt', 'nested/test.xlsx']:
                status, _ = self.request(folder, filename=filename)
                self.assertEqual(status, 400)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_missing_folder_returns_error(self):
        with tempfile.TemporaryDirectory() as folder:
            status, result = self.request(Path(folder) / 'missing')
            self.assertEqual(status, 400)
            self.assertIn('不存在', result['error'])


if __name__ == '__main__':
    unittest.main()
