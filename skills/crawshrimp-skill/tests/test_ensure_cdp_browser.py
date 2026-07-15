import tempfile
import unittest
from pathlib import Path

from scripts.ensure_cdp_browser import ProbeResult, ensure_cdp_browser


def _paths(tmp: str) -> tuple[Path, Path, str]:
    root = Path(tmp)
    profile_dir = root / "profile"
    log_file = root / "chrome.log"
    chrome_path = root / "chrome"
    chrome_path.write_text("fake chrome\n", encoding="utf-8")
    return profile_dir, log_file, str(chrome_path)


class EnsureCDPBrowserTest(unittest.TestCase):
    def test_ready_endpoint_does_not_launch_chrome(self):
        calls = []

        def probe(url):
            calls.append(url)
            return ProbeResult("ready", "CDP endpoint is healthy", {"Browser": "Chrome"}, 1)

        with tempfile.TemporaryDirectory() as tmp:
            profile_dir, log_file, chrome_path = _paths(tmp)
            result = ensure_cdp_browser(
                cdp_url="http://127.0.0.1:9222",
                profile_dir=profile_dir,
                log_file=log_file,
                timeout_seconds=1,
                poll_interval=0,
                start_url="about:blank",
                chrome_path=chrome_path,
                probe=probe,
                launcher=lambda _: self.fail("should not launch Chrome"),
                sleeper=lambda _: None,
            )

        self.assertEqual(result.status, "ready")
        self.assertFalse(result.launched)
        self.assertEqual(calls, ["http://127.0.0.1:9222"])

    def test_connection_refused_launches_once_then_waits_until_ready(self):
        probes = [
            ProbeResult("connection_refused", "both endpoints refused"),
            ProbeResult("connection_refused", "both endpoints refused again"),
            ProbeResult("ready", "CDP endpoint is healthy", {"Browser": "Chrome"}, 1),
        ]
        launches = []

        def probe(_url):
            return probes.pop(0)

        with tempfile.TemporaryDirectory() as tmp:
            profile_dir, log_file, chrome_path = _paths(tmp)
            result = ensure_cdp_browser(
                cdp_url="http://127.0.0.1:9222",
                profile_dir=profile_dir,
                log_file=log_file,
                timeout_seconds=1,
                poll_interval=0,
                start_url="about:blank",
                chrome_path=chrome_path,
                probe=probe,
                launcher=lambda resolved: launches.append(resolved),
                sleeper=lambda _: None,
            )

        self.assertEqual(result.status, "launched")
        self.assertTrue(result.launched)
        self.assertEqual(launches, [chrome_path])

    def test_blocked_non_refused_probe_does_not_launch(self):
        launches = []

        def probe(_url):
            return ProbeResult("blocked", "/json/version=timeout")

        with tempfile.TemporaryDirectory() as tmp:
            profile_dir, log_file, chrome_path = _paths(tmp)
            result = ensure_cdp_browser(
                cdp_url="http://127.0.0.1:9222",
                profile_dir=profile_dir,
                log_file=log_file,
                timeout_seconds=1,
                poll_interval=0,
                start_url="about:blank",
                chrome_path=chrome_path,
                probe=probe,
                launcher=lambda resolved: launches.append(resolved),
                sleeper=lambda _: None,
            )

        self.assertEqual(result.status, "blocked")
        self.assertFalse(result.launched)
        self.assertEqual(launches, [])


if __name__ == "__main__":
    unittest.main()
