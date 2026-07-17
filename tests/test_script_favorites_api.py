import unittest
from unittest.mock import patch

from core import api_server


class ScriptFavoritesApiTests(unittest.TestCase):
    def test_favorite_routes_return_the_saved_map_for_an_installed_adapter(self):
        with patch("core.api_server.adapter_loader.get_adapter", return_value=object()), \
             patch("core.api_server.script_favorites.list_favorites", return_value={}), \
             patch(
                 "core.api_server.script_favorites.favorite",
                 return_value={"tmall": "2026-07-17T09:00:00+00:00"},
             ) as favorite:
            self.assertEqual(api_server.get_script_favorites(), {"favorites": {}})
            self.assertEqual(
                api_server.favorite_script("tmall"),
                {"favorites": {"tmall": "2026-07-17T09:00:00+00:00"}},
            )

        favorite.assert_called_once_with("tmall")

    def test_favoriting_an_unknown_adapter_returns_404_without_writing(self):
        with patch("core.api_server.adapter_loader.get_adapter", return_value=None), \
             patch("core.api_server.script_favorites.favorite") as favorite:
            with self.assertRaises(api_server.HTTPException) as raised:
                api_server.favorite_script("missing")

        self.assertEqual(raised.exception.status_code, 404)
        favorite.assert_not_called()

    def test_uninstall_removes_its_favorite(self):
        with patch("core.api_server.adapter_loader.get_adapter", return_value=object()), \
             patch("core.api_server.sched_module.unregister_adapter"), \
             patch("core.api_server.adapter_loader.uninstall"), \
             patch("core.api_server.script_favorites.unfavorite") as unfavorite:
            self.assertEqual(api_server.uninstall_adapter("tmall"), {"ok": True})

        unfavorite.assert_called_once_with("tmall")


if __name__ == "__main__":
    unittest.main()
