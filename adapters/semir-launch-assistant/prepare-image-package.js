;(async()=>{
  const params=window.__CRAWSHRIMP_PARAMS__||{}, shared=window.__CRAWSHRIMP_SHARED__||{},phase=window.__CRAWSHRIMP_PHASE__||'main'
  const clean=v=>String(v??'').trim()
  const safe=v=>clean(v).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+|\.+$/g,'')||'未标注'
  const isDir=i=>[1,'1',true].includes(i.dir)
  const inScope=(p,r)=>p===r||p.startsWith(r+'/')
  const normalize=p=>clean(p).split('/').filter(Boolean).join('/')
  const validPath=p=>!p.split('/').some(s=>s==='..'||s==='.'||s.includes('\\'))
  const hasCode=(name,code)=>name===code||name.startsWith(code+'-')||name.startsWith(code+'_')
  function colorOf(path,style){
    const parts=path.split('/').slice(0,-1), found=new Set()
    for(const part of parts){
      const coded=part.match(new RegExp('^'+style+'[-_](\\d{5})(?!\\d)'))
      const named=part.match(/^[\u3400-\u9fffA-Za-z（）()]+?(\d{5})$/)
      if(coded||named)found.add((coded||named)[1])
    }
    return found.size===1?[...found][0]:''
  }
  const next=(name,state)=>({success:true,data:[],meta:{action:'next_phase',next_phase:name,sleep_ms:100,shared:state}})
  function parseSources(raw){return clean(raw).split('\n').filter(x=>x.trim()).map(line=>{const [role,...parts]=line.split('|'),path=parts.join('|').trim(),pos=path.indexOf('//');if(!['静物','模特','补图'].includes(role.trim())||pos<1)throw new Error('每行填写：静物|挂载点//目录（或模特、补图）');const root=normalize(path.slice(pos+2));if(!root||!validPath(root))throw new Error('请填写具体批次目录，不能使用上级路径');return {role:role.trim(),mount:clean(path.slice(0,pos)),root}})}
  async function request(url,args,post=false){const body=new URLSearchParams(args||{});const r=await fetch(url+(post?'':'?'+body),{credentials:'include',signal:AbortSignal.timeout(30000),...(post?{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()}:{})});if(!r.ok)throw new Error(`云盘 HTTP ${r.status}`);const j=await r.json();if(j.error_code||j.error||j.success===false)throw new Error('云盘查询失败，请检查登录及目录权限');return j}
  async function pages(url,args,post=false){let out=[],seen=new Set(),expected;for(let start=0;start<20000;){const j=await request(url,{...args,start,size:100},post);if(!Array.isArray(j.list))throw new Error('云盘未返回文件列表');const n=Number(j.count??j.total);if(Number.isFinite(n)){if(expected!==undefined&&expected!==n)throw new Error('云盘分页期间数量变化');expected=n}const sig=JSON.stringify(j.list.map(i=>i.fullpath||i.filename));if(j.list.length&&seen.has(sig))throw new Error('云盘重复分页');seen.add(sig);out.push(...j.list);start+=j.list.length;if(expected!==undefined&&start>=expected)return out;if(!j.list.length){if(expected>start)throw new Error('云盘分页提前结束');return out}if(expected===undefined&&j.list.length<100)return out}throw new Error('扫描超过两万条，请缩小范围')}
  async function collect(style,source){
    // Enumerate the explicit batch folder; never search other batches or fall back to the entire mount.
    const entries=await pages('/fengcloud/1/file/ls',{mount_id:source.id,fullpath:source.root,current:1,order:'filename asc'})
    const roots=entries.filter(i=>isDir(i)&&hasCode(i.filename,style)).map(i=>i.fullpath||source.root+'/'+i.filename)
    const queue=roots.map(path=>({path,depth:0})),visited=new Set(),files=[]
    while(queue.length){const {path,depth}=queue.shift();if(visited.has(path))continue;if(!inScope(path,source.root)||!validPath(path))throw new Error('目录超出选定范围');visited.add(path);if(visited.size>500)throw new Error('目录超过500个')
      const items=await pages('/fengcloud/1/file/ls',{mount_id:source.id,fullpath:path,current:1,order:'filename asc'})
      for(const raw of items){const i={...raw,fullpath:raw.fullpath||path+'/'+raw.filename};if(!inScope(i.fullpath,path)||!validPath(i.fullpath))throw new Error('返回了范围外路径');if(isDir(i)){if(depth>=12)throw new Error('目录深度超过12层');queue.push({path:i.fullpath,depth:depth+1})}else files.push(i);if(files.length>5000)throw new Error('单款超过5000个文件')}
    }
    return files
  }
  if(window.__CRAWSHRIMP_EXPORTS__)Object.assign(window.__CRAWSHRIMP_EXPORTS__,{parseSources,hasCode,validPath,inScope,colorOf})
  if(phase==='__exports__')return {success:true,data:[]}
  try{
    if(location.hostname!=='fmp.semirapp.com')throw new Error('请打开森马云盘并登录')
    if(phase==='main'||phase==='init'){
      const styles=[...new Set(clean(params.style_codes).split(/[\s,，;；、]+/).filter(Boolean))]
      if(!styles.length||styles.some(s=>!/^[A-Za-z0-9_-]{6,40}$/.test(s)))throw new Error('请输入有效款号')
      const sources=parseSources(params.source_paths),mounts=await request('/fengcloud/1/account/mount')
      if(!sources.length)throw new Error('请输入批次图包目录')
      for(const s of sources){const m=mounts.list?.find(m=>m.org_name===s.mount);if(!m)throw new Error('无权访问挂载点：'+s.mount);s.id=String(m.mount_id)}
      return next('collect',{styles,sources,index:0,sourceIndex:0,rows:[],total_rows:styles.length,current_exec_no:1,current_buyer_id:styles[0]})
    }
    if(phase==='collect'){
      const style=shared.styles[shared.index],source=shared.sources[shared.sourceIndex],rows=[],items=[]
      try{const files=await collect(style,source)
        if(!files.length)rows.push({款号:style,资料类型:source.role,来源路径:source.mount+'//'+source.root,下载结果:'指定批次未找到素材'})
        for(const [i,f] of files.entries()){
          const relative=f.fullpath.slice(source.root.length+1),color=colorOf(relative,style)
          const base={款号:style,色号:color,资料类型:source.role,来源路径:source.mount+'//'+f.fullpath,文件名:f.filename,包内路径:[safe(style),source.role,`来源${shared.sourceIndex+1}`, ...relative.split('/').map(safe)].join('/'),备注:color?'':'颜色未由目录明确标注，需复核',采集时间:new Date().toISOString()}
          try{const info=await request('/fengcloud/2/file/info',{mount_id:source.id,fullpath:f.fullpath}),url=info.uri||info.uris?.[0];if(!url)throw new Error('未返回下载地址');const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw new Error('下载协议无效');rows.push({...base,下载结果:'待下载',__download_index:items.length});items.push({url,filename:`${safe(style)}_${shared.sourceIndex}_${i}_${safe(f.filename)}`,label:style+'/'+f.filename,no_proxy:true})}catch(e){rows.push({...base,下载结果:'获取链接失败',备注:e.message})}
        }
      }catch(e){rows.push({款号:style,资料类型:source.role,下载结果:'扫描失败/不完整',备注:e.message})}
      const state={...shared,pending:rows}
      if(items.length)return {success:true,data:[],meta:{action:'download_urls',items,shared_key:'downloads',strict:false,concurrency:4,retry_attempts:2,next_phase:'after_download',shared:state}}
      return next('after_download',{...state,downloads:{items:[]}})
    }
    if(phase==='after_download'){
      const rows=shared.pending.map(r=>{if(r.__download_index===undefined)return r;const d=shared.downloads?.items?.[r.__download_index],{__download_index,...base}=r;return {...base,下载结果:d?.success&&d.bytes>0?'已下载':'下载失败',本地文件:d?.path||'',文件大小:d?.bytes||0}})
      let index=shared.index,sourceIndex=shared.sourceIndex+1;if(sourceIndex>=shared.sources.length){index++;sourceIndex=0}
      const state={...shared,index,sourceIndex,rows:[...shared.rows,...rows],pending:[],downloads:{},current_exec_no:Math.min(index+1,shared.styles.length),current_buyer_id:shared.styles[index]||''}
      if(index>=shared.styles.length)return {success:true,data:state.rows,meta:{action:'complete',has_more:false,shared:state}}
      return next('collect',state)
    }
    throw new Error('未知执行阶段')
  }catch(e){return {success:false,error:e.message}}
})()
