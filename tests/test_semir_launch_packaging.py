import ctypes
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
from openpyxl import Workbook, load_workbook
from core.semir_launch_packaging import package_materials, still_ocr_host_hardware, write_still_package_report

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


class StillPackageReportTests(unittest.TestCase):
    def test_windows_hardware_reads_system_memory_structure(self):
        def fill_memory_status(pointer):
            status = pointer._obj
            self.assertEqual(status.length, ctypes.sizeof(status))
            status.total_physical = 16 * 2**30
            return 1

        kernel = SimpleNamespace(kernel32=SimpleNamespace(GlobalMemoryStatusEx=fill_memory_status))
        with (
            patch('core.semir_launch_packaging.sys.platform', 'win32'),
            patch('core.semir_launch_packaging.os.cpu_count', return_value=8),
            patch('core.semir_launch_packaging.ctypes.windll', kernel, create=True),
        ):
            self.assertEqual(still_ocr_host_hardware(), {'threads': 8, 'memory_gb': 16})

    def test_appends_four_columns_and_preserves_other_batch_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source, output = root / 'source.xlsx', root / 'checked.xlsx'
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(['上新季', '批次', '款号', '款色', '色号', '电商上市日期', '备注'])
            for batch in ('第7批', '第8批'):
                sheet.append(['26Q3', batch, '107526100170', '10752610017000316', '00316', date(2026, 7, 30), '原始备注'])
            sheet.auto_filter.ref = 'A1:G3'
            workbook.save(source)
            workbook.close()
            original = source.read_bytes()
            row = {
                '批次': '26Q3第8批', '款号': '107526100170', '款色': '10752610017000316', '色号': '00316',
                '上市日期': '2026-07-30', '整理结果': '已复制并核验',
                '吊牌结果': '识别到不一致款号，待复核', '吊牌识别款号': '104526100003',
                '吊牌图片': 'IMG_0505.jpg', '洗唛结果': '候选图片未检出，待复核',
            }
            write_still_package_report(data_rows=[row], source=source, output=output)
            self.assertEqual(source.read_bytes(), original)
            checked = load_workbook(output)
            sheet = checked.active
            self.assertEqual([c.value for c in sheet[1]][-4:], ['缺吊牌', '缺洗唛', '款号是否一致', '备注'])
            self.assertEqual([c.value for c in sheet[2]][-4:], [None] * 4)
            self.assertEqual([c.value for c in sheet[3]][6:10], ['原始备注', '否', '待复核', '不一致'])
            self.assertIn('104526100003', sheet['K3'].value)
            self.assertEqual(sheet.auto_filter.ref, 'A1:K3')
            checked.close()
