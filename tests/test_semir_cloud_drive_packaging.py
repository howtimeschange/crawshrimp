import tempfile
import unittest
import zipfile
from pathlib import Path

from core.api_server import _finalize_semir_cloud_drive_outputs


class SemirCloudDrivePackagingTests(unittest.TestCase):
    def _build_rows(self, file_a: Path, file_b: Path):
        return [
            {
                "输入编码": "208226111002",
                "文件名": "208226111002.jpg",
                "云盘路径": "巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/A/208226111002.jpg",
                "下载结果": "已下载",
                "本地文件": str(file_a),
                "备注": "",
            },
            {
                "输入编码": "208226111002",
                "文件名": "208226111002-00316.jpg",
                "云盘路径": "巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/B/208226111002-00316.jpg",
                "下载结果": "已下载",
                "本地文件": str(file_b),
                "备注": "",
            },
        ]

    def test_finalize_outputs_flattens_to_code_folder_when_duplicate_mode_is_first_per_stem(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            file_a = runtime_dir / "raw-a.jpg"
            file_b = runtime_dir / "raw-b.jpg"
            file_a.write_bytes(b"a")
            file_b.write_bytes(b"b")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_semir_cloud_drive_outputs(
                task_id="batch_image_download",
                data_rows=self._build_rows(file_a, file_b),
                runtime_files=[str(file_a), str(file_b)],
                exported_files=[str(exported)],
                run_params={
                    "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/",
                    "package_name": "测试图片包",
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            zip_path = Path(result[0])
            self.assertTrue(zip_path.is_file())
            self.assertEqual(Path(result[1]), exported)

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(
                    any(
                        name.endswith("测试图片包/208226111002/208226111002.jpg")
                        for name in names
                    )
                )
                self.assertTrue(
                    any(
                        name.endswith("测试图片包/208226111002/208226111002-00316.jpg")
                        for name in names
                    )
                )
                self.assertFalse(any("/巴拉货控__" in name for name in names))

    def test_finalize_outputs_keeps_path_folder_when_duplicate_mode_is_all(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            file_a = runtime_dir / "raw-a.jpg"
            file_b = runtime_dir / "raw-b.jpg"
            file_a.write_bytes(b"a")
            file_b.write_bytes(b"b")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_semir_cloud_drive_outputs(
                task_id="batch_image_download",
                data_rows=self._build_rows(file_a, file_b),
                runtime_files=[str(file_a), str(file_b)],
                exported_files=[str(exported)],
                run_params={
                    "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/",
                    "package_name": "测试图片包_保留路径",
                    "duplicate_mode": "all",
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            zip_path = Path(result[0])
            self.assertTrue(zip_path.is_file())

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(
                    any(
                        name.endswith(
                            "测试图片包_保留路径/208226111002/巴拉货控__02 产品上新模块__2-2 巴拉产品上新__2026年巴拉夏__平拍原图__A/208226111002.jpg"
                        )
                        for name in names
                    )
                )
                self.assertTrue(
                    any(
                        name.endswith(
                            "测试图片包_保留路径/208226111002/巴拉货控__02 产品上新模块__2-2 巴拉产品上新__2026年巴拉夏__平拍原图__B/208226111002-00316.jpg"
                        )
                        for name in names
                    )
                )

    def test_finalize_outputs_copies_zip_and_excel_to_export_folder(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_dir = base / "external"

            file_a = runtime_dir / "raw-a.jpg"
            file_b = runtime_dir / "raw-b.jpg"
            file_a.write_bytes(b"a")
            file_b.write_bytes(b"b")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_semir_cloud_drive_outputs(
                task_id="batch_image_download",
                data_rows=self._build_rows(file_a, file_b),
                runtime_files=[str(file_a), str(file_b)],
                exported_files=[str(exported)],
                run_params={
                    "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/",
                    "package_name": "外部导出包",
                    "export_folder": str(export_dir),
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            self.assertTrue(all(str(path).startswith(str(export_dir)) for path in result))
            self.assertTrue((export_dir / "外部导出包").is_dir())
            self.assertTrue(any(Path(path).suffix == ".zip" for path in result))
            self.assertTrue(any(Path(path).name == "summary.xlsx" for path in result))

    def test_finalize_outputs_removes_raw_runtime_files_after_packaging(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            file_a = runtime_dir / "raw-a.jpg"
            file_b = runtime_dir / "raw-b.jpg"
            file_a.write_bytes(b"a")
            file_b.write_bytes(b"b")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_semir_cloud_drive_outputs(
                task_id="batch_image_download",
                data_rows=self._build_rows(file_a, file_b),
                runtime_files=[str(file_a), str(file_b)],
                exported_files=[str(exported)],
                run_params={
                    "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/",
                    "package_name": "清理测试包",
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            self.assertFalse(file_a.exists())
            self.assertFalse(file_b.exists())
            self.assertFalse((runtime_dir / "清理测试包").exists())
            self.assertTrue((runtime_dir / "清理测试包.zip").exists())


if __name__ == "__main__":
    unittest.main()
