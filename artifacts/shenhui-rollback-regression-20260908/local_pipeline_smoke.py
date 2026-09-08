"""Local integration: real loader, task pipeline, JS, PDF, ZIP, Excel and SQLite.
The browser transport alone is replaced with a Node VM and an about:blank tab.
"""
import asyncio
import io
import json
import os
import shutil
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path(__file__).resolve().parent
DATA = EVIDENCE / 'isolated-data'
os.environ['CRAWSHRIMP_DATA'] = str(DATA)
os.environ['CRAWSHRIMP_ALLOW_DATA_FALLBACK'] = '0'

import fitz
from PIL import Image
from openpyxl import load_workbook
from core import adapter_loader, api_server, data_sink
from core.js_runner import JSRunner
from core.models import JSResult

NODE = shutil.which('node')
assert NODE
NODE_VM = '''const vm=require('node:vm'),fs=require('node:fs');
const c={console,location:{href:'about:blank'},sessionStorage:{setItem(){},getItem(){return null},removeItem(){}}};c.window=c;
Promise.resolve(vm.runInNewContext(fs.readFileSync(0,'utf8'),c,{timeout:5000})).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1});'''

class LocalBridge:
    def get_tab(self, tab_id):
        return {'id':'local-smoke', 'type':'page', 'url':'about:blank', 'webSocketDebuggerUrl':'ws://unused.invalid'}
    def get_tabs(self): return [self.get_tab('local-smoke')]
    def new_tab(self, url):
        assert url == 'about:blank', url
        return self.get_tab('local-smoke')
    def find_tab(self, url): return self.get_tab('local-smoke')
    def get_tab_ws_url(self, tab): return tab['webSocketDebuggerUrl']

class LocalJSRunner(JSRunner):
    async def _refresh_ws_url(self): pass
    async def evaluate(self, expression, **kwargs):
        child = await asyncio.create_subprocess_exec(NODE, '-e', NODE_VM,
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(child.communicate(expression.encode()), 10)
        assert child.returncode == 0, stderr.decode()
        return JSResult(**json.loads(stdout))

async def main():
    installed = DATA / 'adapters' / 'shenhui-new-arrival'
    installed.parent.mkdir(parents=True,exist_ok=True)
    if not installed.exists(): installed.symlink_to(ROOT/'adapters/shenhui-new-arrival',target_is_directory=True)
    data_sink.init_db()
    manifests = adapter_loader.scan_all()
    assert len(manifests) == 1
    manifest = manifests[0]
    assert len(manifest.tasks) == 5
    listed = api_server.list_tasks()
    assert len(listed) == 5
    # Admission runs for every real manifest task; suppress business launch only.
    with patch.object(api_server, '_launch_task_run_background', return_value={'ok':True}) as launch:
        for task in manifest.tasks:
            assert (await api_server._start_task_run(manifest.id, task.id))['ok']
        assert launch.call_count == 5
    inputs = EVIDENCE/'sample-inputs'; inputs.mkdir(exist_ok=True)
    for name in ('hang-tag.pdf','wash-label.pdf'):
        doc=fitz.open();page=doc.new_page(width=300,height=400)
        page.insert_text((30,50),'Style 201226109105 Color 00322',fontsize=12)
        page.insert_text((30,90),name,fontsize=14)
        page.draw_rect(fitz.Rect(25,25,275,375),color=(0,0,0),width=2)
        doc.save(inputs/name);doc.close()
    params = {
        'tag_pdf_files':[str(inputs/'hang-tag.pdf')],
        'wash_pdf_files':[str(inputs/'wash-label.pdf')],
        'package_name':'rollback-local-smoke',
        'style_color_overrides':'hang-tag.pdf=201226109105-00322\nwash-label.pdf=201226109105-00322',
        'tag_crop_boxes':'[{"x":0,"y":0,"width":1,"height":1}]',
        'wash_crop_boxes':'[{"x":0,"y":0,"width":1,"height":1}]',
    }
    with patch.object(api_server,'get_bridge',return_value=LocalBridge()), patch('core.js_runner.JSRunner',LocalJSRunner):
        await api_server._execute_task(manifest.id,'pdf_batch_screenshot',params,run_control=api_server._build_run_control())
    run = data_sink.get_latest_run(manifest.id,'pdf_batch_screenshot')
    assert run['status'] == 'done',run
    assert run['records_count'] == 2,run
    outputs=json.loads(run['output_files'])
    archives=[Path(p) for p in outputs if p.endswith('.zip')]
    sheets=[Path(p) for p in outputs if p.endswith('.xlsx')]
    assert archives and sheets,outputs
    images=[]
    with zipfile.ZipFile(archives[0]) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.endswith('.png'):
                with Image.open(io.BytesIO(archive.read(name))) as im:
                    im.load();assert im.width>0 and im.height>0
                    images.append({'name':name,'size':list(im.size)})
    assert any(i['name'].endswith('yq(1).png') for i in images),images
    assert any(i['name'].endswith('yq(2).png') for i in images),images
    book=load_workbook(sheets[0],read_only=True); rows=list(book.active.values);book.close()
    assert len(rows)==3,rows
    assert all(row[3]=='截图完成' for row in rows[1:]),rows
    result={'ok':True,'tasks_loaded':[t.id for t in manifest.tasks],'task_admission_passed':5,
        'pdf_pipeline_status':run['status'],'records':run['records_count'],'output_files':outputs,
        'images':images,'excel_rows':len(rows)-1,
        'boundary':'Browser transport simulated with Node VM; real PDF/ZIP/Excel/SQLite. No external upload or AI calls.'}
    (EVIDENCE/'local-pipeline-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))

asyncio.run(main())
