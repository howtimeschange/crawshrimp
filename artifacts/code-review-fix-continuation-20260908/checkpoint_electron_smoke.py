"""Real isolated Chromium/CDP smoke: no business platform or user browser."""
import asyncio
import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

from core.execution_checkpoint import execution_checkpoint
from core.cloud_job_executors import CloudJobCancelled
from core.js_runner import JSRunner

repo = Path(__file__).resolve().parents[2]
electron = repo / 'app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
with tempfile.TemporaryDirectory(prefix='crawshrimp-checkpoint-') as temporary:
    root = Path(temporary)
    script = root / 'main.cjs'
    script.write_text("const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{global.win=new BrowserWindow({show:false}); win.loadURL('data:text/html,<title>Checkpoint Test</title>')});")
    with socket.socket() as port_socket:
        port_socket.bind(('127.0.0.1', 0))
        port = port_socket.getsockname()[1]
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    with (root / 'electron.log').open('w') as log:
        process = subprocess.Popen([str(electron), f'--remote-debugging-port={port}',
                                    f'--user-data-dir={root / "profile"}', str(script)], env=env,
                                   stdout=log, stderr=log)
        try:
            endpoint = None
            for _ in range(100):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=.5) as response:
                        tabs = json.load(response)
                    endpoint = next(tab['webSocketDebuggerUrl'] for tab in tabs if tab['type'] == 'page')
                    break
                except Exception:
                    time.sleep(.1)
            assert endpoint, (root / 'electron.log').read_text()
            async def verify():
                runner = JSRunner(endpoint, timeout=5)
                checks = []
                def guard():
                    checks.append(len(checks) + 1)
                    if len(checks) >= 5:
                        raise CloudJobCancelled('cancel before second write')
                with execution_checkpoint(guard):
                    # Context entry, evaluate and raw checks precede binding checks.
                    # Permit the first in-browser request; deny the second.
                    checks.clear()
                    result = await runner.evaluate('''/* crawshrimp:checkpoints */(async () => {
                        globalThis.reviewWrites = [];
                        await __crawshrimpCheckpoint();
                        globalThis.reviewWrites.push('receipt-one');
                        await __crawshrimpCheckpoint();
                        globalThis.reviewWrites.push('receipt-two');
                        return {success: true, data: []};
                    })()''')
                readback = await runner.evaluate('({success:true,data:globalThis.reviewWrites})')
                assert not result.success, result
                assert readback.data == ['receipt-one'], (checks, result, readback)
                print(json.dumps({'checkpoints': checks, 'receipts': readback.data,
                                  'later_write_blocked': True}, ensure_ascii=False))
                module = ast.parse((repo / 'adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py').read_text())
                body = next(ast.literal_eval(node.value) for node in module.body if isinstance(node, ast.Assign)
                            and any(isinstance(target, ast.Name) and target.id == 'TMALL_UPLOAD_CREATE_JS' for target in node.targets))
                await runner.evaluate('''(async () => {
                    Object.defineProperty(document, 'cookie', {get: () => '', configurable:true});
                    globalThis.reviewUploads = [];
                    const originalFetch = globalThis.fetch;
                    globalThis.fetch = async (url, init) => {
                        if (String(url).startsWith('data:')) return originalFetch(url, init);
                        if (!String(url).startsWith('https://stream-upload.taobao.com/')) throw new Error('Network disabled');
                        globalThis.reviewUploads.push(init.body.get('name'));
                        return {ok:true, text: async () => JSON.stringify({success:true,object:{url:'https://example.invalid/receipt.jpg'}})};
                    };
                    window.lib = {mtop:{request: async () => {throw new Error('No platform request allowed')}}};
                    return {success:true,data:[]};
                })()''')
                payload = {'item_id': 'review', 'live_upload': True, 'live_create': False, 'files': [
                    {'name': name, 'dataUrl': 'data:image/png;base64,aGk=', 'role': 'ai'} for name in ['one.png', 'two.png']]}
                expression = '/* crawshrimp:checkpoints */(async()=>{const __payload=' + json.dumps(payload) + ';\n' + body + '\n})()'
                checks.clear()
                with execution_checkpoint(guard):
                    checks.clear()
                    actual = await runner.evaluate(expression)
                uploads = await runner.evaluate('({success:true,data:globalThis.reviewUploads})')
                assert actual.success, actual
                assert len(actual.data[0]['uploaded']) == 1, actual
                assert uploads.data == ['one.png'], uploads
                assert '已阻止后续提交' in actual.data[0]['error'], actual
                print(json.dumps({'actual_tmall_script': True, 'uploads': uploads.data,
                                  'saved_receipt_url': actual.data[0]['uploaded'][0]['url'],
                                  'second_upload_blocked': True}, ensure_ascii=False))
            asyncio.run(verify())
        finally:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
