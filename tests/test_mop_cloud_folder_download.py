import tempfile
import unittest
from pathlib import Path

from core.api_server import _finalize_mop_cloud_folder_download_outputs


class MopCloudFolderDownloadPackagingTests(unittest.TestCase):
    def test_finalize_outputs_arranges_downloads_as_local_folder_tree(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            image = runtime_dir / "download-a.jpg"
            video = runtime_dir / "download-b.mp4"
            image.write_bytes(b"image")
            video.write_bytes(b"video")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_mop_cloud_folder_download_outputs(
                data_rows=[
                    {
                        "__sheet_name": "下载明细",
                        "顶层文件夹": "653100C4202Z+653100C2003Z",
                        "文件名": "look-01.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(image),
                        "__mop_package_path": "653100C4202Z+653100C2003Z/look-01.jpg",
                    },
                    {
                        "__sheet_name": "下载明细",
                        "顶层文件夹": "653100C4202Z+653100C2003Z",
                        "文件名": "runway.mp4",
                        "下载结果": "已下载",
                        "本地文件": str(video),
                        "__mop_package_path": "653100C4202Z+653100C2003Z/视频/runway.mp4",
                    },
                    {
                        "__sheet_name": "搭配关系",
                        "文件夹名": "653100C4202Z+653100C2003Z",
                        "款号1": "653100C4202Z",
                        "款号2": "653100C2003Z",
                    },
                ],
                runtime_files=[str(image), str(video)],
                exported_files=[str(exported)],
                run_params={"package_name": "MOP模拍图测试包"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            package_dir = Path(result[0])
            self.assertTrue(package_dir.is_dir())
            self.assertEqual(Path(result[1]), exported)
            self.assertTrue((package_dir / "653100C4202Z+653100C2003Z" / "look-01.jpg").is_file())
            self.assertTrue((package_dir / "653100C4202Z+653100C2003Z" / "视频" / "runway.mp4").is_file())
            self.assertFalse(image.exists())
            self.assertFalse(video.exists())

    def test_finalize_outputs_keeps_direct_downloaded_folder_tree(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            package_dir = base / "out" / "MOP直接下载包"
            image = package_dir / "653100C4202Z+653100C2003Z" / "look-01.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"image")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_mop_cloud_folder_download_outputs(
                data_rows=[
                    {
                        "__sheet_name": "下载明细",
                        "顶层文件夹": "653100C4202Z+653100C2003Z",
                        "文件名": "look-01.jpg",
                        "下载结果": "已下载",
                        "__runtime_local_path": str(image),
                        "__mop_package_path": "653100C4202Z+653100C2003Z/look-01.jpg",
                    }
                ],
                runtime_files=[str(image)],
                exported_files=[str(exported)],
                run_params={"package_name": "MOP直接下载包"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(Path(result[0]), package_dir)
            self.assertTrue(image.is_file())
            self.assertEqual(image.read_bytes(), b"image")
            self.assertEqual(Path(result[1]), exported)


if __name__ == "__main__":
    unittest.main()
