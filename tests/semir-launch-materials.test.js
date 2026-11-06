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
