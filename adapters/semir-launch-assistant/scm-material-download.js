;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const clean = v => String(v ?? '').trim()
  const safe = v => clean(v).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '') || '未标注'
  const codes = v => [...new Set(clean(v).split(/[\s,，;；、]+/).filter(Boolean))]
  const matches = (value, code) => codes(clean(value).replace(/[\/|]+/g, ' ')).includes(code)
  const isReport = location.pathname.endsWith('/scm-qc-third-test-report-index')
  const next = (name, state, data = []) => ({success:true,data,meta:{action:'next_phase',next_phase:name,sleep_ms:500,shared:state}})
  const done = state => ({success:true,data:state.rows,meta:{action:'complete',has_more:false,shared:state}})
  function table() {
    const qs = [...document.querySelectorAll('.q-table__container')].map(e=>e.__vue__).filter(Boolean)
    const q = qs.find(q=>(q.$props.columns||[]).some(c=>c.name===(isReport?'QC_ATTACHMENT_LIST':'SKC_FILE_URL1')))
    if (!q?.$parent?.handleRequest) throw new Error('未找到 SCM 资料表格，请先打开对应任务页面并登录')
    return q.$parent
  }
  async function query(style, page, originalFilters) {
    const t=table(); let p=t
    while(p&&!p.$data.searchModel) p=p.$parent
    if(!p) throw new Error('SCM 查询组件不可用')
    const filters={...originalFilters,[isReport?'ADVANCED_SEARCH[PRD_CODE]':'ADVANCED_SEARCH[P_MAT_CODE]']:style}
    p.searchModel=filters
    await p.$nextTick()
    const previous=t.sourceMyListData
    await new Promise((resolve,reject)=>{
      let timer
      const clear=()=>{clearTimeout(timer);t.$off('triggerLoad',loaded);t.$off('triggerLoadFailed',failed)}
      const failed=()=>{clear();reject(new Error('SCM 查询失败，不能视为无记录'))}
      const loaded=()=>{clear();t.sourceMyListData===previous?reject(new Error('SCM 未返回成功结果，检查登录或网络')):resolve()}
      t.$on('triggerLoad',loaded);t.$on('triggerLoadFailed',failed)
      timer=setTimeout(()=>{clear();reject(new Error('SCM 查询超时'))},30000)
      try {t.handleRequest({pagination:{...t.config.tableConfig.pagination,page,rowsPerPage:50}})}catch(e){clear();reject(e)}
    })
    const total=Number(t.recordsTotal), rows=t.myListData
    if(!Number.isInteger(total)||total<0||!Array.isArray(rows)) throw new Error('SCM 分页结果无效')
    const actual=t.fetchTableConfig.fetchParams
    if(clean(actual[isReport?'ADVANCED_SEARCH[PRD_CODE]':'ADVANCED_SEARCH[P_MAT_CODE]'])!==style || Number(actual.start)!==(page-1)*50) throw new Error('SCM 筛选或分页未生效')
    return {total,rows}
  }
  function plan(records, style, start=0) {
    const rows=[],items=[]
    for(const r of records){
      if(!(isReport?matches(r.PRD_CODE,style):clean(r.P_MAT_CODE)===style)) throw new Error('SCM 返回了其他款号，停止下载')
      const base={款号:style,来源:isReport?'SCM检测报告':'SCM洗唛吊牌',记录ID:clean(r.ID),单号:clean(r.ORDER_NO),品牌:clean(r.BRAND_DISPLAY),季节:clean(r.SEASONS_DISPLAY||r.SEASONS),色号:clean(isReport?r.PRD_F1:r.F1),颜色:clean(isReport?r.PRD_F1_DISPLAY:r.F1_DISPLAY),SKC:clean(r.SKC_CODE),采购单号:clean(r.PO_NO),供应商:clean(r.VENDOR_NAME),中文成分:clean(r.C_COMPONENT),英文成分:clean(r.E_COMPONENT),样品类型:clean(r.THIRDPARTY_TESTING_TESTPART_DISPLAY),检测项目:clean(r.CHECK_CODES_NAME),检测机构:clean(r.THIRD_VENDOR_NAME),判定结果:clean(r.RESULT_TEXT||r.RESULT),更新时间:clean(r.LAST_MODIFIED_TIME),筛选范围:JSON.stringify(shared.filters||{}),采集时间:new Date().toISOString()}
      if(!isReport&&params.only_completed!==false && !(String(r.H_STATUS)==='100'||String(r.STATUS)==='0')) {rows.push({...base,下载结果:'未完成，已跳过'});continue}
      const defs=isReport?(r.QC_ATTACHMENT_LIST||[]).map(f=>({type:'检测报告',url:f.FILE_URL,name:f.ORIGINAL_FILE_NAME||f.FILE_NAME})):[{type:'洗唛',url:r.SKC_FILE_URL1},{type:'吊牌',url:r.SKC_FILE_URL2}]
      if(!defs.length) rows.push({...base,下载结果:'无附件',备注:'记录存在，但未返回附件；报告适用性需复核'})
      const seen=new Set()
      for(const f of defs){
        if(!f.url){rows.push({...base,资料类型:f.type,下载结果:'缺少附件'});continue}
        const u=new URL(f.url,location.origin)
        if(u.protocol!=='https:'||!/(^|\.)(semir\.com|semirapp\.com)$/.test(u.hostname)) throw new Error('附件地址不属于 SCM 文件服务')
        if(seen.has(u.href))continue;seen.add(u.href)
        const filename=safe(decodeURIComponent(u.pathname.split('/').pop())||f.name)
        const relative=[safe(style),f.type,safe(base.色号||'适用色待核'),safe(base.单号||base.记录ID),safe(base.记录ID),`${items.length+1}_${filename}`].join('/')
        rows.push({...base,资料类型:f.type,文件名:filename,来源路径:u.origin+u.pathname,包内路径:relative,下载结果:'待下载',备注:isReport?'原始报告，功能/羽绒适用性及有效期需核对':'',__download_index:start+items.length})
        items.push({url:u.href,filename:`${safe(style)}_${safe(base.记录ID)}_${start+items.length}_${filename}`,label:`${style}/${f.type}`,headers:{Referer:location.href},retry_attempts:2})
      }
    }
    return {rows,items}
  }
  if(window.__CRAWSHRIMP_EXPORTS__)Object.assign(window.__CRAWSHRIMP_EXPORTS__,{codes,matches,safe,plan})
  if(phase==='__exports__')return done({rows:[]})
  try {
    if(location.hostname!=='scm.semir.com'||(!isReport&&!location.pathname.endsWith('/scm-qc-wash-appr-index')))throw new Error('请打开对应 SCM 洗唛判定或三方检测报告页面')
    if(phase==='main'||phase==='init'){
      const styles=codes(params.style_codes)
      if(!styles.length||styles.some(s=>!/^[A-Za-z0-9_-]{6,40}$/.test(s)))throw new Error('请输入有效款号')
      let p=table();while(p&&!p.$data.searchModel)p=p.$parent
      const filters={...(p?.searchModel||{})};delete filters['ADVANCED_SEARCH[PRD_CODE]'];delete filters['ADVANCED_SEARCH[P_MAT_CODE]']
      return next('collect',{styles,index:0,page:1,filters,rows:[],recordIds:[],readCount:0,total_rows:styles.length,current_exec_no:1,current_buyer_id:styles[0]})
    }
    if(phase==='collect'){
      const style=shared.styles[shared.index]
      try{
        const result=await query(style,shared.page,shared.filters)
        if(shared.page>1&&result.total!==shared.expectedTotal)throw new Error('分页期间记录总数变化，请重跑此款')
        const ids=result.rows.map(r=>clean(r.ID))
        if(ids.some(id=>!id)||new Set(ids).size!==ids.length||ids.some(id=>shared.recordIds.includes(id)))throw new Error('SCM 分页记录重复或缺少ID')
        const count=shared.readCount+result.rows.length
        if(count>result.total||(!result.rows.length&&count<result.total))throw new Error('SCM 分页不完整')
        const planned=plan(result.rows,style)
        if(!result.total)planned.rows.push({款号:style,来源:isReport?'SCM检测报告':'SCM洗唛吊牌',下载结果:'当前筛选下无记录',筛选范围:JSON.stringify(shared.filters)})
        const state={...shared,expectedTotal:result.total,readCount:count,recordIds:[...shared.recordIds,...ids],pending:planned.rows,finishedStyle:count===result.total,batch_no:shared.page,total_batches:Math.max(1,Math.ceil(result.total/50))}
        if(planned.items.length)return {success:true,data:[],meta:{action:'download_urls',items:planned.items,shared_key:'downloads',strict:false,concurrency:3,next_phase:'after_download',shared:state}}
        return next('after_download',{...state,downloads:{items:[]}})
      }catch(e){return next('advance',{...shared,finishedStyle:true,rows:[...shared.rows,{款号:style,下载结果:'采集失败/不完整',备注:e.message}]})}
    }
    if(phase==='after_download'){
      const rows=shared.pending.map(r=>{if(r.__download_index===undefined)return r;const d=shared.downloads?.items?.[r.__download_index];const {__download_index,...row}=r;return {...row,下载结果:d?.success&&d?.bytes>0?'已下载':'下载失败',本地文件:d?.path||'',文件大小:d?.bytes||0,备注:d?.success?row.备注:'下载失败或空文件'}})
      return next('advance',{...shared,rows:[...shared.rows,...rows],pending:[],downloads:{}})
    }
    if(phase==='advance'){
      if(!shared.finishedStyle){if(shared.page>=200)throw new Error('超过200页，请缩小查询范围');return next('collect',{...shared,page:shared.page+1})}
      const index=shared.index+1
      if(index>=shared.styles.length)return done(shared)
      return next('collect',{...shared,index,page:1,recordIds:[],readCount:0,current_exec_no:index+1,current_buyer_id:shared.styles[index]})
    }
    throw new Error('未知执行阶段')
  }catch(e){return {success:false,error:e.message}}
})()
