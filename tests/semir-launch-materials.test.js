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
 const {jobs, errors} = box.batchRows({rows:[row,{...row,批次:'8P'},{...row,批次:'第7批'},
   {...row,上新季:'26Q4',批次:'第2批',电商上市日期:'2026-09-01'}]}, new Set())
 assert.equal(errors.length, 0)
 assert.equal(jobs.length, 3)
 assert.equal(jobs[1].batch, '第7批')
 assert.equal(jobs[0].batchFolder, '8P')
 assert.equal(jobs[2].season, '26Q4')
 assert.equal(jobs[0].group, '男')
 assert.equal(jobs[0].colors.length, 1)
 assert.equal(jobs[0].colors[0].target, '灰白色调00040')
 assert.match(jobs[0].colors[0].notes[0], /需复核/)
 const root = '3-商品上新/3-01季度上新/2026年/26Q3/静物图/测试'
 assert.doesNotThrow(() => box.requireTarget(root + '/8P/男', root))
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

test('batch folders are canonical uppercase and existing case variants are reused safely', async () => {
 const root = '允许的测试目录'
 const paths = ['8p']
 const {box} = await run('organize-still-image-package', '__exports__', {}, {
  fetch: async url => {
   assert.ok(url.startsWith('/fengcloud/1/file/ls?'))
   return {ok:true,json:async()=>({count:paths.length,list:paths.map(filename=>({filename,fullpath:root+'/'+filename,mount_id:2021,dir:1}))})}
  },
 })
 for (const input of ['第8批','第 8 批','8P','８ｐ','08P']) {
  assert.equal(box.parseBatch(input).folder, '8P')
  assert.equal(box.parseBatch(input).label, '第8批')
 }
 assert.equal(box.parseBatch('0P'), null)
 assert.equal(box.parseBatch('第8批/取消'), null)
 assert.equal(await box.batchDirectory({root,mountId:'2021'}, '8P'), root+'/8p')
 paths.push('8P')
 await assert.rejects(box.batchDirectory({root,mountId:'2021'}, '8P'), /批次目录命名冲突/)
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

test('a style copy requires every source subfolder to be selected for the current run', async () => {
 const {box} = await run('organize-still-image-package')
 const selected = {original:'107526101004-80900',row:{target:'冰蓝80900'}}
 const others = [{filename:'107526101004-00502',dir:1},{filename:'107526101004-10301',dir:1}]
 const listing = [{filename:selected.original,dir:1}, ...others, {filename:'readme.txt',dir:0}]
 assert.equal(box.canCopyWholeStyle(listing,[selected]),false)
 assert.equal(box.canCopyWholeStyle(listing,[selected,...others.map(item=>({original:item.filename,row:{}}))]),true)
 assert.equal(box.canCopyWholeStyle(listing,[{...selected,path:'another/source'}]),false)
})

test('organizing one selected color sends only that source folder to the copy endpoint', async () => {
 const style = '107526101004', source = '当季/静物', target = '允许的测试目录'
 const dirs = new Map(), copies = []
 const item = (mount_id, fullpath, dir=1) => ({mount_id,fullpath,dir,filename:fullpath.split('/').at(-1),filehash:dir?'':'hash',filesize:dir?0:100})
 const key = (mount,path) => mount+'//'+path
 const sourceStyle = source+'/'+style
 const sourceFolders = ['00502','10301','80900'].map(color=>item('3283',sourceStyle+'/'+style+'-'+color))
 dirs.set(key('3283',sourceStyle),sourceFolders)
 for(const f of sourceFolders) dirs.set(key('3283',f.fullpath),[item('3283',f.fullpath+'/a.jpg',0)])
 dirs.set(key('2021',target),[])
 const add = (mount,fullpath,contents=[])=>{
  const f=item(mount,fullpath)
  dirs.get(key(mount,fullpath.slice(0,fullpath.lastIndexOf('/')))).push(f)
  dirs.set(key(mount,fullpath),contents)
  return f
 }
 const {box} = await run('organize-still-image-package','__exports__',{},{
  navigator:{locks:{request:async(_,write)=>write()}},
  fetch:async(url,options)=>{
   const route=new URL(url,'https://fmp.semirapp.com')
   const body=options.body&&JSON.parse(options.body)
   let out
   if(route.pathname.endsWith('/search')) out={total:1,list:[item('3283',sourceStyle)]}
   else if(route.pathname.endsWith('/ls')){
    const rows=dirs.get(key(route.searchParams.get('mount_id'),route.searchParams.get('fullpath')))
    assert.ok(rows,url)
    out={list:rows,count:rows.length}
   }else if(route.pathname.endsWith('/create_folder')) out=add(body.mount_id,body.fullpath)
   else if(route.pathname.endsWith('/copy')){
    const sourcePath=decodeURIComponent(body.fullpaths.slice(0,-1))
    copies.push(sourcePath)
    const dest=body.target_fullpath+'/'+sourcePath.split('/').at(-1)
    out=[add('2021',dest,[item('2021',dest+'/a.jpg',0)])]
   }else if(route.pathname.endsWith('/rename')){
    const parent=body.fullpath.slice(0,body.fullpath.lastIndexOf('/'))
    const index=dirs.get(key('2021',parent)).findIndex(x=>x.fullpath===body.fullpath)
    assert.notEqual(index,-1)
    const desired=parent+'/'+body.newname
    dirs.get(key('2021',parent))[index]=item('2021',desired)
    dirs.delete(key('2021',body.fullpath))
    dirs.set(key('2021',desired),[item('2021',desired+'/a.jpg',0)])
    out={}
   }else assert.fail(url)
   return {ok:true,json:async()=>out}
  },
 })
 const row={色号:'80900',target:'冰蓝80900',notes:[]}
 const received=await box.prepareStyle(
  {mode:'organize',season:'26Q3',sources:[{root:source,mountId:'3283',mount:'来源'}],target:{root:target,mountId:'2021',mount:'目标'}},
  {style,group:'女',batchFolder:'6P',colors:[row]},{run:{}},
 )
 assert.deepEqual(copies,[sourceStyle+'/'+style+'-80900'])
 assert.equal(received[0].result.整理结果,'已复制并核验')
 assert.deepEqual(dirs.get(key('2021',target+'/6P/女/'+style)).map(x=>x.filename),['冰蓝80900'])
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

test('sample cards, supplier forms and compliance text do not count as retail hangtags', async () => {
 const {box} = await run('organize-still-image-package')
 const code = '101526108131'
 const handwritten = box.ocrEvidence('IMG_0666.jpg', '101526108131\n00355', code)
 const supplier = box.ocrEvidence('IMG_1860.jpg', 'SEMIR\n样衣确认表\n款号 101526108131\n执行标准\n零售价：159', code)
 const sticker = box.ocrEvidence('IMG_1332.jpg', '森马 SEMIR\n合格证\n执行标准\n安全技术类别\n款号 101526108131', code)
 for (const evidence of [handwritten, supplier, sticker]) assert.equal(evidence.kinds.includes('吊牌'), false)
 const rejected = box.summarizeLabel([supplier], '吊牌', code, 0)
 assert.equal(rejected.status, '未检出，待复核')
 assert.equal(rejected.excludedFiles.join(','), 'IMG_1860.jpg')
 assert.equal(box.summarizeLabel([handwritten], '吊牌', code, 0).status, '有候选图片，类型待复核')
 const retail = box.ocrEvidence('IMG_2006.jpg', '款号 101526108131\n合格证\n商品条码 4006381333931', code)
 assert.equal(box.summarizeLabel([supplier, retail], '吊牌', code, 0).status, '一致')
 assert.equal(box.summarizeLabel([supplier, retail], '吊牌', code, 0).files, 'IMG_2006.jpg')
 const invalidBarcode = box.ocrEvidence('IMG_1332.jpg', '合格证\n商品条码 4006381333930\n款号 101526108131', code)
 assert.equal(invalidBarcode.kinds.includes('吊牌'), false)
 for (const title of ['森马（拍照样）办评语卡','森马（齐色办）办评语卡','森马（订货样）办评语卡','上装、下装办卡','设计编号\n码数\n克重']) {
  const card = box.ocrEvidence('sample.jpg', title+'\n款号 '+code+'\n洗涤说明\n零售价 159', code)
  assert.equal(card.supplierSample, true)
  assert.equal(card.kinds.length, 0)
 }
 for (const text of ['樣 版 卡\n款號 '+code, '版師：\n設計師：\n款号 '+code,
  'Style No: '+code+'\nGauge\nLot No\nRemarks', 'Pre-Prod\nShipment\n款号 '+code]) {
  const card = box.ocrEvidence('sample.jpg', text, code)
  assert.equal(card.supplierSample, true)
  assert.equal(card.kinds.length, 0)
 }
 const note = box.ocrEvidence('note.jpg', '無 洗 嘜', code)
 assert.equal(note.absenceCard, true)
 assert.equal(note.kinds.length, 0)
 assert.equal(box.summarizeLabel([note], '洗唛', code, 0).status, '未检出，待复核')
 const plain = box.ocrEvidence('handwritten.jpg', '¥'+code+'\n70537', code)
 assert.equal(plain.kinds.length, 0)
 assert.equal(box.ocrEvidence('retail.jpg', '合格证\n款号 '+code+'\n400-8877-588', code).kinds[0], '吊牌')
 assert.equal(box.ocrEvidence('wash.jpg', 'Composition 100% cotton\nCARA MENCUCI\nMade in China\n'+code, code).kinds[0], '洗唛')
 const ambiguousB = '103526124004B'
 const wash = box.ocrEvidence('wash.jpg', 'Washing instructions\nComposition 66.6% cotton\nMade in China\n1035261240048\n'+ambiguousB, ambiguousB)
 assert.equal(wash.kinds.join(','), '洗唛')
 assert.equal(wash.matched, true)
})

test('suffix styles remain distinct from their parent, siblings and color suffixes', async () => {
 const {box} = await run('organize-still-image-package')
 const base = '101525127011'
 const style = base + 'A'
 const row = {上新季:'26Q3', 批次:'第1批', 款号:style, 款色:style+'00411', 色号:'00411',
   色名:'咖色00411', 性别:'女', 电商上市日期:'2026-07-30'}
 const {jobs,errors} = box.batchRows({rows:[row,{...row,款号:base+'B',款色:base+'B00411'}]}, new Set())
 assert.equal(errors.length, 0)
 assert.equal(jobs[0].style, style)
 assert.equal(jobs[0].colors[0].款色, style+'00411')
 assert.equal(jobs[1].style, base+'B')
 for (const value of [style, style+'-00411', style+'00411', base+' A 00411', base+' A00411', base+'-A-00411', 'XL '+style, '101 525 127 011 A']) {
  const tag = box.ocrEvidence('a.jpg', '款号 '+value+'\n建议零售价 ¥159', style)
  assert.equal(box.summarizeLabel([tag], '吊牌', style, 0).status, '一致', value)
 }
 const readWash = value => box.ocrEvidence('b.jpg','洗涤说明\n款号：'+value,style)
 for (const value of [base,base+'00411',base+'A0411',base+'-A0411']) {
  assert.equal(box.summarizeLabel([readWash(value)],'洗唛',style,0).status,'款号后缀未读出，待复核',value)
 }
 for (const value of [base+'B',base+' B-00411','104526100003A']) {
  assert.equal(box.summarizeLabel([readWash(value)],'洗唛',style,0).status,'识别到不一致款号，待复核',value)
 }
 assert.equal(readWash('09101525127011A').codes.length, 0)
})

test('PP-LCNetV2 defers only confident other images and keeps unscored photos eligible', async () => {
 const {box} = await run('organize-still-image-package')
 const files = ['other','unscored','wash','hang','uncertain']
 const ranking = box.screenOrder(files, new Map([
  ['other',[.001,.001,.998]], ['wash',[.04,.94,.02]], ['hang',[.99,.005,.005]], ['uncertain',[.1,.1,.8]],
 ]))
 assert.equal(ranking.priority[0], 'hang')
 assert.equal(ranking.priority[1], 'wash')
 assert.equal(ranking.priority.includes('unscored'), true)
 assert.equal(ranking.priority.includes('uncertain'), true)
 assert.equal(ranking.deferred.join(','), 'other')
 assert.equal(new Set([...ranking.priority,...ranking.deferred]).size, files.length)
})

test('label view disagreement stays for review and product names require exact style and color', async () => {
 const {box} = await run('organize-still-image-package')
 const code = '101525127112B'
 const wrong = '101525127412B'
 const a = box.combineOcrViews('22922.jpg','洗涤说明\n'+wrong,'洗涤说明\n'+code,code)
 assert.equal(a.codeConflict, true)
 assert.equal(box.summarizeLabel([a],'洗唛',code,0).status,'款号识别结果冲突，待复核')
 const b = box.ocrEvidence('23922.jpg','Washing instructions\n'+code,code)
 const withAnotherMatch = box.summarizeLabel([a,b],'洗唛',code,0)
 assert.equal(withAnotherMatch.status,'款号识别结果冲突，待复核')
 assert.match(withAnotherMatch.files,/22922\.jpg/)
 const unrelated = box.ocrEvidence('fabric.jpg','JEAN\n104526100003',code)
 assert.equal(box.summarizeLabel([unrelated],'吊牌',code,0).status,'未检出，待复核')
 for (const name of [code+'-40952.jpg',code+'-40952-1.png',code.toLowerCase()+'-40952-7.JPG']) {
  assert.equal(box.isNamedProductView({filename:name},code,'40952'),true)
 }
 for (const name of [code+'-40952-洗唛.jpg',code+'-90001.jpg',code+'-40952-8.png','IMG_2180.jpg']) {
  assert.equal(box.isNamedProductView({filename:name},code,'40952'),false)
 }
})

test('four-class supplier evidence excludes handwriting but keeps a covered retail tag present', async () => {
 const {box} = await run('organize-still-image-package')
 const style = '109526124102'
 const whiteCard = box.mergeLabelViews(['合格证 SEMIR\n浙江森马服饰股份有限公司\n400-8877-588', style+'\n88401'], style, .91)
 assert.equal(whiteCard.handwrittenCertificate, true)
 assert.equal(whiteCard.kind, null)
 const covered = box.mergeLabelViews(['合格证 SEMIR\n浙江森马服饰股份有限公司\n400-8877-588\n到样时间\nFAB\n上市日\n'+style], style, .91)
 assert.equal(covered.kind, 'hangtag')
 assert.equal(covered.matched, false)
 assert.equal(covered.codes.length, 0)
 const handwritten = '湖北着墨\n款号：102526108106\n色号：70537'
 assert.equal(box.isRepeatedWorkshopCard([handwritten, handwritten], '102526108106'), true)
 assert.equal(box.isRepeatedWorkshopCard([handwritten], '102526108106'), false)
 assert.equal(box.isRepeatedWorkshopCard([handwritten, '湖北着墨\n号：102526108106\n色号：70537'], '102526108106'), true)
 assert.equal(box.isRepeatedWorkshopCard(['号102526108006\n色号00366','102526108006\n00366'], '102526108006'), true)
 assert.equal(box.isRepeatedWorkshopCard(['102526108006\n00366','102526108006\n00366'], '102526108006'), false)
 assert.equal(box.isRepeatedWorkshopCard([handwritten, handwritten.replace('湖北着墨','森马成分')], '102526108106'), false)
 const knownLabel = {filename: '洗唛.jpg'}
 const sample = {filename: 'IMG_007.jpg'}
 const order = box.screenOrder([knownLabel, sample], new Map([[knownLabel,[.001,.002,.997,0]], [sample,[.001,.002,.2,.797]]]))
 assert.equal(order.priority[0], knownLabel)
 assert.equal(order.deferred[0], sample)
})

test('a third label can expose a mismatch and trigger more crops on a deferred SKU-only sample', async () => {
 const style = '104526100109'
 const styleOnWrongWash = '102526116104'
 const source = 'test/104526100109/10101'
 const files = ['IMG_004.jpg','IMG_003.jpg','IMG_002.jpg','IMG_001.jpg'].map(filename => ({
  filename, fullpath: source + '/' + filename, thumbnail: 'https://images.semirapp.com/' + filename,
 }))
 const texts = new Map([
  [files[0].filename, '合格证\n款号 '+style+'\n零售价 159.00'],
  [files[1].filename, '洗涤说明\n'+style],
  [files[2].filename, '洗涤说明\n'+styleOnWrongWash],
  [files[3].filename, '样品车间\n款号：'+style+'\n色号：10101'],
 ])
 const calls = []
 let failNextImage = false
 let imageLookups = 0
 class Canvas {
  getContext() {
   return {
    drawImage: bitmap => { this.filename = bitmap.filename },
    getImageData: () => ({data:new Uint8Array(4)}), putImageData() {},
    fillRect() {}, translate() {}, rotate() {},
   }
  }
  async convertToBlob() { return {filename:this.filename} }
 }
 const {box} = await run('organize-still-image-package','__exports__',{}, {
  params:{__crawshrimp_api_base_url:'http://127.0.0.1:18986',__crawshrimp_semir_screen_token:'test'},
  location:{origin:'https://fmp.semirapp.com',href:'https://fmp.semirapp.com/web/index'},
  OffscreenCanvas:Canvas, createImageBitmap: async blob => ({width:1200,height:900,filename:blob.filename,close(){}}),
  fetch: async (url, options) => {
   url = String(url)
   if (url.endsWith('/classify')) return {ok:true,json:async()=>({scores:[
    [.97,.01,.01,.01], [.01,.97,.01,.01], [.01,.97,.01,.01], [.001,.001,.986,.012],
   ]})}
   if (url.includes('/read-label?')) {
    calls.push(options.body.filename)
    return {ok:true,json:async()=>({text:url.endsWith('barcode')?'':texts.get(options.body.filename)})}
   }
   if (String(url).startsWith('/fengcloud/2/file/info?')) {
    imageLookups++
    const fullpath = new URL(url,'https://fmp.semirapp.com').searchParams.get('fullpath')
    return {ok:true,json:async()=>({fullpath,mount_id:'2021',uri:'https://images.semirapp.com/'+fullpath.split('/').at(-1)})}
   }
   if (failNextImage) {
    failNextImage = false
    throw new TypeError('Failed to fetch')
   }
   return {ok:true,blob:async()=>({filename:new URL(url).pathname.slice(1)})}
  },
 })
 const worker = {recognize:async blob => {
  calls.push(blob.filename)
  return {data:{text:texts.get(blob.filename)}}
 }}
 const result = await box.scanColor({run:{},worker},'2021',files,style,'10101')
 assert.equal(result.scanned,4)
 assert.equal(result.hang.status,'一致')
 assert.equal(result.wash.status,'识别到不一致款号，待复核')
 assert.equal(result.wash.codes,styleOnWrongWash)
 assert.equal(result.hang.handwrittenFiles.join(), files[3].filename)
 assert.ok(calls.filter(filename => filename === files[3].filename).length > 1)

 const withoutThumbnails = [{...files[0], thumbnail:undefined}]
 const earlierLookups = imageLookups
 failNextImage = true
 const fallback = await box.scanColor({run:{},worker},'2021',withoutThumbnails,style,'10101')
 assert.equal(imageLookups - earlierLookups,2)
 assert.equal(fallback.failed.length,0)
 assert.equal(fallback.hang.status,'一致')
 assert.equal(fallback.wash.status,'未检出，待复核')
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
 const result = await box.retryTimedOutImage(async attempt => {
  assert.equal(attempt, attempts)
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
