import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.browser_executor import (
    BrowserAction,
    BrowserResult,
    ChromeCDPBackend,
    _websocket_capture,
    normalize_crawshrimp_snapshot,
)


class BrowserExecutorTest(unittest.TestCase):
    def test_normalizes_crawshrimp_snapshot_to_page_state(self):
        snapshot = {
            "dom": {
                "url": "https://example.test/orders",
                "title": "Orders",
                "headings": ["Orders"],
                "buttons": [{"text": "Export", "selector": "button.export"}],
                "inputs": [{"placeholder": "Search", "selector": "input"}],
                "tables": [{"caption": "Order table", "rows": 2}],
            },
            "knowledge": {"cards": [{"title": "existing note"}]},
        }

        page = normalize_crawshrimp_snapshot(snapshot)

        self.assertEqual(page.url, "https://example.test/orders")
        self.assertEqual(page.title, "Orders")
        self.assertIn("Orders", page.visible_text)
        self.assertEqual(page.controls[0]["name"], "Export")
        self.assertEqual(page.controls[1]["role"], "input")
        self.assertEqual(page.tables[0]["rows"], 2)
        self.assertEqual(page.network[0]["kind"], "knowledge")

    def test_chrome_cdp_backend_lists_tabs_and_sends_runtime_evaluate(self):
        sent_messages = []
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_ws_send(ws_url, message, timeout):
            sent_messages.append((ws_url, message))
            self.assertEqual(ws_url, "ws://example.test/devtools/page/tab-1")
            if message["method"] == "Runtime.evaluate":
                return {"id": message["id"], "result": {"result": {"value": {"answer": 42}}}}
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            cdp_url="http://127.0.0.1:9222",
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
        )

        result = asyncio.run(backend.execute_async(BrowserAction(kind="eval", script="({ answer: 42 })")))

        self.assertTrue(result.ok)
        self.assertEqual(result.data["value"], {"answer": 42})
        self.assertEqual(sent_messages[0][1]["method"], "Runtime.evaluate")
        self.assertTrue(sent_messages[0][1]["params"]["awaitPromise"])

    def test_chrome_cdp_backend_sends_click_and_navigate_actions(self):
        sent_methods = []
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_ws_send(ws_url, message, timeout):
            sent_methods.append((message["method"], message.get("params") or {}))
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
        )

        click_result = asyncio.run(backend.execute_async(BrowserAction(kind="click", x=12, y=34)))
        nav_result = asyncio.run(
            backend.execute_async(BrowserAction(kind="navigate", url="https://example.test/next"))
        )

        self.assertTrue(click_result.ok)
        self.assertTrue(nav_result.ok)
        methods = [method for method, _ in sent_methods]
        self.assertIn("Page.bringToFront", methods)
        self.assertEqual(methods.count("Input.dispatchMouseEvent"), 3)
        self.assertIn("Page.navigate", methods)

    def test_chrome_cdp_backend_controls_download_directory_before_click(self):
        sent = []
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_ws_send(ws_url, message, timeout):
            sent.append((ws_url, message["method"], message.get("params") or {}))
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
        )

        with tempfile.TemporaryDirectory() as tmp:
            prepared = asyncio.run(backend.prepare_download_async(Path(tmp)))
            asyncio.run(backend.restore_download_async())

        self.assertTrue(prepared["configured"])
        self.assertEqual(sent[0][0], "ws://example.test/devtools/page/tab-1")
        self.assertEqual(sent[0][1], "Page.setDownloadBehavior")
        self.assertEqual(sent[0][2]["behavior"], "allow")
        self.assertEqual(sent[0][2]["downloadPath"], tmp)
        self.assertEqual(sent[1][2], {"behavior": "default"})

    def test_chrome_cdp_backend_keeps_download_control_active_until_file_arrives(self):
        sent = []
        download_dir = None

        async def fake_ws_send(ws_url, message, timeout):
            nonlocal download_dir
            sent.append((message["method"], message.get("params") or {}))
            if message["method"] == "Page.setDownloadBehavior" and message.get("params", {}).get("behavior") == "allow":
                download_dir = Path(message["params"]["downloadPath"])
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: [{
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }],
            send_ws=fake_ws_send,
        )

        async def fake_execute(action):
            (download_dir / "generated.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            return BrowserResult(ok=True, action=action.kind, data={"value": {"ok": True}})

        backend.execute_async = fake_execute
        with tempfile.TemporaryDirectory() as tmp:
            result = asyncio.run(
                backend.execute_download_async(
                    BrowserAction(kind="eval", script="document.body.click()", user_gesture=True),
                    Path(tmp),
                    expected_file="sku.pdf",
                    timeout_ms=1000,
                )
            )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["download"]["matchedBy"], "fallback_any_pdf")
        self.assertTrue(result.data["download"]["browserDownloadControl"]["configured"])
        self.assertEqual(sent[0][1]["behavior"], "allow")
        self.assertEqual(sent[-1][1]["behavior"], "default")

    def test_chrome_cdp_backend_sets_file_input_files_for_upload(self):
        sent = []
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_ws_send(ws_url, message, timeout):
            sent.append((message["method"], message.get("params") or {}))
            method = message["method"]
            if method == "Runtime.evaluate":
                return {"id": message["id"], "result": {"result": {"value": {"ok": True, "selector": "input[type=file]"}}}}
            if method == "DOM.getDocument":
                return {"id": message["id"], "result": {"root": {"nodeId": 1}}}
            if method == "DOM.querySelector":
                return {"id": message["id"], "result": {"nodeId": 7}}
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
        )

        with tempfile.TemporaryDirectory() as tmp:
            upload_file = Path(tmp) / "report.csv"
            upload_file.write_text("id\n1\n", encoding="utf-8")
            result = asyncio.run(
                backend.execute_async(
                    BrowserAction(kind="upload", selector="input[type=file]", files=[str(upload_file)])
                )
            )

        self.assertTrue(result.ok)
        methods = [method for method, _ in sent]
        self.assertIn("DOM.setFileInputFiles", methods)
        upload_params = [params for method, params in sent if method == "DOM.setFileInputFiles"][0]
        self.assertEqual(upload_params["nodeId"], 7)
        self.assertEqual(upload_params["files"], [str(upload_file.resolve())])

    def test_chrome_cdp_backend_rejects_missing_upload_files_before_cdp(self):
        sent = []
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_ws_send(ws_url, message, timeout):
            sent.append(message["method"])
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
        )

        result = asyncio.run(
            backend.execute_async(
                BrowserAction(kind="upload", selector="input[type=file]", files=["/tmp/not-present-crawshrimp.csv"])
            )
        )

        self.assertFalse(result.ok)
        self.assertIn("upload file not found", result.error)
        self.assertEqual(sent, [])

    def test_chrome_cdp_backend_captures_network_requests(self):
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]

        async def fake_capture(ws_url, setup_messages, timeout_ms, trigger=None, matches=None):
            self.assertEqual(ws_url, "ws://example.test/devtools/page/tab-1")
            self.assertIn("Network.enable", [item["method"] for item in setup_messages])
            if trigger:
                self.assertEqual(trigger[0]["method"], "Input.dispatchMouseEvent")
            return {
                "matches": [
                    {"url": "https://example.test/api/orders", "method": "GET", "status": 200},
                ],
                "total": 1,
            }

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            capture_ws=fake_capture,
        )

        passive = asyncio.run(
            backend.execute_async(
                BrowserAction(kind="capture", capture_mode="passive", matches=[{"url_contains": "/api/"}])
            )
        )
        click = asyncio.run(
            backend.execute_async(BrowserAction(kind="capture", capture_mode="click", x=12, y=34))
        )

        self.assertTrue(passive.ok)
        self.assertEqual(passive.data["matches"][0]["url"], "https://example.test/api/orders")
        self.assertTrue(click.ok)

    def test_websocket_capture_recovers_missing_post_body_through_cdp(self):
        class FakeWebSocket:
            def __init__(self):
                self.queue = asyncio.Queue()
                self.sent = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def send(self, raw):
                import json

                message = json.loads(raw)
                self.sent.append(message)
                method = message["method"]
                if method == "Network.enable":
                    await self.queue.put(json.dumps({"id": message["id"], "result": {}}))
                    await self.queue.put(json.dumps({
                        "method": "Network.requestWillBeSent",
                        "params": {
                            "requestId": "request-1",
                            "request": {
                                "url": "https://example.test/api/orders",
                                "method": "POST",
                                "headers": {},
                            },
                        },
                    }))
                    await self.queue.put(json.dumps({
                        "method": "Network.responseReceived",
                        "params": {
                            "requestId": "request-1",
                            "response": {
                                "url": "https://example.test/api/orders",
                                "status": 200,
                                "mimeType": "application/json",
                                "headers": {},
                            },
                        },
                    }))
                    await self.queue.put(json.dumps({
                        "method": "Network.loadingFinished",
                        "params": {"requestId": "request-1"},
                    }))
                    return
                if method == "Network.getRequestPostData":
                    await self.queue.put(json.dumps({
                        "id": message["id"],
                        "result": {"postData": '{"skuExtCodes":["9950019805206"]}'},
                    }))
                    return
                await self.queue.put(json.dumps({"id": message["id"], "result": {}}))

            async def recv(self):
                return await self.queue.get()

        fake_ws = FakeWebSocket()
        with patch("websockets.connect", return_value=fake_ws):
            result = asyncio.run(
                _websocket_capture(
                    "ws://example.test/devtools/page/tab-1",
                    [{"method": "Network.enable", "params": {}}],
                    1000,
                    matches=[{"url_contains": "/api/orders", "method": "POST"}],
                    options={"min_matches": 1, "settle_ms": 0},
                )
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["matches"][0]["postData"], '{"skuExtCodes":["9950019805206"]}')
        self.assertIn("Network.getRequestPostData", [item["method"] for item in fake_ws.sent])

    def test_chrome_cdp_backend_url_capture_uses_temporary_tab_and_runtime_options(self):
        tabs = [
            {
                "id": "main",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/main",
            }
        ]
        capture_calls = []
        closed = []

        async def fake_capture(ws_url, setup_messages, timeout_ms, trigger=None, matches=None, options=None):
            capture_calls.append(
                {
                    "ws_url": ws_url,
                    "trigger": trigger,
                    "matches": matches,
                    "options": options,
                }
            )
            return {
                "ok": True,
                "matches": [
                    {"url": "https://example.test/api/orders", "method": "GET", "status": 200},
                    {"url": "https://example.test/api/orders?page=2", "method": "GET", "status": 200},
                ],
                "total": 2,
            }

        backend = ChromeCDPBackend(
            tab_id="main",
            get_json=lambda path: tabs if path == "/json" else None,
            capture_ws=fake_capture,
            new_tab=lambda url: {
                "id": "tmp",
                "type": "page",
                "url": url,
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tmp",
            },
            close_tab=lambda tab_id: closed.append(tab_id),
        )

        result = asyncio.run(
            backend.execute_async(
                BrowserAction(
                    kind="capture",
                    capture_mode="url",
                    url="https://example.test/orders",
                    matches=[{"url_contains": "/api/orders"}],
                    min_matches=2,
                    include_response_body=True,
                )
            )
        )

        self.assertTrue(result.ok)
        self.assertEqual(capture_calls[0]["ws_url"], "ws://example.test/devtools/page/tmp")
        self.assertEqual(capture_calls[0]["trigger"][0]["method"], "Page.navigate")
        self.assertEqual(capture_calls[0]["options"]["min_matches"], 2)
        self.assertTrue(capture_calls[0]["options"]["include_response_body"])
        self.assertEqual(result.data["openedTabId"], "tmp")
        self.assertEqual(closed, ["tmp"])

    def test_request_matching_supports_regex_status_mime_and_body(self):
        from scripts.browser_executor import request_matches

        entry = {
            "url": "https://example.test/api/orders?page=1",
            "method": "POST",
            "status": 200,
            "mimeType": "application/json",
            "body": '{"items":[{"id":1}]}',
        }

        self.assertTrue(
            request_matches(
                entry,
                [
                    {
                        "url_regex": r"/api/orders",
                        "method": "POST",
                        "status": 200,
                        "mime_type_contains": "json",
                        "body_contains": "items",
                    }
                ],
            )
        )
        self.assertFalse(request_matches(entry, [{"url_contains": "/api/other"}]))

    def test_chrome_backend_transient_tab_hooks_close_and_handle_download_tabs(self):
        tabs = [
            {
                "id": "main",
                "type": "page",
                "url": "https://seller.example.test/report",
                "title": "Report",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/main",
            },
            {
                "id": "tmp",
                "type": "page",
                "url": "https://agentseller.example.test/main/authentication?x=1",
                "title": "Auth",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tmp",
            },
        ]
        closed = []
        sent = []

        async def fake_ws_send(ws_url, message, timeout):
            sent.append((ws_url, message["method"]))
            if message["method"] == "Runtime.evaluate":
                return {
                    "id": message["id"],
                    "result": {
                        "result": {
                            "value": {
                                "success": True,
                                "data": [{"handled": True, "modalPresent": True, "confirmClicked": True}],
                                "meta": {"has_more": False},
                            }
                        }
                    },
                }
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="main",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
            close_tab=lambda tab_id: closed.append(tab_id),
        )

        ids = backend.list_page_tab_ids()
        actions = backend.handle_transient_download_tabs()
        backend.close_new_tabs({"main"})

        self.assertEqual(ids, {"main", "tmp"})
        self.assertEqual(actions[0]["tabId"], "tmp")
        self.assertIn("tmp", closed)
        self.assertEqual(sent[0][0], "ws://example.test/devtools/page/tmp")

    def test_chrome_cdp_backend_supports_wheel_capture_reload_and_file_chooser(self):
        tabs = [
            {
                "id": "tab-1",
                "type": "page",
                "url": "https://example.test",
                "title": "Example",
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tab-1",
            }
        ]
        captured_triggers = []
        chooser_calls = []
        sent_methods = []

        async def fake_capture(ws_url, setup_messages, timeout_ms, trigger=None, matches=None):
            captured_triggers.extend(trigger or [])
            return {"matches": [{"url": "https://example.test/api/wheel"}], "total": 1}

        async def fake_chooser(ws_url, clicks, files, timeout_ms):
            chooser_calls.append((clicks, files, timeout_ms))
            return {"backendNodeId": 99, "fileCount": len(files)}

        async def fake_ws_send(ws_url, message, timeout):
            sent_methods.append(message["method"])
            return {"id": message["id"], "result": {}}

        backend = ChromeCDPBackend(
            tab_id="tab-1",
            get_json=lambda path: tabs if path == "/json" else None,
            send_ws=fake_ws_send,
            capture_ws=fake_capture,
            file_chooser_ws=fake_chooser,
        )

        wheel = asyncio.run(
            backend.execute_async(
                BrowserAction(kind="capture", capture_mode="wheel", wheels=[{"x": 12, "y": 34, "delta_y": 800}])
            )
        )
        reload_result = asyncio.run(backend.execute_async(BrowserAction(kind="reload")))
        with tempfile.TemporaryDirectory() as tmp:
            upload_file = Path(tmp) / "a.csv"
            upload_file.write_text("id\n1\n", encoding="utf-8")
            chooser = asyncio.run(
                backend.execute_async(
                    BrowserAction(kind="upload_chooser", clicks=[{"x": 1, "y": 2}], files=[str(upload_file)])
                )
            )

        self.assertTrue(wheel.ok)
        self.assertIn("mouseWheel", [item["params"]["type"] for item in captured_triggers])
        self.assertTrue(reload_result.ok)
        self.assertIn("Page.reload", sent_methods)
        self.assertTrue(chooser.ok)
        self.assertEqual(chooser_calls[0][0], [{"x": 1, "y": 2}])
        self.assertEqual(chooser_calls[0][1], [str(upload_file.resolve())])

    def test_chrome_cdp_backend_rejects_missing_file_chooser_files_before_cdp(self):
        backend = ChromeCDPBackend(tab_id="tab-1", get_json=lambda path: [])

        result = asyncio.run(
            backend.execute_async(
                BrowserAction(kind="upload_chooser", clicks=[{"x": 1, "y": 2}], files=["/tmp/not-present-crawshrimp.csv"])
            )
        )

        self.assertFalse(result.ok)
        self.assertIn("upload file not found", result.error)

    def test_chrome_cdp_backend_browser_session_download_uses_temp_tab(self):
        closed = []
        browser_download_calls = []

        async def fake_browser_download(ws_url, url, download_path, timeout_seconds):
            browser_download_calls.append((ws_url, url, Path(download_path), timeout_seconds))
            Path(download_path).mkdir(parents=True, exist_ok=True)
            (Path(download_path) / "export.xlsx").write_bytes(b"xlsx")
            return {"id": 1, "result": {}}

        backend = ChromeCDPBackend(
            tab_id="main",
            get_json=lambda path: [],
            browser_download_ws=fake_browser_download,
            new_tab=lambda url: {
                "id": "tmp",
                "type": "page",
                "url": url,
                "webSocketDebuggerUrl": "ws://example.test/devtools/page/tmp",
            },
            close_tab=lambda tab_id: closed.append(tab_id),
        )

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "final.xlsx"
            result = asyncio.run(
                backend.download_browser_session(
                    {"url": "https://example.test/export.xlsx"},
                    target,
                    2,
                )
            )

            self.assertTrue(result["success"])
            self.assertEqual(target.read_bytes(), b"xlsx")
            self.assertTrue(result["browserSession"])
            self.assertEqual(closed, ["tmp"])
            self.assertEqual(browser_download_calls[0][0], "ws://example.test/devtools/page/tmp")
            self.assertEqual(browser_download_calls[0][1], "https://example.test/export.xlsx")
            self.assertTrue(browser_download_calls[0][2].name.startswith("crawshrimp-skill-browser-download-"))

    def test_browser_session_download_never_moves_an_unrelated_home_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_home = Path(tmp) / "home"
            downloads = fake_home / "Downloads"
            downloads.mkdir(parents=True)

            async def fake_browser_download(_ws_url, _url, _download_path, _timeout_seconds):
                (downloads / "unrelated.pdf").write_bytes(b"personal")
                return {"id": 1, "result": {}}

            backend = ChromeCDPBackend(
                tab_id="main",
                get_json=lambda path: [],
                browser_download_ws=fake_browser_download,
                new_tab=lambda url: {
                    "id": "tmp",
                    "type": "page",
                    "url": url,
                    "webSocketDebuggerUrl": "ws://example.test/devtools/page/tmp",
                },
                close_tab=lambda _tab_id: None,
            )
            target = Path(tmp) / "final.xlsx"
            with patch("scripts.browser_executor.Path.home", return_value=fake_home):
                result = asyncio.run(backend.download_browser_session(
                    {"url": "https://example.test/export.xlsx"},
                    target,
                    1,
                ))

            self.assertFalse(result["success"])
            self.assertFalse(target.exists())
            self.assertEqual((downloads / "unrelated.pdf").read_bytes(), b"personal")


if __name__ == "__main__":
    unittest.main()
