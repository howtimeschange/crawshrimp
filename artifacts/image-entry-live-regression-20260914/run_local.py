"""Opt-in real-provider regression; executes product routes/functions, never mocks generation."""
import os,sys,json,time,hashlib,threading,shutil,asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
if os.environ.get('CRAWSHRIMP_REAL_IMAGE_REGRESSION') != '1':raise SystemExit('Real paid calls require CRAWSHRIMP_REAL_IMAGE_REGRESSION=1')
REPO=Path(__file__).resolve().parents[2];sys.path.insert(0,str(REPO))
OUT=Path(__file__).resolve().parent
DATA=Path('/tmp/crawshrimp-entry-live-regression-20260914')
DATA.mkdir(parents=True,exist_ok=True);os.chmod(DATA,0o700)
os.environ['CRAWSHRIMP_DATA']=str(DATA)
if not (DATA/'config.json').exists():
    config=json.loads(Path('/tmp/crawshrimp-image-acceptance/config.json').read_text())
    # Isolated credentials/config only; no jobs, account sessions or notification configuration.
    (DATA/'config.json').write_text(json.dumps({'ai':{k:config.get('ai',{}).get(k,{}) for k in ['woka','semir']}}))
    os.chmod(DATA/'config.json',0o600)
from core import api_server as api,data_sink,ai_image_service as svc,bala_ai_model_library as library,buyer_show_service as buyer
import urllib.request, urllib.error
import uvicorn
from PIL import Image,ImageDraw
data_sink.init_db()
from core import adapter_loader
adapter_loader.install_from_dir(str(REPO/"adapters/bala-ai-video-assistant"),install_mode="link")
adapter_loader.scan_all()
PORT=int(os.environ.get('ENTRY_REGRESSION_PORT','18997'))
server=uvicorn.Server(uvicorn.Config(api.app,host='127.0.0.1',port=PORT,log_level='error',lifespan='off'))
threading.Thread(target=server.run,daemon=True).start()
while not server.started:time.sleep(.05)
TOKEN=api._get_api_token()
module=api._load_tmall_ai_image_chain_module()
MODELS=[p+'/'+m for p in ['woka','semir'] for m in ['gpt-image-2','gemini-3.1-flash-image-preview','gemini-3-pro-image-preview']]
models=library.load_model_library()['items'];model_item=models[0];source=library.resolve_model_image_path(model_item['id']);face_id=models[1]['id']
garment=DATA/'fixture-shirt.png'
if not garment.exists():
    im=Image.new('RGB',(768,768),'white');draw=ImageDraw.Draw(im);draw.polygon([(220,180),(320,140),(350,190),(418,190),(448,140),(548,180),(650,320),(535,385),(495,315),(495,630),(273,630),(273,315),(233,385),(118,320)],fill='#4b89c8');im.save(garment)
LOCK=threading.Lock()
SECRETS=[str(v) for c in json.loads((DATA/'config.json').read_text()).get('ai',{}).values() for k,v in c.items() if 'key' in k and v]
def clean(value):
    text=str(value)
    for s in SECRETS:text=text.replace(s,'[redacted]')
    return text[:800]
# Observe real transport metadata without recording credentials, image bytes or signed URLs.
from core import image_providers
_real_transport=image_providers._compatible_transport
def observed_transport(method,url,**kwargs):
    try:
        status,result=_real_transport(method,url,**kwargs)
        safe={'status':status,'host':urllib.parse.urlsplit(url).hostname,'model':(kwargs.get('body') or {}).get('model') if isinstance(kwargs.get('body'),dict) else '', 'response_keys':list(result),'error':clean(result.get('error','')),'prompt_feedback':result.get('promptFeedback'),'candidates':[{'finishReason':x.get('finishReason'),'part_types':[list(p) for p in (x.get('content') or {}).get('parts',[])]} for x in result.get('candidates',[])]}
        with LOCK:
            with (OUT/'transport-metadata.jsonl').open('a') as f:f.write(json.dumps(safe,ensure_ascii=False)+'\n')
        return status,result
    except Exception as e:
        with LOCK:
            with (OUT/'transport-metadata.jsonl').open('a') as f:f.write(json.dumps({'host':urllib.parse.urlsplit(url).hostname,'error':clean(e)})+'\n')
        raise
image_providers._compatible_transport=observed_transport

def request(method,path,payload=None):
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(f'http://127.0.0.1:{PORT}'+path,data=data,method=method,headers={'X-Crawshrimp-Token':TOKEN,'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=1200) as res:return json.load(res)
    except urllib.error.HTTPError as e:raise RuntimeError(f'HTTP {e.code}: '+clean(e.read().decode())) from None
def checked(paths):
    result=[]
    for p in dict.fromkeys(str(p) for p in paths if p):
        f=Path(p)
        with Image.open(f) as im:
            size=list(im.size);im.verify()
        result.append({'path':str(f),'bytes':f.stat().st_size,'size':size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    return result
def urls(summary):
    found=[]
    for s in [summary,*summary.get('runs',[])]:found.extend(s.get('image_urls') or [])
    return list(dict.fromkeys(found))
def job_result(uid,expected=1):
    deadline=time.time()+900
    while True:
        job=request('GET','/ai-image/jobs/'+uid);s=job.get('summary') or {}
        if job.get('status') not in ['running','queued','generating','submitted'] and not any(r.get('status') in ['queued','submitted','running'] for r in s.get('runs',[])):break
        if time.time()>deadline:raise RuntimeError('Job polling timeout; do not resubmit')
        time.sleep(2)
    paths=[]
    for url in urls(s):
        mat=request('POST',f'/ai-image/jobs/{uid}/materialize',{'url':url});paths.append(mat.get('path'))
    files=checked(paths)
    return {'ok':len(files)==expected,'job_uid':uid,'status':job.get('status'),'model_key':job.get('model_key'),'expected':expected,'files':files,'error':clean(s.get('error','')),'error_code':s.get('error_code'),'runs':[{'status':r.get('status'),'error':clean(r.get('error','')),'error_code':r.get('error_code'),'attempts':r.get('submission_attempts'),'model_key':r.get('model_key')} for r in s.get('runs',[])]}
def workbench(model,batch=False,edit=False):
    prompt='Create a clean ecommerce photograph of a blue ceramic mug on a light grey table, square composition, no text.'
    params={'size':'1024x1024','quality':'low','ratio':'1:1','output_format':'png','n':1}
    if edit:
        prompt='保持主图人物和服装，将背景改为浅灰色摄影棚。'
        params['input_assets']=[{'path':str(source),'role':'main','name':source.name},{'path':str(garment),'role':'reference','name':garment.name}]
    payload={'title':'真实回归 '+model,'model_key':model,'prompt':prompt,'output_dir':str(DATA/'outputs'),'params':params}
    job=request('POST','/ai-image/jobs',payload);uid=job['job_uid']
    if batch:request('POST',f'/ai-image/jobs/{uid}/batch-run',{'request_uid':f'live-{uid}','input_snapshot':payload,'prompts':[{'title':'杯子一','prompt':prompt,'count':1},{'title':'杯子二','prompt':prompt+' Add one green leaf beside the mug.','count':1}]})
    else:request('POST',f'/ai-image/jobs/{uid}/run',payload)
    result=job_result(uid,2 if batch else 1);after=request('GET','/ai-image/jobs/'+uid)
    result['input_preserved']=after['prompt']==prompt
    return result
async def noop(*args):pass
def video(model,operation):
    params={'source_images':{'paths':[str(source)]},'model':model,'model_ref_ids':[face_id],'operation_type':operation,'background_prompt':'浅灰色摄影棚背景，保持人物和服装','pose_prompt':'保持服装和人物，双手自然垂下，正面站立','garment_images':{'paths':[str(garment)]},'image_size':'1024x1024','ratio':'1:1','quality':'low','output_format':'png','workspace_dir':str(DATA/('video-'+model.replace('/','-')+'-'+operation)),'generation_mode':'submit_async','max_combinations':1}
    rows=asyncio.run(api._apply_bala_ai_face_background_generate(params,noop,lambda *a:None))
    uid=next((r.get('AI任务UID') for r in rows if r.get('AI任务UID')),None)
    if not uid:raise RuntimeError(clean(rows))
    return job_result(uid)
def buyer_run(model):
    out=DATA/('buyer-'+model.replace('/','-'))
    row={'款色号':'TEST00001','唯一值':model,'模拍本地文件':str(source),'平铺本地文件':str(garment),'本地图包文件夹':str(out),'部位':'upper','模拍云盘路径':'fixtures/model-library/'+source.name,'平铺云盘路径':'fixtures/fixture-shirt.png'}
    old=OUT/('buyer-show--'+model.replace('/','--')+'.json')
    previous=json.loads(old.read_text()) if old.exists() else {}
    if previous.get('job_uid') and 'material usage' in previous.get('error',''):
        saved=data_sink.get_ai_image_job(previous['job_uid']);row.update({'AI任务ID':previous['job_uid'],'__generation_urls':urls(saved.get('summary') or {}),'__generation_prompt':saved['prompt'],'生图结果':'待落图'})
        result=buyer._materialize_buyer_show_generation_row(row,run_params={},log=lambda *a:None)
        return {'ok':result.get('生图结果')=='已生成','job_uid':previous['job_uid'],'status':result.get('生图结果'),'error':clean(result.get('备注','')),'files':checked(str(result.get('生图文件') or '').splitlines()),'reused_paid_generation':True}
    result=buyer._generate_buyer_show_row(row,run_params={'model_id':model,'image_size':'1024x1024','quality':'low','output_format':'png','prompt_extra':'请只更换蓝色T恤，保持自然穿着。'},settings=api._resolve_one_xm_settings(),log=lambda *a:None)
    return {'ok':result.get('生图结果')=='已生成','job_uid':result.get('AI任务ID'),'status':result.get('生图结果'),'error':clean(result.get('备注','')),'files':checked(str(result.get('生图文件') or '').splitlines())}
def tmall(model,mode):
    seed_file=OUT/('workbench-edit--'+model.replace('/','--')+'.json')
    seed=json.loads(seed_file.read_text()) if seed_file.exists() else {}
    if not seed.get('ok'):raise RuntimeError('Prerequisite edited image unavailable; skip rather than fake generated source')
    generated_source=Path(seed['files'][0]['path'])
    uid=('live-'+mode+'-'+model.replace('/','-'));folder=DATA/uid;folder.mkdir(exist_ok=True)
    row={'模型':model,'尺寸':'1024x1024','质量':'low','格式':'png','生成数量':1,'最终提示词':'保持人物和服装，换成浅灰色摄影棚背景。','__1xm_reference_paths':[str(generated_source)]}
    batch={'batch_id':uid,'token':'isolated-live-regression','status':'pending_approval','artifact_dir':str(folder),'json_path':str(DATA/f'tmall-ai-image-approval-batch-{uid}.json'),'board_path':str(folder/'board.html'),'run_params':{'model':model,'image_size':'1024x1024','quality':'low','output_format':'png','one_xm_key_tier':'2k'},'items':[{'id':'item','style_code':'TEST00001','item_id':'fixture','category':'上装','workflow':{'row_no':2,'style_code':'TEST00001','item_id':'fixture','category':'上装','gender':'女'},'assets':[{'id':'origin','kind':'origin','path':str(generated_source)},{'id':'previous','kind':'ai','path':str(generated_source),'status':'approved','label':'回归测试种子图','generation_row':row,'reference_paths':[str(generated_source)]}]}]}
    module.save_approval_batch(batch)
    base=f'/tmall-ai-image-approval/api/{uid}'
    if mode=='face-swap':payload={'asset_id':'previous','model_id':face_id,'instruction':'保持自然表情，服装不变'}
    elif mode=='regenerate':payload={'asset_id':'previous','prompt':row['最终提示词'],'reference_paths':[str(generated_source)]}
    else:payload={'item_id':'item','style_code':'TEST00001','prompt':row['最终提示词'],'main_image_path':str(generated_source),'reference_paths':[]}
    response=request('POST',base+'/'+mode+'?token=isolated-live-regression',payload)
    asset=response['asset'];saved=json.loads(Path(batch['json_path']).read_text());assets=saved['items'][0]['assets']
    return {'ok':bool(asset.get('path')),'asset_id':asset.get('id'),'status':asset.get('status'),'source_asset_id':asset.get('source_asset_id'),'model_id':asset.get('model_id'),'asset_count':len(assets),'original_preserved':next(a for a in assets if a['id']=='previous')['path']==str(generated_source),'files':checked([asset.get('path')]),'model_key':(asset.get('generation_row',{}).get('__1xm_payload') or {}).get('model')}
def tmall_plan(model):
    workflow=module.WorkflowItem(2,'TEST00001','','上装','女',custom_fields={'自定义1':'创意拍','自定义10':'浅灰色摄影棚'})
    templates=module.prompt_items_from_cloud_templates([{'group_name':'创意拍','field_name':'真实回归','prompt':'保持人物与服装不变，背景改为 {{自定义10}}，自然光线。','custom_fields':workflow.custom_fields}])
    selected=module.select_prompts(workflow,templates,1)
    if len(selected)!=1:raise RuntimeError('Custom-field prompt matching failed before generation')
    row=module.make_generation_row(workflow,selected[0],[str(source)],image_size='1024x1024',quality='low',output_format='png',key_tier='2k',model=model,ratio='1:1',run_nonce='live-regression')
    result=asyncio.run(api._apply_tmall_ai_image_generation([row],{'execute_mode':'generate','max_generate_jobs':1,'generation_concurrency':1},noop,lambda *a:None))[0]
    paths=module.download_generated_images(result,DATA/('tmall-plan-'+model.replace('/','-')))
    return {'ok':bool(paths),'status':result.get('执行结果'),'error':clean(result.get('备注','')),'files':checked(paths),'custom_fields':workflow.custom_fields,'resolved_prompt':row['最终提示词'],'model_key':row['__1xm_payload']['model']}

def cloud_machine(model):
    from core.cloud_job_executors import CloudJobExecutor
    class LocalStorageReceipt:
        # Local fixture for cloud storage/lease only. The executor and provider are real.
        def __init__(self):self.uploads=[]
        def download_asset(self,uid,target,**kwargs):
            target=Path(target);shutil.copy2(source if uid=='source' else garment,target);return target
        def request_json(self,method,path,body=None,**kwargs):
            return {'upload_url':'fixture://'+body['asset_uid'],'object_key':'fixture/'+body['asset_uid']} if path=='/api/assets/presign' else {'ok':True}
        def upload_asset(self,url,path,content_type):
            dest=DATA/'cloud-machine-receipts'/Path(path).name;dest.parent.mkdir(exist_ok=True);shutil.copy2(path,dest);self.uploads.append(str(dest));return {'ok':True}
    storage=LocalStorageReceipt();uid='cloud-machine-'+model.replace('/','-')
    executor=CloudJobExecutor(storage,DATA/'cloud-jobs',tmall_module=module)
    result=executor.execute({'job_uid':uid,'lease_id':'local-fixture','job_type':'generate_ai_image','payload':{'batch_uid':uid,'style_id':1,'style_code':'TEST00001','item_id':'fixture','source_asset_uid':'source','reference_asset_uids':[],'result_asset_uids':['result-'+uid],'model':model,'size':'1024x1024','ratio':'1:1','quality':'low','output_format':'png','count':1,'prompt_text':'保持人物与衣服不变，背景改为浅灰色摄影棚。'}})
    return {'ok':result.get('status')=='succeeded','files':checked(storage.uploads),'model_key':model,'cloud_control_plane':'local storage and lease fixture, NOT deployed cloud enrollment/dispatch/upload','status':result.get('status')}

def manual_retry(model):
    # Real provider authentication rejection, then normal retry route with saved valid config.
    # Deliberately invalid key is confined to this request, never persisted to user settings.
    import copy
    settings=copy.deepcopy(api._resolve_one_xm_settings())
    provider,canonical=model.split('/',1)
    bad='invalid-regression-key-not-a-real-credential'
    if provider=='woka':settings['ai.woka.api_key']=bad
    else:settings['ai.semir.gemini_api_key' if canonical.startswith('gemini') else 'ai.semir.gpt_api_key']=bad
    job=request('POST','/ai-image/jobs',{'title':'真实401后手动重试 '+model,'prompt':'A blue ceramic mug on white background, product photo.','model_key':model,'params':{'size':'1024x1024','quality':'low','ratio':'1:1','n':1,'output_format':'png'}})
    uid=job['job_uid']
    svc.submit_workbench_batch(uid,[{'prompt':job['prompt'],'count':1}],settings=settings,request_uid='auth-rejection-'+uid)
    saved=request('GET','/ai-image/jobs/'+uid);run=saved['summary']['runs'][0]
    if run['status']!='failed':raise RuntimeError('Invalid key was unexpectedly accepted; do not duplicate a successful request')
    first_error=clean(run.get('error',''));first_attempts=run.get('submission_attempts')
    request('POST',f"/ai-image/jobs/{uid}/runs/{run['run_uid']}/retry",{})
    result=job_result(uid);result.update({'initial_error':first_error,'initial_attempts':first_attempts,'fault_injection':'deliberate invalid credential sent to actual provider; retry uses saved valid key'})
    return result

def run_case(surface,model,fn):
    path=OUT/(surface+'--'+model.replace('/','--')+'.json')
    if path.exists():
        old=json.loads(path.read_text())
        if not (surface=='buyer-show' and not old.get('ok') and 'material usage' in old.get('error','')):return
        archive=OUT/'precondition-failures';archive.mkdir(exist_ok=True);(archive/path.name).write_text(path.read_text())
    started=time.time()
    try:r=fn(model)
    except Exception as e:r={'ok':False,'error':clean(e)}
    r.update(surface=surface,model=model,seconds=round(time.time()-started,2),generation_transport='real provider; no mocked executor')
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2))
    with LOCK:print(json.dumps({k:r[k] for k in ['surface','model','ok','seconds']}),flush=True)
if __name__=='__main__':
    phase=sys.argv[1] if len(sys.argv)>1 else 'workbench'
    groups={'workbench':[('workbench-single',lambda m:workbench(m)),('workbench-batch',lambda m:workbench(m,batch=True)),('workbench-edit',lambda m:workbench(m,edit=True))], 'video':[(f'video-{op}',lambda m,op=op:video(m,op)) for op in ['background_swap','face_swap','outfit_swap','pose_swap']], 'buyer':[('buyer-show',buyer_run)],'tmall':[(f'tmall-{op}',lambda m,op=op:tmall(m,op)) for op in ['generate','regenerate','face-swap']]}
    groups['extra']=[('tmall-plan',tmall_plan),('cloud-machine',cloud_machine)]
    groups['retry']=[('manual-retry',manual_retry)]
    groups['recovery']=[('video-face_swap',lambda m:video(m,'face_swap')),('buyer-show',buyer_run)]
    groups['remaining']=groups['video']+groups['buyer']+groups['tmall']
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending=[pool.submit(run_case,label,model,fn) for label,fn in groups[phase] for model in MODELS]
        for done in as_completed(pending):done.result()
