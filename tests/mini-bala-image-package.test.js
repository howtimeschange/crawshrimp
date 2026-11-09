import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync('adapters/mini-bala-launch-assistant/prepare-image-package.js','utf8')
async function helpers(fetch) {
  const box={};await vm.runInNewContext(source,{window:{__CRAWSHRIMP_EXPORTS__:box,__CRAWSHRIMP_PHASE__:'__exports__'},URLSearchParams,AbortSignal,fetch});return box
}
test('full style token supports Chinese suffix without matching longer styles',async()=>{
 const h=await helpers();assert(h.hasCode('231426108006裤子','231426108006'));assert(!h.hasCode('2314261080067','231426108006'));assert(!h.hasCode('1231426108006','231426108006'))
 assert.equal(h.isDir({dir:'0'}),false)
})
test('only design-usable models and scoped sources are eligible',async()=>{
 const h=await helpers();assert.equal(h.sourceKind('季节/5-模特图收图（素材）/款号/'),'');assert.equal(h.sourceKind('季节/2-模特图（设计可用）/款号/'),'model');assert(!h.inScope('冬1P旧/图','冬1P'))
})
test('search locates folders then recursively lists unnumbered originals',async()=>{
 const root='摄影/2026',folder=root+'/1-静物图/冬/231426108006-88301'
 const h=await helpers(async(url)=>({ok:true,json:async()=>url.startsWith('/fengcloud/2/file/search')?{total:3,list:[{dir:1,filename:'231426108006-88301',fullpath:folder},{dir:1,filename:'2314261080067',fullpath:folder+'7'},{dir:0,filename:'231426108006-88301.jpg',fullpath:folder+'/231426108006-88301.jpg'}]}:{count:1,list:[{dir:0,filename:'camera.JPG',fullpath:folder+'/camera.JPG'}]}}))
 const rows=await h.collect('231426108006','3281',root);assert.equal(rows.length,1);assert.equal(rows[0].filename,'camera.JPG')
})
test('repeated pagination is an error, never silent partial success',async()=>{
 const h=await helpers(async()=>({ok:true,json:async()=>({total:500,list:[{fullpath:'same'}]})}));await assert.rejects(()=>h.pages('/test',{}),/重复分页/)
})

test('reports scan same-style folders across mounts and find PDFs without style in filename',async()=>{
 const code='231426108006', requests=[]
 const h=await helpers(async(url,init={})=>{
  const args=url.startsWith('/fengcloud/2/file/search')?new URLSearchParams(init.body):new URLSearchParams(url.split('?')[1]);requests.push([args.get('mount_id'),args.get('fullpath')])
  if(url.startsWith('/fengcloud/2/file/search'))return {ok:true,json:async()=>({total:2,list:[{dir:1,filename:code,fullpath:'其他年份/'+code},{dir:1,filename:code+'9',fullpath:'错误/'+code+'9'}]})}
  return {ok:true,json:async()=>({count:2,list:[{dir:0,filename:'W26045933.pdf',fullpath:'其他年份/'+code+'/W26045933.pdf'},{dir:0,filename:code+'_尺寸表.pdf',fullpath:'其他年份/'+code+'/'+code+'_尺寸表.pdf'}]})}
 })
 const result=await h.collectReports(code,[{mount_id:'9',org_name:'质量部'},{mount_id:'10',org_name:'视觉'}])
 assert.equal(result.assets.length,2);assert.equal(result.errors.length,0)
 assert.deepEqual(Array.from(result.assets,x=>x.mountId).sort(),['10','9'])
 assert(result.assets.every(x=>x.filename==='W26045933.pdf'&&x.sourceType==='report'))
 assert(!requests.some(([,p])=>p?.startsWith('错误')))
})
test('failed report directory remains visible while other directories are collected',async()=>{
 const code='231426108006'
 const h=await helpers(async(url,init={})=>{
  if(url.startsWith('/fengcloud/2/file/search'))return {ok:true,json:async()=>({total:2,list:[{dir:1,filename:code,fullpath:'A/'+code},{dir:1,filename:code,fullpath:'B/'+code}]})}
  if(new URLSearchParams(url.split('?')[1]).get('fullpath').startsWith('A/'))return {ok:false,status:403}
  return {ok:true,json:async()=>({count:1,list:[{dir:0,filename:'R.pdf',fullpath:'B/'+code+'/R.pdf'}]})}
 })
 const result=await h.collectReports(code,[{mount_id:'9',org_name:'测试'}]);assert.equal(result.assets.length,1);assert.equal(result.errors.length,1);assert.match(result.errors[0],/403/)
})
