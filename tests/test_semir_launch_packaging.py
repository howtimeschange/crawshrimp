import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from openpyxl import load_workbook
from core.semir_launch_packaging import package_materials

class PackagingTests(unittest.TestCase):
    def test_lossless_conflicts_traversal_and_formula_safe(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);src=root/'source.pdf';src.write_bytes(b'%PDF-source')
            rows=[{'款号':'001','文件名':'=1+1','下载结果':'已下载','本地文件':str(src),'包内路径':'001/洗唛/00316/a.pdf'},
                  {'款号':'001','下载结果':'已下载','本地文件':str(src),'包内路径':'../escape.pdf'},
                  {'款号':'001','下载结果':'已下载','本地文件':str(src),'包内路径':'001/洗唛/00316/a.pdf'}]
            args=dict(data_rows=rows,run_params={'export_folder':str(root/'out')},runtime_artifact_dir=str(root),log=lambda x:None)
            refs=package_materials(**args);out=Path(refs[0])
            self.assertEqual(Path(rows[0]['本地文件']).read_bytes(),src.read_bytes())
            self.assertEqual(rows[1]['下载结果'],'整理失败');self.assertEqual(rows[2]['下载结果'],'整理失败')
            self.assertEqual(json.loads((out/'资料清单.json').read_text())['status'],'partial')
            with zipfile.ZipFile(out/'001.zip') as z:
                self.assertIsNone(z.testzip());self.assertEqual(z.read(z.namelist()[0]),src.read_bytes())
            wb=load_workbook(out/'资料明细.xlsx');ws=wb.active
            col=[c.value for c in ws[1]].index('文件名')+1
            self.assertEqual(ws.cell(2,col).data_type,'s');self.assertEqual(ws.max_row,4);wb.close()
            self.assertNotEqual(refs[0],package_materials(**args)[0])
if __name__=='__main__':unittest.main()

class InvalidContentTests(unittest.TestCase):
    def test_html_login_disguised_as_pdf_is_not_packaged(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);source=root/'file.pdf';source.write_text('<html>login</html>')
            rows=[{'下载结果':'已下载','本地文件':str(source),'包内路径':'A/file.pdf'}]
            refs=package_materials(data_rows=rows,run_params={},runtime_artifact_dir=td,log=lambda x:None)
            self.assertEqual(rows[0]['下载结果'],'文件校验失败')
            self.assertFalse(list(Path(refs[0]).glob('*.zip')))
