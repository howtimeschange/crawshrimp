import tempfile
import unittest
import zipfile
from pathlib import Path

from core.api_server import _finalize_tmall_ops_assistant_outputs


class TmallOpsPackagingTests(unittest.TestCase):
    def test_packaging_upload_outputs_flat_zip_with_usage_prefixed_names(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            main_file = runtime_dir / "raw-main.jpg"
            detail_file = runtime_dir / "raw-detail.jpg"
            main_file.write_bytes(b"main")
            detail_file.write_bytes(b"detail")

            exported = base / "packaging-result.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_tmall_ops_assistant_outputs(
                task_id="tmall_packaging_upload",
                data_rows=[
                    {
                        "款号": "208126140007",
                        "商品ID": "693886015421",
                        "图片用途": "1:1主图",
                        "文件名": "01_1比1主图_01_208126140007_800x800_主图01.jpg",
                        "原文件名": "208126140007_800x800_主图01.jpg",
                        "云盘路径": "品牌视觉部/服饰包装组/巴拉服饰产品包装/208126140007/208126140007_800x800_主图01.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(main_file),
                        "__package_filename": "01_1比1主图_01_208126140007_800x800_主图01.jpg",
                    },
                    {
                        "款号": "208126140007",
                        "商品ID": "693886015421",
                        "图片用途": "PC详情",
                        "文件名": "06_PC详情_01_详情_001.jpg",
                        "原文件名": "详情_001.jpg",
                        "云盘路径": "品牌视觉部/服饰包装组/巴拉服饰产品包装/208126140007/详情_001.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(detail_file),
                        "__package_filename": "06_PC详情_01_详情_001.jpg",
                    },
                ],
                runtime_files=[str(main_file), str(detail_file)],
                exported_files=[str(exported)],
                run_params={
                    "package_name": "天猫包装图片包",
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            zip_path = Path(result[0])
            self.assertTrue(zip_path.is_file())
            self.assertEqual(Path(result[1]), exported)
            self.assertFalse(main_file.exists())
            self.assertFalse(detail_file.exists())
            self.assertFalse(runtime_dir.exists())

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(any(
                    name.endswith("天猫包装图片包/01_1比1主图_01_208126140007_800x800_主图01.jpg")
                    for name in names
                ))
                self.assertTrue(any(
                    name.endswith("天猫包装图片包/06_PC详情_01_详情_001.jpg")
                    for name in names
                ))


if __name__ == "__main__":
    unittest.main()
