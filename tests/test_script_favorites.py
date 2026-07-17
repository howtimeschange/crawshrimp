import json
import tempfile
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from core.config import save_config
from core import script_favorites


@contextmanager
def isolated_config_path():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_path = Path(tmpdir) / "config.json"
        with patch("core.config._config_path", return_value=config_path):
            yield config_path


class ScriptFavoritesTests(unittest.TestCase):
    def test_favorite_persists_a_utc_timestamp_and_loads_after_a_new_read(self):
        with isolated_config_path() as config_path:
            saved = script_favorites.favorite(
                "tmall-ops",
                now=datetime(2026, 7, 17, 9, 0, tzinfo=timezone.utc),
            )

            self.assertEqual(saved, {"tmall-ops": "2026-07-17T09:00:00+00:00"})
            self.assertEqual(
                json.loads(config_path.read_text(encoding="utf-8"))["script_favorites"],
                saved,
            )
            self.assertEqual(script_favorites.list_favorites(), saved)

    def test_unfavorite_removes_the_requested_adapter_from_persisted_config(self):
        with isolated_config_path() as config_path:
            save_config({
                "script_favorites": {
                    "tmall": "2026-07-17T09:00:00+00:00",
                    "shopee": "2026-07-17T10:00:00+00:00",
                },
            })

            self.assertEqual(
                script_favorites.unfavorite("tmall"),
                {"shopee": "2026-07-17T10:00:00+00:00"},
            )
            self.assertEqual(
                json.loads(config_path.read_text(encoding="utf-8"))["script_favorites"],
                {"shopee": "2026-07-17T10:00:00+00:00"},
            )
            self.assertEqual(
                script_favorites.list_favorites(),
                {"shopee": "2026-07-17T10:00:00+00:00"},
            )

    def test_list_favorites_discards_invalid_entries_without_losing_valid_entries(self):
        with isolated_config_path():
            save_config({
                "script_favorites": {
                    "valid": "2026-07-17T09:00:00+00:00",
                    "bad-date": "never",
                    "bad-value": 3,
                },
            })

            self.assertEqual(
                script_favorites.list_favorites(),
                {"valid": "2026-07-17T09:00:00+00:00"},
            )


if __name__ == "__main__":
    unittest.main()
