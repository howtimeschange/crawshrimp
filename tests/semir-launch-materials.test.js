import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
async function run(script, phase='__exports__',shared={},extra={}){
 const box={},window={__CRAWSHRIMP_EXPORTS__:box,__CRAWSHRIMP_PHASE__:phase,__CRAWSHRIMP_SHARED__:shared,__CRAWSHRIMP_PARAMS__:extra.params||{}}
 const result=await vm.runInNewContext(fs.readFileSync(`adapters/semir-launch-assistant/${script}.js`,'utf8'),{window,location:{hostname:'scm.semir.com',pathname:'/scm-qc-third-test-report-index',origin:'https://scm.semir.com'},URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,...extra})
 return {result,box}
}
test('cloud requires typed explicit scopes and rejects traversal and prefix matching',async()=>{
 const {box}=await run('prepare-image-package')
 assert.throws(()=>box.parseSources('静物|森马bu-森马商品//../other'),/路径/)
 assert.throws(()=>box.parseSources('森马bu-森马商品//foo'),/格式|填写/)
 assert.equal(box.hasCode('1015261081129','101526108112'),false)
 assert.equal(box.hasCode('101526108112-00316','101526108112'),true)
 assert.equal(box.inScope('batch2/x','batch'),false)
})
test('SCM exact token matching, all attachments, unique paths, no signed query in result',async()=>{
 const {box}=await run('scm-material-download')
 assert.equal(box.matches('1015261081129','101526108112'),false)
 assert.equal(box.matches('101526108112/OTHER','101526108112'),true)
 const records=[1,2].map(n=>({ID:String(n),PRD_CODE:'101526108112',ORDER_NO:'same',QC_ATTACHMENT_LIST:[{FILE_URL:'https://scm.semir.com/file/a.pdf?token=private'}]}))
 const plan=box.plan(records,'101526108112')
 assert.equal(plan.items.length,2)
 assert.equal(new Set(plan.rows.map(r=>r.包内路径)).size,2)
 assert.doesNotMatch(JSON.stringify(plan.rows),/private/)
 assert.throws(()=>box.plan([{...records[0],PRD_CODE:'other'}],'101526108112'),/其他款号/)
})
test('SCM pagination continues until complete and retains accumulated rows',async()=>{
 const {result}=await run('scm-material-download','advance',{finishedStyle:false,page:1,rows:[{款号:'A'}]})
 assert.equal(result.meta.next_phase,'collect');assert.equal(result.meta.shared.page,2);assert.equal(result.meta.shared.rows.length,1)
})
test('missing downloader receipt is a failure, not downloaded',async()=>{
 const {result}=await run('scm-material-download','after_download',{rows:[],pending:[{款号:'A',__download_index:0}],downloads:{items:[]}})
 assert.equal(result.meta.shared.rows[0].下载结果,'下载失败')
})
test('cloud derives colors only from folders, preserving leading zero and conflicts',async()=>{
 const {box}=await run('prepare-image-package')
 assert.equal(box.colorOf('104526100003/本白10101/a.jpg','104526100003'),'10101')
 assert.equal(box.colorOf('104526100003/粉色调00316/a.jpg','104526100003'),'00316')
 assert.equal(box.colorOf('104526100003/a00316.jpg','104526100003'),'')
 assert.equal(box.colorOf('104526100003-00316/本白10101/a.jpg','104526100003'),'')
})
function fakeTable({fail=false,total=51,ids=['51'],style='101526108112'}={}){
 const events=new Map(),filters={}
 const parent={$data:{searchModel:{}},searchModel:{},$nextTick:async()=>{}}
 const table={$data:{},$parent:parent,sourceMyListData:[],config:{tableConfig:{pagination:{}}},
  $on:(k,f)=>events.set(k,f),$off:(k)=>events.delete(k),
  handleRequest:({pagination})=>{
   if(!fail){table.sourceMyListData=[];table.recordsTotal=total;table.myListData=ids.map(ID=>({ID,PRD_CODE:style,QC_ATTACHMENT_LIST:[]}));table.fetchTableConfig={fetchParams:{...parent.searchModel,start:(pagination.page-1)*50}}}
   events.get('triggerLoad')?.()
  }}
 const q={$props:{columns:[{name:'QC_ATTACHMENT_LIST'}]},$parent:table}
 return {document:{querySelectorAll:()=>[{__vue__:q}]}}
}
test('SCM last page is read and empty attachment records retained',async()=>{
 const state={styles:['101526108112'],index:0,page:2,filters:{},rows:[],recordIds:Array.from({length:50},(_,i)=>String(i+1)),readCount:50,expectedTotal:51}
 const {result}=await run('scm-material-download','collect',state,fakeTable())
 assert.equal(result.meta.shared.finishedStyle,true)
 assert.equal(result.meta.shared.pending[0].下载结果,'无附件')
 assert.equal(result.meta.shared.readCount,51)
})
test('SCM failed request with old rows never becomes no results',async()=>{
 const state={styles:['101526108112'],index:0,page:1,filters:{},rows:[],recordIds:[],readCount:0}
 const {result}=await run('scm-material-download','collect',state,fakeTable({fail:true}))
 assert.equal(result.meta.shared.rows[0].下载结果,'采集失败/不完整')
 assert.match(result.meta.shared.rows[0].备注,/未返回成功/)
})
test('SCM detects repeated pages and concurrent record-count change',async()=>{
 const state={styles:['101526108112'],index:0,page:2,filters:{},rows:[],recordIds:['51'],readCount:50,expectedTotal:51}
 const duplicate=(await run('scm-material-download','collect',state,fakeTable())).result
 assert.match(duplicate.meta.shared.rows[0].备注,/重复/)
 const changed=(await run('scm-material-download','collect',state,fakeTable({total:52}))).result
 assert.match(changed.meta.shared.rows[0].备注,/总数变化/)
})

test('still packages use explicit SKU fields and keep cloud writes inside the test directory', async () => {
 const {box} = await run('organize-still-image-package')
 const row = {上新季:'26Q3', 批次:'第8批', 款号:'101526116122', 款色:'10T52611612200040',
   色号:'00040', 色名:'灰白色调', 性别:'中性', 电商上市日期:'2026-07-30 00:00:00'}
 const {jobs, errors} = box.batchRows({rows:[row,row,{...row,批次:'第7批'},
   {...row,上新季:'26Q4',批次:'第2批',电商上市日期:'2026-09-01'}]}, new Set())
 assert.equal(errors.length, 0)
 assert.equal(jobs.length, 3)
 assert.equal(jobs[1].batch, '第7批')
 assert.equal(jobs[2].season, '26Q4')
 assert.equal(jobs[0].group, '男')
 assert.equal(jobs[0].colors.length, 1)
 assert.equal(jobs[0].colors[0].target, '灰白色调00040')
 assert.match(jobs[0].colors[0].notes[0], /需复核/)
 const root = '3-商品上新/3-01季度上新/2026年/26Q3/静物图/测试'
 assert.doesNotThrow(() => box.requireTarget(root + '/26Q3第8批/男', root))
 for (const other of [root, root + '/..', root + '备份/男', root.replace('测试', '男') + '/1p']) {
  assert.throws(() => box.requireTarget(other, root), /超出所选目标目录/)
 }
 assert.equal(box.parseAddress('森马视觉//静物/2026批次/').root, '静物/2026批次')
 const route = 'https://fmp.semirapp.com/web/index#/home/file/mount/2021?path=' + encodeURIComponent(root)
 assert.equal(box.parseAddress(route).mountId, '2021')
 assert.equal(box.parseAddress(route).root, root)
 assert.throws(() => box.parseAddress(route.replace('fmp.semirapp.com', 'example.com')), /森马云盘/)
 assert.throws(() => box.parseAddress('森马视觉//静物/../其他'), /具体云盘目录/)
})

test('still package retries only accept complete source file hashes and mapped folder names', async () => {
 const {box} = await run('organize-still-image-package')
 const sourceTree = [{fullpath:'source/original',dir:1},{fullpath:'source/original/file.jpg',filehash:'abc',filesize:10}]
 const renamed = [{fullpath:'target/色名00040',dir:1},{fullpath:'target/色名00040/file.jpg',filehash:'abc',filesize:10}]
 const plans = [{original:'original',row:{target:'色名00040'}}]
 assert.equal(box.equivalent(sourceTree, renamed, 'source', 'target', plans, true), true)
 assert.equal(box.equivalent(sourceTree, renamed.slice(0, 1), 'source', 'target', plans, true), false)
 assert.equal(box.equivalent(sourceTree, [renamed[0],{...renamed[1],filehash:'bad'}], 'source', 'target', plans, true), false)
})

test('still package OCR separates hangtag, wash label, wrong style and unresolved text', async () => {
 const {box} = await run('organize-still-image-package')
 const code = '107526100170'
 const hang = box.ocrEvidence('536A2006.jpg', '执 行 标 准\n款 号\n107526100170-00316\n¥159.00', code)
 const wash = box.ocrEvidence('536A2004.jpg', '洗 涤 说 明\nWashing instructions\n107526100170', code)
 const wrong = box.ocrEvidence('other.jpg', '洗涤说明\n104526100003', code)
 const illegible = box.ocrEvidence('unclear.jpg', '洗涤说明\n1075?6100170', code)
 assert.equal(box.summarizeLabel([hang, wash], '吊牌', code, 0).status, '一致')
 assert.equal(box.summarizeLabel([hang, wash], '洗唛', code, 0).status, '一致')
 assert.equal(box.summarizeLabel([wash, wrong], '洗唛', code, 0).status, '识别到不一致款号，待复核')
 assert.equal(box.summarizeLabel([illegible], '洗唛', code, 0).status, '已识别类型，款号未读出')
 assert.equal(box.summarizeLabel([], '吊牌', code, 1).status, '部分图片识别失败，待复核')
})

test('Semir Cloud Drive login uses the live drive session before the app DOM loads', async () => {
 const location = {hostname:'fmp.semirapp.com',pathname:'/web/index'}
 const valid = await run('auth_check', 'main', {}, {
  location, fetch:async path=>({ok:path==='/fengcloud/1/account/mount',json:async()=>({list:[{}]})}),
 })
 assert.equal(valid.result.meta.logged_in, true)
 const expired = await run('auth_check', 'main', {}, {location,fetch:async()=>({ok:false,status:401})})
 assert.equal(expired.result.meta.logged_in, false)
})

test('OCR concurrency uses browser cores and memory without exceeding the cap', async () => {
 const {box} = await run('organize-still-image-package')
 assert.equal(box.ocrWorkerLimit(18, 32), 12)
 assert.equal(box.ocrWorkerLimit(8, 8), 4)
 assert.equal(box.ocrWorkerLimit(4, 4), 2)
 assert.equal(box.ocrWorkerLimit(64, undefined), 6)
})

test('a timed-out image is retried in the same task and login errors are left to resume', async () => {
 const {box} = await run('organize-still-image-package')
 const timedOut = Object.assign(new Error('OCR 超时'), {ocrTimeout:true})
 let attempts = 0
 let recoveries = []
 const result = await box.retryTimedOutImage(async () => {
  if (++attempts === 1) throw timedOut
  return '107526100170'
 }, (_error, retrying) => recoveries.push(retrying))
 assert.equal(result, '107526100170')
 assert.equal(attempts, 2)
 assert.deepEqual(recoveries, [true])
 recoveries = []
 await assert.rejects(box.retryTimedOutImage(async () => {throw timedOut},
  (_error,retrying)=>recoveries.push(retrying)), /已自动重试一次/)
 assert.deepEqual(recoveries, [true,false])
 const expired = Object.assign(new Error('登录超时'), {sessionExpired:true})
 await assert.rejects(box.retryTimedOutImage(async () => {throw expired},
  ()=>assert.fail('a login error must not consume the OCR timeout retry')), /登录超时/)
})

test('OCR waits on cloud login and resumes only unfinished colors from the checkpoint', async () => {
 const script = fs.readFileSync('adapters/semir-launch-assistant/organize-still-image-package.js', 'utf8')
 const raw = {季度:'26Q3',批次:'第8批',款号:'107526100170',款色:'10752610017000316',
  色号:'00316',色名:'白红色调00316',性别:'男',电商上市日期:'2026-07-30'}
 const raw2 = {...raw,款色:'10752610017000324',色号:'00324',色名:'灰绿色调00324'}
 const row = {...raw,批次:'26Q3第8批',上市日期:'2026-07-30'}
 const row2 = {...row,款色:raw2.款色,色号:raw2.色号,色名:raw2.色名}
 const done = {...row,整理结果:'已核验已有图包',吊牌结果:'一致',洗唛结果:'一致'}
 const token = 'resume-test'
 const key = '__CRAWSHRIMP_SEMIR_STILL_CHECKPOINT__:' + token
 const stored = new Map([[key,JSON.stringify({
  prepared:[[{row,folder:'already/processed',result:done},{row:row2,labelStatus:'无图片',result:{整理结果:'已核验已有图包'}}]],
  receipts:[[done]],
 })]])
 const state = {total_rows:2,current_exec_no:1,organize_completed:2,current_store:'OCR 核验吊牌与洗唛'}
 const window = {__CRAWSHRIMP_PARAMS__:{input_file:{rows:[raw,raw2]}},__CRAWSHRIMP_PHASE__:'ocr',
  __CRAWSHRIMP_RUN_TOKEN__:token,__CRAWSHRIMP_SHARED__:state}
 let authenticated = false
 const requested = []
 const context = {window,sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  location:{hostname:'fmp.semirapp.com',pathname:'/home.html'},navigator:{hardwareConcurrency:8,deviceMemory:8},
  URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout, fetch:async url=>{
   requested.push(url.split('?')[0])
   return {ok:authenticated,status:authenticated?200:401,json:async()=>authenticated?{list:[{}]}:{error_msg:'登录超时'}}
  }}
 const waiting = await vm.runInNewContext(script,context)
 assert.equal(waiting.meta.next_phase,'ocr')
 assert.equal(waiting.meta.shared.current_store,'等待森马云盘登录')
 assert.equal(waiting.meta.shared.current_exec_no,1)
 assert.equal(waiting.meta.shared.organize_completed,2)
 authenticated = true
 context.location.pathname = '/web/index'
 window.__CRAWSHRIMP_SHARED__ = waiting.meta.shared
 const continued = await vm.runInNewContext(script,context)
 window.__CRAWSHRIMP_SHARED__ = continued.meta.shared
 await new Promise(resolve=>setImmediate(resolve))
 const completed = await vm.runInNewContext(script,context)
 assert.equal(completed.meta.action,'complete')
 assert.equal(completed.data.length,2)
 assert.equal(completed.data[0].吊牌结果,'一致')
 assert.equal(completed.data[1].款色,raw2.款色)
 assert.deepEqual(requested,['/fengcloud/1/account/mount','/fengcloud/1/account/mount'])
 assert.equal(stored.has(key),false)
})
