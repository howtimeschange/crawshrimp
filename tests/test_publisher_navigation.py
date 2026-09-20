import asyncio
import json
import unittest
from unittest.mock import patch

from core.js_runner import JSRunner


class PublisherSocket:
    def __init__(self, dialog='beforeunload', load=True, error=None):
        self.dialog = dialog
        self.load = load
        self.error = error
        self.messages = asyncio.Queue()
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def emit(self, message):
        self.messages.put_nowait(json.dumps(message))

    def loaded(self):
        for frame, loader in [('child', 'new'), ('main', 'old')]:
            self.emit({'method': 'Page.lifecycleEvent', 'params': {
                'name': 'load', 'frameId': frame, 'loaderId': loader}})
        if self.load:
            self.emit({'method': 'Page.lifecycleEvent', 'params': {
                'name': 'load', 'frameId': 'main', 'loaderId': 'new'}})

    async def send(self, raw):
        message = json.loads(raw)
        self.sent.append(message)
        method = message['method']
        result = {}
        if method == 'Page.getFrameTree':
            result = {'frameTree': {'frame': {
                'id': 'main', 'loaderId': 'old', 'url': 'https://publisher.test/'}}}
        if method in ('Page.reload', 'Page.navigate'):
            if self.error:
                self.emit({'id': message['id'], 'result': {'errorText': self.error}})
                return
            if self.dialog:
                self.emit({'method': 'Page.javascriptDialogOpening', 'params': {'type': self.dialog}})
            else:
                self.loaded()
        if method == 'Page.handleJavaScriptDialog':
            self.loaded()
        self.emit({'id': message['id'], 'result': result})

    async def recv(self):
        if self.messages.empty():
            raise asyncio.TimeoutError()
        return await self.messages.get()


class PublisherNavigationTests(unittest.IsolatedAsyncioTestCase):
    async def navigate(self, socket, url='https://publisher.test/'):
        runner = JSRunner('ws://example.invalid')
        runner._page_file_cache_keys = {'old-file'}
        with patch('core.js_runner.websockets.connect', return_value=socket):
            await runner._navigate_publisher(url)
        self.assertEqual(runner._page_file_cache_keys, set())

    async def test_reload_accepts_beforeunload_and_waits_for_new_document(self):
        socket = PublisherSocket()
        await self.navigate(socket)
        methods = [item['method'] for item in socket.sent]
        self.assertIn('Page.reload', methods)
        self.assertEqual([item['params'] for item in socket.sent
                          if item['method'] == 'Page.handleJavaScriptDialog'], [{'accept': True}])

    async def test_different_url_navigates_without_dialog(self):
        socket = PublisherSocket(dialog=None)
        await self.navigate(socket, 'https://other.test/')
        self.assertIn('Page.navigate', [item['method'] for item in socket.sent])

    async def test_unrelated_dialog_is_not_accepted(self):
        socket = PublisherSocket(dialog='confirm')
        with self.assertRaisesRegex(RuntimeError, '非离开确认'):
            await self.navigate(socket)
        self.assertNotIn('Page.handleJavaScriptDialog', [item['method'] for item in socket.sent])

    async def test_old_document_and_child_load_do_not_allow_upload(self):
        with self.assertRaisesRegex(RuntimeError, '未确认新页面'):
            await self.navigate(PublisherSocket(load=False))

    async def test_navigation_error_stops_without_retry(self):
        socket = PublisherSocket(error='net::ERR_ABORTED')
        with self.assertRaisesRegex(RuntimeError, 'ERR_ABORTED'):
            await self.navigate(socket)
        self.assertEqual(sum(item['method'] == 'Page.reload' for item in socket.sent), 1)

class PublisherActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_state_is_saved_before_navigation_and_failure_does_not_advance(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import AsyncMock
        from core.models import JSResult

        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                script = Path(directory) / 'publisher.js'
                script.write_text('/* mocked phase results */')
                runner = JSRunner('ws://example.invalid')
                runner._persist_run_params = AsyncMock()
                runner._clear_run_params = AsyncMock()
                runner._refresh_ws_url = AsyncMock()
                state = {'results': [{'contentId': '123'}], 'job_index': 1}
                runner.evaluate_with_reconnect = AsyncMock(side_effect=[
                    JSResult(success=True, data=[], meta={
                        'action': 'navigate_publisher', 'url': 'https://publisher.test/',
                        'next_phase': 'wait_guang_page', 'shared': state}),
                    JSResult(success=True, data=[], meta={'action': 'complete'}),
                ])

                async def navigate(url):
                    self.assertEqual(runner.last_runtime_shared, state)
                    if fail:
                        raise RuntimeError('navigation failed')

                runner._navigate_publisher = AsyncMock(side_effect=navigate)
                if fail:
                    with self.assertRaisesRegex(RuntimeError, 'navigation failed'):
                        await runner.run_script_file(script)
                    self.assertEqual(runner.evaluate_with_reconnect.call_count, 1)
                else:
                    await runner.run_script_file(script)
                    self.assertEqual(runner.evaluate_with_reconnect.call_count, 2)
                    self.assertIn('"wait_guang_page"', runner.evaluate_with_reconnect.call_args.args[0])
                runner._navigate_publisher.assert_awaited_once()
