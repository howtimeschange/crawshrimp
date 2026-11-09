;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const clean = value => String(value ?? '').trim()
  const isDir = item => [1, '1', true].includes(item.dir)
  const isAsset = item => !isDir(item) && /\.(jpe?g|png|webp|bmp|tiff?|pdf)$/i.test(item.filename)
  const hasCode = (value, code) => new RegExp(`(^|[^0-9])${code}(?![0-9])`).test(value)
  const inScope = (path, root) => path === root || path.startsWith(root + '/')
  const sourceKind = path => /\/\d+-静物图\//.test(path) ? 'still' : /\/\d+-模特图（设计可用）\//.test(path) ? 'model' : /\/\d+-检测报告\//.test(path) ? 'report' : ''
  const next = (name, state, data = []) => ({ success: true, data, meta: { action: 'next_phase', next_phase: name, shared: state } })
  const complete = (state) => ({ success: true, data: state.rows || [], meta: { action: 'complete', has_more: false, shared: state } })
  async function request(endpoint, args, post = false) {
    const body = new URLSearchParams(args || {})
    const response = await fetch(endpoint + (post ? '' : '?' + body), {
      credentials: 'include', signal: AbortSignal.timeout(30000),
      ...(post ? {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString()} : {}),
    })
    if (!response.ok) throw new Error(`云盘 HTTP ${response.status}`)
    const data = await response.json()
    if (data.error || data.success === false) throw new Error('云盘请求失败或登录已失效')
    return data
  }
  async function pages(endpoint, args, post = false) {
    const all = [], seen = new Set()
    for (let start = 0; start < 20000;) {
      const data = await request(endpoint, {...args, start: String(start), size: '200'}, post)
      if (!Array.isArray(data.list)) throw new Error('云盘未返回文件列表')
      if (!data.list.length) return all
      const signature = JSON.stringify(data.list.map(i => i.fullpath || i.filename))
      if (seen.has(signature)) throw new Error('云盘重复分页，已停止以免漏图')
      seen.add(signature)
      all.push(...data.list)
      start += data.list.length
      const total = Number(data.total ?? data.count)
      if (Number.isFinite(total) && start >= total) return all
      if (!Number.isFinite(total) && data.list.length < 200) return all
    }
    throw new Error('文件列表超过扫描上限')
  }
  async function collect(code, mountId, root) {
    const search = await pages('/fengcloud/2/file/search', {mount_id: mountId, keyword: code, scope: '["filename", "tag"]'}, true)
    const folders = search.filter(i => isDir(i) && inScope(i.fullpath, root) && sourceKind(i.fullpath + '/') && hasCode(i.filename, code))
      .map(i => i.fullpath).sort()
    const roots = folders.filter(p => !folders.some(q => q !== p && inScope(p, q)))
    const queue = roots.map(path => ({path, depth: 0})), visited = new Set(), assets = new Map()
    while (queue.length) {
      const {path, depth} = queue.shift()
      if (visited.has(path)) continue
      visited.add(path)
      const items = await pages('/fengcloud/1/file/ls', {mount_id: mountId, fullpath: path, current: '1', order: 'filename asc'})
      for (const raw of items) {
        const item = {...raw, fullpath: raw.fullpath || path + '/' + raw.filename}
        if (!inScope(item.fullpath, path)) throw new Error('云盘目录返回了范围外文件')
        if (isDir(item)) {
          if (depth >= 8) throw new Error('目录深度超过 8 层，请缩小范围')
          queue.push({path: item.fullpath, depth: depth + 1})
        } else if (isAsset(item)) assets.set(item.fullpath, item)
        if (assets.size > 4000 || visited.size > 500) throw new Error('款号素材过多，请缩小范围')
      }
    }
    return [...assets.values()].sort((a,b) => a.fullpath.localeCompare(b.fullpath, 'zh-CN'))
  }
  const REPORT_MOUNTS = new Set(['迷你巴拉视觉', '供应链发展中心-质量管理部（部门间）', '供应链发展部部门间', '巴拉营运BU-商品', '品牌电商项目部', '巴拉搜索渠道-淘系', '巴拉巴拉品牌事业部-市场系统'])
  const isReportCandidate = item => !isDir(item) && /\.pdf$/i.test(item.filename) && !/尺寸表|尺码表|尺寸规格|size[ _-]?chart/i.test(item.fullpath || item.filename)
  async function collectReports(code, mounts) {
    const assets = new Map(), errors = [], audit = []
    for (const mount of mounts) {
      const mountId = String(mount.mount_id), mountName = mount.org_name
      let scanned = 0
      try {
        const search = await pages('/fengcloud/2/file/search', {mount_id:mountId,keyword:code,scope:'["filename", "tag"]'}, true)
        const paths = search.filter(i => isDir(i) && hasCode(i.filename,code)).map(i => i.fullpath).sort()
        const queue = paths.filter(p => !paths.some(q => q !== p && inScope(p,q))).map(path => ({path,depth:0}))
        const visited = new Set()
        const add = item => { if (isReportCandidate(item)) assets.set(mountId+':'+item.fullpath,{...item,mountId,mountName,sourceType:'report'}) }
        for (const item of search) if (hasCode(item.filename,code)) add(item)
        while (queue.length) {
          const {path,depth} = queue.shift()
          if (visited.has(path)) continue
          visited.add(path); scanned++
          if (scanned > 500) throw new Error('检测报告目录超过500个，扫描未完成')
          try {
            const items = await pages('/fengcloud/1/file/ls',{mount_id:mountId,fullpath:path,current:'1',order:'filename asc'})
            for (const raw of items) {
              const item = {...raw,fullpath:raw.fullpath || path+'/'+raw.filename}
              if (!inScope(item.fullpath,path)) throw new Error('检测报告目录返回范围外文件')
              if (isDir(item)) {
                // Do not descend into an explicitly different style's folder.
                const codes = item.filename.match(/\d{12,}/g) || []
                if (codes.length && !codes.includes(code)) continue
                if (depth >= 8) throw new Error('检测报告扫描超过8层，扫描未完成')
                queue.push({path:item.fullpath,depth:depth+1})
              } else add(item)
              if (assets.size > 4000) throw new Error('检测报告候选超过4000份')
            }
          } catch (error) { errors.push(`${mountName}//${path}：${error.message}`) }
        }
        audit.push({mount:mountName,folders:scanned,search_hits:search.length})
      } catch (error) { errors.push(`${mountName}：${error.message}`) }
    }
    return {assets:[...assets.values()].sort((a,b)=>(a.mountId+':'+a.fullpath).localeCompare(b.mountId+':'+b.fullpath)),errors,audit}
  }
  if (window.__CRAWSHRIMP_EXPORTS__) Object.assign(window.__CRAWSHRIMP_EXPORTS__, {hasCode, sourceKind, inScope, isDir, isAsset, collect, pages, collectReports, isReportCandidate})
  if (phase === '__exports__') return complete(shared)
  try {
    if (phase === 'init' || phase === 'main') {
      if (!/fmp\.semirapp\.com/.test(location.hostname)) throw new Error('请在已登录的森马云盘页面运行')
      const codes = [...new Set(clean(params.item_codes).split(/[\s,，;；]+/).filter(Boolean))]
      if (!codes.length || codes.some(c => !/^\d{12}$/.test(c))) throw new Error('请输入 12 位款号，一行一个')
      const cloudPath = clean(params.cloud_path)
      const split = cloudPath.indexOf('//')
      if (split < 1) throw new Error('云盘路径应为 挂载点//目录')
      const name = cloudPath.slice(0, split), root = cloudPath.slice(split + 2).replace(/^\/+|\/+$/g, '')
      if (!root || root.split('/').includes('..')) throw new Error('请选择摄影年份或季节目录')
      const mounts = await request('/fengcloud/1/account/mount')
      const mount = (mounts.list || mounts).find(m => m.org_name === name)
      if (!mount) throw new Error('未找到云盘挂载点：' + name)
      const reportMounts = (mounts.list || mounts).filter(m => String(m.mount_id)===String(mount.mount_id) || REPORT_MOUNTS.has(m.org_name)).map(m => ({mount_id:String(m.mount_id),org_name:m.org_name}))
      return next('collect', {codes, mountId: String(mount.mount_id), reportMounts, root, index: 0, rows: []})
    }
    if (phase === 'collect') {
      const code = shared.codes[shared.index]
      if (!code) return complete(shared)
      let assets, imageError = ''
      try { assets = await collect(code, shared.mountId, shared.root) }
      catch (error) { assets = []; imageError = error.message }
      // Keep image search in the selected season; report search spans the related mounts.
      assets = assets.filter(a => !/\.pdf$/i.test(a.filename))
      const reports = await collectReports(code, shared.reportMounts || [{mount_id:shared.mountId,org_name:'当前挂载点'}])
      assets.push(...reports.assets)
      const rows = reports.errors.map(error => ({'款号':code,'素材类型':'report','下载结果':'报告探查未完成','备注':error})), downloads = []
      if (imageError) rows.push({'款号':code,'下载结果':'图片查找失败','备注':imageError})
      if (!reports.assets.length) rows.push({'款号':code,'素材类型':'report','下载结果':'未找到报告候选','备注':'已搜索相关挂载点及同款目录；'+(reports.errors.length?'部分目录失败，不能断言无报告':'未发现非尺寸表PDF')})
      for (let n = 0; n < assets.length; n++) {
        const asset = assets[n]
        const row = {'款号':code, '素材类型':asset.sourceType || sourceKind(asset.fullpath), '文件名':asset.filename, '云盘路径':asset.fullpath, '云盘挂载点':asset.mountName || '', '报告探查':asset.sourceType==='report' ? JSON.stringify(reports.audit) : '', '下载结果':'', '本地文件':'', '备注':''}
        try {
          const info = await request('/fengcloud/2/file/info', {mount_id:asset.mountId || shared.mountId, fullpath:asset.fullpath})
          const url = clean(info.uri || info.uris?.[0])
          if (!url || !/^https?:\/\//.test(url)) throw new Error('未取得下载地址')
          downloads.push({url, filename:`${code}_${String(n).padStart(4,'0')}.${asset.filename.split('.').pop()}`, label:asset.filename, no_proxy:true, headers:{Referer:location.origin+'/'}, timeout_seconds:120})
        } catch (error) { row['下载结果']='获取下载链接失败'; row['备注']=error.message }
        rows.push(row)
      }
      if (!assets.length) rows.push({'款号':code,'下载结果':'未找到素材','备注':'指定范围内未找到精确款号的静物、设计可用模特或检测报告文件夹'})
      const state = {...shared, pending:rows, current_buyer_id:code, current_store:'迷你巴拉整图整理', current_exec_no:shared.index+1, total_rows:shared.codes.length}
      if (!downloads.length) return next('advance', {...state, rows:[...shared.rows,...rows]})
      return {success:true,data:[],meta:{action:'download_urls',items:downloads,shared_key:'downloads',concurrency:6,retry_attempts:3,retry_delay_ms:1500,timeout_seconds:120,next_phase:'downloaded',shared:state}}
    }
    if (phase === 'downloaded') {
      let index = 0
      const rows = shared.pending.map(row => {
        if (row['下载结果']) return row
        const result = (shared.downloads?.items || [])[index++] || {}
        return {...row,'下载结果':result.success?'已下载':'下载失败','本地文件':result.path||'','备注':result.success?'':String(result.error||'下载结果缺失')}
      })
      return next('advance', {...shared, rows:[...shared.rows,...rows], pending:[], downloads:{}})
    }
    if (phase === 'advance') return next('collect', {...shared,index:shared.index+1})
    throw new Error('未知执行阶段：'+phase)
  } catch (error) { return {success:false,error:String(error.message||error),data:shared.rows||[]} }
})()
