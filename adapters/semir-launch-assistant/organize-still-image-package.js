;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const token = window.__CRAWSHRIMP_RUN_TOKEN__
  const SOURCE_MOUNT = '森马视觉'
  const SOURCE_BASE = '01-拍摄企划/01-服饰/00-季度所有图片'
  const TARGET_MOUNT = '森马bu-森马商品'
  const TARGET_ROOT = '3-商品上新/3-01季度上新/2026年/26Q3/静物图/测试'
  const OCR_ASSETS = '/adapter-assets/tmall-ops-assistant/vendor/tesseract/'
  const ID = /^[A-Z0-9]{12}[A-Z]?$/
  const COLOR = /^[A-Z0-9]{5}$/
  const IMAGE = /\.(jpe?g|png|webp|bmp|gif|tiff?|heic|avif)$/i
  const SCREEN_SIZE = 224
  const SCREEN_BATCH = 8
  const OTHER_THRESHOLD = 0.995
  const namedLabel = /吊牌|洗[唛标]|水洗|hang.?tag|(?:wash|care).?label/i

  const clean = value => String(value ?? '').normalize('NFKC').trim()
  const isDir = item => [1, '1', true].includes(item.dir)
  const inside = (path, root) => path === root || path.startsWith(root + '/')
  const safeName = name => !!name && name !== '.' && name !== '..' && !/[\\/:*?"<>|\x00-\x1f]/.test(name)
  const validPath = path => typeof path === 'string' && path.split('/').every(safeName)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const next = (name, state, sleep = 0) => ({
    success: true, data: [], meta: { action: 'next_phase', next_phase: name, shared: state, sleep_ms: sleep },
  })

  function dateOf(value) {
    const text = clean(value)
    const parts = text.match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})(?=$|[日T\s])/)
    const date = parts && [parts[1], parts[2].padStart(2, '0'), parts[3].padStart(2, '0')].join('-')
    return date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : ''
  }

  function parseBatch(value) {
    const match = clean(value).toUpperCase().match(/^(?:第\s*([0-9]{1,2})\s*批|([0-9]{1,2})\s*P)$/)
    const number = Number(match?.[1] || match?.[2])
    return number > 0 ? { label: `第${number}批`, folder: `${number}P` } : null
  }

  function batchRows(input, subset) {
    const tables = Object.values(input?.sheets || {})
    const rows = tables.length ? tables.flatMap(sheet => sheet.rows || []) : input?.rows || []
    if (!rows.length) throw new Error('请上传包含上架明细的 Excel')
    const styles = new Map(), errors = [], blocked = new Set()
    let selected = 0
    for (const row of rows) {
      const seasonKey = Object.keys(row).find(key => /^Q季|^季度$|^上新季$|^上市季$/.test(key))
      const season = clean(row[seasonKey]).toUpperCase(), rawBatch = clean(row.批次)
      const parsedBatch = parseBatch(rawBatch), batch = parsedBatch?.label || rawBatch
      const rawDate = row.电商上市日期 || row.上市日期
      const date = dateOf(rawDate)
      const style = clean(row.款号).toUpperCase(), skc = clean(row.款色).toUpperCase().replace(/-/g, '')
      if (subset.size && !subset.has(style)) continue
      if (!style && !skc) continue
      selected++
      const color = clean(row.色号 || skc.slice(-5)).toUpperCase().replace(/^\d{1,4}$/, value => value.padStart(5, '0'))
      const name = clean(row.色名), gender = clean(row.性别)
      const group = { 女: '女', 男: '男', 中性: '男' }[gender]
      const detail = { 批次: season + batch, 款号: style, 款色: skc, 色号: color, 色名: name, 性别: gender, 上市日期: date || clean(rawDate) }
      const key = detail.批次 + '/' + style
      if (/取消/.test(rawBatch)) {
        errors.push({ ...detail, 整理结果: '已取消', 备注: '表格批次标记为取消' })
        continue
      }
      if (!/^\d{2}Q[1-4]$/.test(season) || !parsedBatch || !date) {
        errors.push({ ...detail, 整理结果: '上架计划待确认', 备注: '请核对季度、批次和上市日期' })
        continue
      }
      if (!ID.test(style) || !COLOR.test(color) || !safeName(name) || !group) {
        errors.push({ ...detail, 整理结果: '表格字段异常', 备注: '请核对款号、色号、色名和性别' })
        if (ID.test(style)) blocked.add(key)
        continue
      }
      const notes = []
      if (skc !== style + color) notes.push('款色与款号拼色号不一致，按独立款号和色号查找，需复核表格')
      const nameCode = name.match(/[A-Z0-9]{5}$/i)?.[0]?.toUpperCase()
      if (nameCode && /\d/.test(nameCode) && nameCode !== color) {
        errors.push({ ...detail, 整理结果: '表格字段异常', 备注: '色名末尾编码与色号不一致' })
        blocked.add(key)
        continue
      }
      const target = nameCode === color ? name : name + color
      if (target !== name) notes.push('色名未含色号，已补齐')
      const job = styles.get(key) || { style, season, batch, batchFolder: parsedBatch.folder, group, colors: [] }
      const prior = job.colors.find(item => item.色号 === color)
      if (job.group !== group || (prior && (prior.target !== target || prior.款色 !== skc))) {
        errors.push({ ...detail, 整理结果: '表格字段冲突', 备注: '同款分类或同款色命名冲突' })
        blocked.add(key)
        continue
      }
      if (prior) {
        if (!prior.dates.includes(date)) prior.dates.push(date)
      } else {
        job.colors.push({ ...detail, target, notes, dates: [date] })
      }
      styles.set(key, job)
    }
    if (!selected) throw new Error('表格未找到可处理的款号或款色')
    for (const key of blocked) {
      for (const row of styles.get(key)?.colors || []) {
        errors.push(...resultRows(row, { 整理结果: '整款待复核', 备注: '同款存在表格字段异常或冲突' }))
      }
      styles.delete(key)
    }
    return { jobs: [...styles.values()], errors }
  }

  async function request(path, args, post = false, timeout = 12000) {
    const response = await fetch('/fengcloud' + path + (post ? '' : '?' + new URLSearchParams(args)), {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeout),
      ...(post && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || data.error_code || data.error || data.success === false) {
      const error = new Error(`云盘 ${path} HTTP ${response.status}${data?.error_msg ? ' ' + data.error_msg : ''}`)
      error.httpStatus = response.status
      error.busy = response.status === 403 && /空间正在被操作中/.test(data?.error_msg || '')
      error.sessionExpired = response.status === 401 || response.redirected ||
        Number(data?.error_code) === 40106 || /登录超时|登录失效|请重新登录/.test(data?.error_msg || '')
      throw error
    }
    return data
  }

  async function pages(path, args, post = false) {
    const items = [], seen = new Set(), size = 100
    for (let start = 0; start < 20000; start += size) {
      const page = await request(path, { ...args, start, size }, post)
      if (!Array.isArray(page.list)) throw new Error('云盘未返回文件列表')
      for (const item of page.list) {
        if (!validPath(item.fullpath) || !safeName(item.filename)) throw new Error('云盘返回无效文件路径')
        if (seen.has(item.fullpath)) throw new Error('云盘列表分页重复，请重试')
        seen.add(item.fullpath)
        items.push(item)
      }
      const expected = post ? page.total : page.count
      if ((expected != null && start + size >= Number(expected)) || (!page.list.length && expected == null)) return items
      if (!post && page.list.length < size) {
        if (expected == null) return items
        throw new Error('云盘列表分页提前结束')
      }
      if (post && !page.list.length && expected != null && !Number.isFinite(Number(expected))) throw new Error('云盘搜索分页异常')
    }
    throw new Error('云盘列表超过两万条')
  }

  async function list(mountId, path) {
    if (!validPath(path)) throw new Error('无效目录路径')
    const items = await pages('/1/file/ls', { mount_id: mountId, fullpath: path, current: 1, order: 'filename asc' })
    if (items.some(item => item.fullpath !== path + '/' + item.filename || String(item.mount_id) !== mountId)) {
      throw new Error('云盘返回范围外文件')
    }
    return items
  }

  function parseAddress(value) {
    const raw = String(value || '').trim()
    let mount, mountId, path
    if (/^https:\/\//i.test(raw)) {
      const url = new URL(raw)
      const [route, query] = url.hash.split('?')
      mountId = route.match(/^#\/home\/file\/mount\/(\d+)$/)?.[1]
      path = new URLSearchParams(query).get('path')
      if (url.origin !== 'https://fmp.semirapp.com' || !mountId) throw new Error('请输入森马云盘文件夹地址')
    } else {
      const parts = raw.split('//')
      if (parts.length !== 2 || !safeName(parts[0].trim())) throw new Error('云盘路径格式为「库名//目录/子目录」')
      ;[mount, path] = [parts[0].trim(), parts[1]]
    }
    path = String(path || '').replace(/^\/+|\/+$/g, '')
    if (!validPath(path)) throw new Error('请填写具体云盘目录')
    return { mount, mountId, root: path }
  }

  function sourceRootList(state, job) {
    if (state.sources.length) return state.sources
    const years = new Set(job.colors.flatMap(row => row.dates).flatMap(date => {
      const year = Number(date.slice(0, 4))
      return [year, year - 1]
    }))
    return [...years].map(year => ({ ...state.defaultSource, root: SOURCE_BASE + '/' + year + '年' }))
  }

  async function findSource(state, job) {
    const roots = sourceRootList(state, job)
    const pagesByRoot = await Promise.all(roots.map(source => pages('/2/file/search', {
      mount_id: source.mountId, fullpath: source.root, keyword: job.style, scope: '["filename","tag"]',
    }, true)))
    const staticPath = path => path.split('/').some(part => /^静物(?:图|图包)?$/.test(part))
    const discovered = roots.flatMap((source, index) => {
      const { mount, mountId, root } = source
      const dirs = pagesByRoot[index].filter(item => String(item.mount_id) === mountId &&
        inside(item.fullpath, root) && isDir(item))
      dirs.push({ fullpath: root, filename: root.split('/').at(-1) })
      return dirs.filter(item => staticPath(item.fullpath) || (source.explicit && !inside(source.root, SOURCE_BASE)))
        .map(item => ({ mount, mountId, path: item.fullpath, filename: item.filename }))
    })
    const unique = [...new Map(discovered.map(item => [item.mountId + '//' + item.path, item])).values()]
    const candidates = await Promise.all(unique.filter(item => item.filename === job.style).map(async source => {
      const items = await list(source.mountId, source.path)
      const coverage = job.colors.filter(row => items.some(item => isDir(item) &&
        [job.style + '-' + row.色号, row.target].includes(item.filename))).length
      return { ...source, items, coverage, sameSeason: source.path.split('/').includes(state.season) }
    }))
    candidates.sort((a, b) => b.coverage - a.coverage || Number(b.sameSeason) - Number(a.sameSeason))
    const [best, second] = candidates
    const standalone = job.colors.map(row => {
      const original = job.style + '-' + row.色号
      const matches = unique.filter(item => item.filename === original &&
        !item.path.split('/').slice(0, -1).includes(job.style))
      const sameSeason = matches.filter(item => item.path.split('/').includes(state.season))
      const picked = sameSeason.length ? sameSeason : matches
      if (!picked.length) return { row, issue: '缺款色图包' }
      if (picked.length > 1) return { row, issue: '多个独立款色图包同等匹配，需指定来源', alternatives: picked.map(address) }
      return { row, original, ...picked[0] }
    })
    if (!best) return standalone.some(plan => plan.path || plan.alternatives)
      ? { standalone } : { reason: '所选来源未找到款号或款色图包' }
    if (second?.coverage === best.coverage && second.sameSeason === best.sameSeason) {
      return { reason: '多个来源图包同等匹配，需指定来源', paths: candidates.map(address).join('\n') }
    }
    return { ...best, standalone }
  }

  async function tree(mountId, path, first) {
    const result = []
    async function visit(parent, children, depth) {
      if (depth > 15 || result.length + children.length > 10000) throw new Error('图包目录超出扫描范围')
      result.push(...children)
      await Promise.all(children.filter(isDir).map(async item => {
        await visit(item.fullpath, await list(mountId, item.fullpath), depth + 1)
      }))
    }
    await visit(path, first ?? await list(mountId, path), 0)
    return result
  }

  function address(source) {
    return source.mount + '//' + source.path
  }

  function requireTarget(path, root) {
    if (!validPath(root) || !validPath(path) || !path.startsWith(root + '/')) throw new Error('写入路径超出所选目标目录')
  }

  async function currentFolder(mountId, path, name) {
    return (await list(mountId, path)).find(item => item.filename === name)
  }

  async function mkdir(target, parent, name) {
    if (!safeName(name)) throw new Error('目标目录名无效')
    const path = parent + '/' + name
    requireTarget(path, target.root)
    const { mountId } = target
    const old = await currentFolder(mountId, parent, name)
    if (old && !isDir(old)) throw new Error('存在同名文件：' + name)
    if (old) return path
    let error
    try {
      await request('/2/file/create_folder', { mount_id: mountId, fullpath: path, exist_throw: 1 }, true)
    } catch (e) {
      error = e
    }
    const created = await currentFolder(mountId, parent, name)
    if (!created || !isDir(created)) throw error || new Error('新建目录后未读回：' + name)
    return path
  }

  async function batchDirectory(target, folder) {
    const existing = (await list(target.mountId, target.root)).filter(item => item.filename.toUpperCase() === folder)
    if (existing.length > 1 || existing.some(item => !isDir(item))) throw new Error('批次目录命名冲突：' + folder)
    return existing[0]?.fullpath || mkdir(target, target.root, folder)
  }

  function colorPlans(job, items) {
    return job.colors.map(row => {
      const sourceName = job.style + '-' + row.色号
      const matches = items.filter(item => [sourceName, row.target].includes(item.filename))
      if (!matches.length) return { row, issue: '缺款色文件夹' }
      if (matches.length > 1 || !isDir(matches[0])) return { row, issue: '款色文件夹命名冲突' }
      return { row, original: matches[0].filename }
    })
  }

  function canCopyWholeStyle(items, plans) {
    const selected = new Set(plans.filter(plan => plan.original && !plan.path && !plan.issue).map(plan => plan.original))
    return selected.size > 0 && items.every(item => !isDir(item) || selected.has(item.filename))
  }

  function equivalent(sourceTree, targetTree, source, target, plans, requireRenamed = false) {
    const supplemental = new Set(plans.filter(plan => plan.path).flatMap(plan => [plan.original, plan.row.target]))
    targetTree = targetTree.filter(item => !supplemental.has(item.fullpath.slice(target.length + 1).split('/')[0]))
    if (sourceTree.length !== targetTree.length) return false
    const actual = new Map(targetTree.map(item => [item.fullpath.slice(target.length + 1), item]))
    const rename = new Map(plans.filter(plan => plan.original && !plan.path).map(plan => [plan.original, plan.row.target]))
    const unplanned = new Map()
    const style = source.split('/').at(-1)
    for (const item of sourceTree) {
      const relative = item.fullpath.slice(source.length + 1)
      if (!isDir(item) || relative.includes('/') || !relative.startsWith(style + '-') || rename.has(relative) || actual.has(relative)) continue
      const color = relative.slice(style.length + 1)
      if (!COLOR.test(color)) continue
      const matches = [...actual].filter(([name, entry]) => isDir(entry) && !name.includes('/') && name.endsWith(color))
      if (matches.length === 1) unplanned.set(relative, matches[0][0])
    }
    return sourceTree.every(item => {
      const relative = item.fullpath.slice(source.length + 1)
      const first = relative.split('/')[0], desired = rename.get(first) || unplanned.get(first)
      const renamed = desired ? desired + relative.slice(first.length) : relative
      const found = actual.get(renamed) || (!requireRenamed && actual.get(relative))
      return found && isDir(found) === isDir(item) &&
        (isDir(item) || (item.filehash && item.filehash === found.filehash && Number(item.filesize) === Number(found.filesize)))
    })
  }

  async function copyPackage(state, job, source, sourceTree, parent, original, desired, plans = []) {
    const { path: sourcePath, mountId: sourceId } = source
    const { mountId: targetId, root: targetRoot } = state.target
    if (!sourceRootList(state, job).some(root => sourceId === root.mountId && inside(sourcePath, root.root)) ||
        (sourceId === targetId && (inside(sourcePath, targetRoot) || inside(targetRoot, sourcePath))) ||
        sourcePath.split('/').at(-1) !== original || !safeName(original) || !safeName(desired)) {
      throw new Error('复制来源不符')
    }
    const target = parent + '/' + original
    requireTarget(target, targetRoot)
    requireTarget(parent + '/' + desired, targetRoot)
    const findTarget = async () => {
      const items = (await list(targetId, parent)).filter(item => [original, desired].includes(item.filename))
      if (items.length > 1 || (items[0] && !isDir(items[0]))) throw new Error('目标存在同名文件或目录冲突')
      return items[0]
    }
    let existing = await findTarget()
    const alreadyExists = !!existing
    let copyError
    for (let attempt = 0; !existing && attempt < 3; attempt++) {
      try {
        const copied = await request('/1/file/copy', {
          mount_id: sourceId, target_mount_id: targetId, target_fullpath: parent,
          fullpaths: encodeURIComponent(sourcePath) + '/',
        }, true)
        for (const item of Array.isArray(copied) ? copied : [copied]) {
          if (item.fullpath && item.fullpath !== target) throw new Error('云盘复制结果发生目标冲突')
        }
        break
      } catch (error) {
        copyError = error
        if (!error.busy) break
        // An explicit busy rejection can be retried after checking the target.
        await wait(1000 * (attempt + 1))
        existing = await findTarget()
        if (!existing && attempt === 2) throw error
      }
    }
    let matches = false
    const deadline = Date.now() + (alreadyExists ? 0 : 90000)
    do {
      existing = await findTarget()
      if (existing) {
        const copiedTree = await tree(targetId, existing.fullpath)
        matches = equivalent(sourceTree, copiedTree, sourcePath, existing.fullpath, plans)
      }
      if (matches || Date.now() >= deadline) break
      await wait(1500)
    } while (true)
    if (!matches) throw new Error(copyError?.message || '目标图包与来源文件哈希或目录不一致，保留现状待复核')
    return { target: existing.fullpath, result: alreadyExists ? '已核验已有图包' : '已复制并核验' }
  }

  async function renameFolder(target, parent, original, desired) {
    if (original === desired) return
    if (!safeName(original) || !safeName(desired)) throw new Error('改名路径无效')
    const oldPath = parent + '/' + original
    const { mountId, root } = target
    requireTarget(oldPath, root)
    requireTarget(parent + '/' + desired, root)
    const current = await list(mountId, parent)
    const old = current.find(item => item.filename === original)
    const renamed = current.find(item => item.filename === desired)
    if (!old && isDir(renamed || {})) return
    if (!old || !isDir(old) || renamed) throw new Error('改名前发现目标款色目录冲突')
    let error
    try {
      await request('/1/file/rename', { mount_id: mountId, fullpath: oldPath, newname: desired }, true)
    } catch (e) {
      error = e
    }
    const check = await list(mountId, parent)
    if (check.some(item => item.filename === original) || !check.some(item => item.filename === desired && isDir(item))) {
      throw error || new Error('改名后未读回：' + desired)
    }
  }

  async function copyAndRename(state, source, job, sourceTree, plans) {
    const destination = state.target
    const batchPath = await batchDirectory(destination, job.batchFolder)
    const parent = await mkdir(destination, batchPath, job.group)
    const copied = await copyPackage(state, job, source, sourceTree, parent, job.style, job.style, plans)
    const { target } = copied
    for (const plan of plans) {
      if (plan.original && !plan.path) await renameFolder(destination, target, plan.original, plan.row.target)
    }
    if (!equivalent(sourceTree, await tree(destination.mountId, target), source.path, target, plans, true)) {
      throw new Error('整理后图包结构或文件哈希与来源不一致')
    }
    return copied
  }

  async function copyStandalone(state, job, plan, sourceTree) {
    const destination = state.target
    const batchPath = await batchDirectory(destination, job.batchFolder)
    const genderPath = await mkdir(destination, batchPath, job.group)
    const parent = await mkdir(destination, genderPath, job.style)
    const copied = await copyPackage(state, job, plan, sourceTree, parent, plan.original, plan.row.target)
    await renameFolder(destination, parent, plan.original, plan.row.target)
    const target = parent + '/' + plan.row.target
    if (!equivalent(sourceTree, await tree(destination.mountId, target), plan.path, target, [], true)) {
      throw new Error('整理后独立款色图包与来源不一致')
    }
    return { target, result: copied.result }
  }

  // Label evidence rules from Listingify b03b920 (Semir still life).
  const washInstructions = /洗[唛标]|水洗标|洗[涤滌][说說][明朋]|洗[涤滌]方法|维护方法|不可漂白|不可干洗|不可熨烫|印花部位|浸泡时间|WASH(?:ING)?\s*INSTRUC|\bCARE\s*INSTRUC|CARA\s*MENCUC|DO\s*NOT\s*BLEACH/i;
  const RETAIL_PRICE = /(?:吊牌价|零售价|\b(?:RMB|CNY)\b|[¥￥])[ \t:：¥￥]*\d{1,5}(?:[.,]\d{2})?(?![\dA-Z-])/i;
  const RETAIL_IDENTITY = /400\s*[-–—]?\s*8877\s*[-–—]?\s*588|浙江森马服饰股份有限公司/i;
  const SUPPLIER_SAMPLE = /(?:样衣|样品)(?:吊卡|卡|确认|资料|信息|编号|记录|工艺)|(?:封样|确认样)(?:卡|确认|单|表|记录|资料)|[样樣][版板](?:信息)?卡|供应商(?:送样|自制|资料表|信息表)|(?:打样|送样)(?:单|日期|记录)|(?:制版|版型|面辅料)确认表|[办辦][评評][语語]卡|拍照样|齐色办|订货样|(?:上装|下装)办卡/;
  const ABSENCE_CARD = /^(?:本款)?(?:无|無|没有|未附|暂缺|缺)(?:吊牌|(?:水)?洗[唛标嘜標]|水唛)[。.!！]*$/i;
  function hasRetailBarcode(text, styleCodes) {
    const styleBases = new Set(styleCodes.map(code => code.slice(0, 12)));
    const matches = text.matchAll(/(?:^|[^A-Z0-9])(?:商品条码|条形码|条码|\bEAN(?:-?13)?)?[ \t:：]*((?:\d[ \t]*){13})(?![ \t]*[A-Z0-9])/gm);
    for (const [, raw] of matches) {
      const digits = raw.replace(/\s/g, "");
      if (/^(\d)\1+$/.test(digits) || styleBases.has(digits.slice(0, 12)))
        continue;
      const sum = Array.from(digits).reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
      if (sum % 10 === 0)
        return true;
    }
    return false;
  }
  function readStyleCodes(text) {
    const codes = new Set();
    for (const line of text.split(/\n/)) {
      for (const match of line.matchAll(/(?<![A-Z0-9])(1[ \t]*0[ \t]*[A-Z0-9](?:[ \t]*\d){9})([A-Z0-9]*)/g)) {
        const [full, base, tail] = match;
        const spacedSuffix = line.slice(match.index + full.length)
          .match(/^(?:[ \t]*[-–—][ \t]*|[ \t]+)([A-Z])(?=[ \t]*(?:$|[-–—:/：\u3400-\u9fff])|[ \t]*[A-Z0-9]{5}\b)/)?.[1];
        let suffix = "";
        if (!tail)
          suffix = spacedSuffix || "";
        else if (/^[A-Z]([A-Z0-9]{5})?$/.test(tail))
          suffix = tail[0];
        else if (!/^[A-Z0-9]{5}$/.test(tail))
          continue;
        codes.add(base.replace(/[ \t]/g, "") + suffix);
      }
    }
    return [...codes];
  }
  function viewsOfSwatch(text) {
    return /^\s*\d{2}[1-4][A-Z]\d{2}[A-Z][A-Z0-9]{3,6}\s*$/m.test(text) &&
      /^\s*(?:XS|S|M|L|XL|XXL)\s*$/m.test(text);
  }
  function labelEvidence(text, expected) {
    const normalized = text.normalize("NFKC").trim().toUpperCase();
    const compact = normalized.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "");
    const codes = readStyleCodes(normalized);
    const absenceCard = ABSENCE_CARD.test(compact.replace(/\s/g, ""));
    const supplierCompany = /(?:服饰|服装)(?:股份)?有限公司/.test(compact) && !RETAIL_IDENTITY.test(compact);
    const patternRoomCard = /车版[师師]/.test(compact) && /完成日期/.test(compact) && /款[号號]/.test(compact);
    const supplierSample = patternRoomCard || /^\s*(?:[版板]单号|[版板]單號)\s*$/m.test(normalized) && !/合格证|检验员|成[分份]|洗涤说明/.test(compact) || /试样单|工艺(?:制单|资料|单号|单|表)|生产工单|样衣单|样品单|供应商样卡/.test(compact) || SUPPLIER_SAMPLE.test(compact) ||
      /标[准準]尺寸|標準尺寸/.test(compact) && /相差|度法/.test(compact) && /部位|袖口|胸[围圍]/.test(compact) ||
      /设计编号/.test(compact) && /码数/.test(compact) && /克重/.test(compact) ||
      /版[师師]|裁版|车版/.test(compact) && /[设設][计計][师師]/.test(compact) ||
      supplierCompany && /版[师師]|裁版|车版|[设設][计計][师師]/.test(compact) ||
      /\b(?:PROTO|PRE-PROD)\b/.test(compact) && /\b(?:APPROVAL|SHIPMENT)\b/.test(compact) ||
      /\bSTYLE\s*NO\b/.test(compact) && /\bGAUGE\b/.test(compact) && /\b(?:LOT\s*NO|REMARKS)\b/.test(compact);
    const hangCandidate = /吊牌|合格证/.test(compact) ||
      /执行标准|产品标准/.test(compact) && /安全技术类别|质量等级|检验员/.test(compact);
    // The removable fabric-care insert describes the fabric finish and daily
    // wear. Its English heading also contains the words "care instructions".
    const lyocellCareInsert = /KINDLY\s*REMINDER/.test(normalized) && /LYOCELL/.test(normalized) &&
      /FOLLOWING\s*CARE\s*INSTRUCTIONS/.test(normalized) && /SMOOTH\s*TEXTURE|SURFACE\s*ABRASION/.test(normalized);
    const snaggingInsert = /特殊的工艺处理/.test(compact) && /松散组织结构/.test(compact) && /勾纱/.test(compact) &&
      !codes.length && !/成[分份]|洗涤说明|执行标准|中国制造/.test(compact);
    const fabricCareInsert = snaggingInsert || lyocellCareInsert || /HARD\s*SHELL\s*CARE\s*INSTRUC/.test(normalized) ||
      /TREATED\s*WITH\s*A\s*SPECIAL\s*PROCESS/.test(normalized) && /DAILY\s*WEAR|FOLLOW\s*THESE\s*TIPS/.test(normalized);
    // Sewing samples can carry just a workshop reference, the style and a size
    // on a handwritten strip. Keep ordinary SKU-only readings unresolved.
    const swatchReference = viewsOfSwatch(normalized) && !hangCandidate && !washInstructions.test(compact) &&
      !/成[分份]|面料|零售价|条码|检验员|中国制造|COMPOSITION|SEMIR/.test(compact);
    const warrantyInsert = /质量保证卡/.test(compact) && /购买之日|原购买地点|保证范围/.test(compact);
    const illustratedInsert = /(?:吊牌|卡片)正面产品图仅为示意图/.test(compact) && /具体款式以实物为准/.test(compact) &&
      !codes.length && !/合格证|安全技术类别|检验员|商品条码/.test(compact) && !RETAIL_PRICE.test(compact) && !hasRetailBarcode(compact, [expected]);
    const excluded = illustratedInsert || supplierSample || absenceCard || fabricCareInsert || swatchReference || warrantyInsert;
    const certificateIdentity = RETAIL_IDENTITY.test(compact) || /合格证\s*SEM(?:I|\/)R\b/.test(compact);
    const shootFields = /到样时间|拍摄备注|不拍视频/.test(compact) && /上市日|FAB|资源/.test(compact);
    // Some shoot stickers contain only two printed lines and cover the whole
    // product panel. Verify the official company and hotline on the exposed footer.
    const isolatedSticker = /^1[0O][A-Z0-9]\d{9}[A-Z]?[ \t]*\n[ \t]*[-–—][ \t]*[A-Z0-9]{5}[ \t]*$/m.test(normalized) &&
      /浙江森马服饰股份有限公司/.test(compact) && /400\s*[-–—]?\s*8877\s*[-–—]?\s*588/.test(compact) &&
      !/执行标准|安全技术类别|品名|产品名称|检验员|质量等级/.test(compact);
    const shootSticker = (/合格证/.test(compact) && certificateIdentity && shootFields || isolatedSticker) &&
      !RETAIL_PRICE.test(compact) && !hasRetailBarcode(compact, [expected, ...codes]);
    const hasHang = !excluded && (shootSticker ||
      (codes.length > 0 || /品名|产品名称|质量等级|检验员|安全技术类别/.test(compact)) && (RETAIL_PRICE.test(compact) || hasRetailBarcode(compact, [expected, ...codes])) ||
      /商品条码|零售条码/.test(compact) && /品名|产品名称|质量等级|检验员/.test(compact) ||
      codes.length > 0 && RETAIL_IDENTITY.test(compact) && /款[号號]|色[号號]|合格证|执行标准/.test(compact));
    const washComposition = /(?:中国制造|MADE\s+IN\s+CHINA)/i.test(compact) &&
      (/成[分份]|COMPOSITION|BAHAN/i.test(compact) || /面料/.test(compact) && /分开洗|洗涤|浸泡|10\s*分钟/.test(compact)) &&
      /\d\s*%/.test(compact) && codes.length > 0;
    const hasWash = !excluded && (washInstructions.test(compact) || !hasHang && washComposition);
    const ambiguous = hasWash && hasHang;
    const kind = ambiguous ? null : hasHang ? "hangtag" : hasWash ? "washlabel" : null;
    return { kind, codes: shootSticker ? [] : codes, matched: !shootSticker && codes.includes(expected), excluded, shootSticker, supplierSample, absenceCard,
      ambiguous, hangCandidate, conflict: false };
  }
  // Two readings of the same photo may disagree. Require agreement before
  // reporting a mismatch, and retain a complete suffix when another view lost it.
  function mergeLabelViews(views, style, supplierScore = 0) {
    const text = views.join("\n");
    const evidence = labelEvidence(text, style);
    // On sample certificates the handwriting can run across the preprinted card.
    // Require a supplier-like thumbnail, a legible certificate heading and footer,
    // and a separate reading of the bare handwritten digits.
    const normalized = text.normalize("NFKC").toUpperCase();
    const blankCertificate = supplierScore >= 0.8 && !evidence.shootSticker &&
      views.some(view => /合格证\s*SEM(?:I|\/)R/i.test(view) && RETAIL_IDENTITY.test(view)) &&
      views.some(view => /^(?:10\d{8,10}[A-Z]?)(?:\s+\d{5})?$/i.test(view.trim())) &&
      !/执行标准|安全技术类别|品名|产品名称|零售价|检验员|质量等级|款[号色]|洗涤|上市日|拍摄备注|到样时间|FAB|\bPRICE\b/.test(normalized) &&
      !RETAIL_PRICE.test(normalized) && !hasRetailBarcode(normalized, [style, ...evidence.codes]);
    if (blankCertificate)
      return { ...evidence, kind: null, codes: [], matched: false, excluded: true, handwrittenCertificate: true };
    if (supplierScore >= 0.99 && !evidence.kind && !evidence.hangCandidate && !evidence.excluded) {
      const isColor = /^(?:[A-Z0-9]{5}|[\u3400-\u9fff]{0,7}[色红黄橙绿青蓝紫棕灰黑白])$/u;
      const slips = views.filter(view => {
        const lines = view.normalize("NFKC").toUpperCase().split(/\n/).map(line => line.replace(/\s+/g, "")).filter(Boolean);
        return lines.includes(style) && lines.some(line => isColor.test(line)) &&
          lines.every(line => line === style || isColor.test(line));
      });
      if (slips.length >= 2)
        return { ...evidence, excluded: true };
    }
    if (supplierScore >= 0.85 && !evidence.kind && !evidence.hangCandidate && !evidence.excluded &&
      !/面料|成[分份]|品名|零售|条码|SEMIR|COMPOSITION|MADE IN/.test(normalized)) {
      const lines = views.map(view => view.trim().replace(/[ \t]+/g, "").toUpperCase());
      for (const view of lines) {
        const [code, color, ...extra] = view.split(/\n+/);
        if (code === style && /^\d{5}$/.test(color ?? "") && !extra.length &&
          lines.filter(line => line === color).length >= 2)
          return { ...evidence, excluded: true };
      }
    }
    const readings = views.map(text => readStyleCodes(text.normalize("NFKC").toUpperCase())).filter(codes => codes.length);
    const complete = evidence.codes.filter(code => !evidence.codes.some(other => other.length === 13 && other.slice(0, 12) === code));
    const agreed = complete.filter(code => readings.filter(codes => codes.includes(code)).length >= 2);
    // A corrected hangtag can show a handwritten number alongside the original
    // printed SKU above the barcode. Require the full style-color pair in two
    // views before giving it precedence over unstructured numbers on the card.
    const pairs = new Map();
    if (evidence.kind === "hangtag" && complete.length > 1) {
      for (const view of views) {
        const matches = view.normalize("NFKC").toUpperCase()
          .matchAll(/(?<![A-Z0-9])(10[A-Z0-9]\d{9}[A-Z]?)[ \t]*[-–—][ \t]*([A-Z0-9]{5})(?![A-Z0-9])/g);
        for (const pair of new Set(Array.from(matches, match => match[1] + "-" + match[2]))) {
          pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
        }
      }
    }
    const [pair] = pairs.keys();
    const codes = pairs.size === 1 && pairs.get(pair) >= 2 ? [pair.split("-")[0]] : agreed.length ? agreed : complete;
    return { ...evidence, codes, matched: codes.includes(style), conflict: codes.length > 1 };
  }
  // Use the independent printed-text crops after the complete scan. Bare style
  // references and dye-lot numbers occur on temporary cards and sewn sample strips.
  function isHandwrittenSample(printedViews, supplierScore) {
    const views = printedViews.map(text => text.normalize("NFKC").toUpperCase().trim()).filter(Boolean);
    const lines = views.flatMap(view => view.split(/\n/).map(line => line.replace(/\s+/g, "")));
    if (lines.some(line => /合格证|SEMIR|成[分份]|面料|洗涤|洗唛|制造|等级|条码|执行标准|品名|款号|FAB|PRICE|COMPOSITION|WASH|COTTON|%/.test(line)))
      return false;
    if (supplierScore >= 0.9 && lines.includes("拍摄样") &&
      lines.some(line => /^10[0-9A-Z]{9,12}$/.test(line)))
      return true;
    const dyeCodes = lines.filter(line => /^(?:线|纱|線|紗)?色\d{3,6}$/.test(line));
    if (dyeCodes.some(code => dyeCodes.filter(other => other === code).length >= 2) &&
      lines.some(line => /^\d[\d/]{3}\d$/.test(line)))
      return true;
    // Different crops may lose digits or turn the last strokes into a slash.
    return supplierScore >= 0.9 && views.length >= 2 && lines.some(line => /^10\d{10}[A-Z]?$/.test(line)) &&
      lines.every(line => /^[0-9/]{1,17}[A-Z]?$/.test(line) || /^[深浅粉红蓝黑白灰米棕黄绿色]{1,4}[0-9/]{0,5}$/.test(line));
  }
  // A reference card can carry printed field names alongside handwritten digits.
  // Independent crops must repeat the reference without any retail or care fields.
  function isReferenceOnlyCard(views, style, other, supplier) {
    const readings = views.map(view => view.normalize("NFKC").toUpperCase().replace(/[ \t]/g, "").trim()).filter(Boolean);
    if (other < 0.98 || readings.some(view => view.length > 48 ||
      /合格证|浙江森马|SEMIR|成[份分]|面料|维护|洗[涤唛标]|执行标准|安全|检验|产品|零售|条码|\d%|制造|PRICE|COMPOSITION/.test(view)))
      return false;
    const hasStyle = (line) => line.replace(/^(?:款[号號]?|[号號])?:?/, "") === style;
    const withStyle = readings.filter(view => view.split("\n").some(hasStyle));
    if (withStyle.length < 2)
      return false;
    const shortFields = readings.every(view => view.split("\n").every(line => /^(?:[\u3400-\u9fff]{0,2}|#):?[0-9/]{1,17}[A-Z]?$/.test(line) || /^(?:款|色)[号號]?$/.test(line)));
    if (supplier >= 0.98 && shortFields && withStyle.some(view => view.split("\n").some(line => /^款/.test(line) && hasStyle(line))))
      return true;
    // A short workshop heading can precede the SKU and five-digit color.
    const colors = withStyle.flatMap(view => Array.from(view.matchAll(/^色[号號]:?(\d{5})$/gm), m => m[1]));
    return colors.some(color => colors.filter(value => value === color).length >= 2) &&
      withStyle.every(view => view.split("\n").every(line => hasStyle(line) || /^(?:色[号號]:?)?\d{5}$/.test(line) || /^[\u3400-\u9fff]{2,6}$/.test(line)));
  }
  function isCompositionOnlyLabel(views, washScore) {
    const material = /^(\d{1,3}(?:\.\d+)?)%(?:棉|羊毛|羊绒|麻|锦纶|氨纶|涤纶|聚酯纤维|粘纤|粘胶纤维|莱赛尔|莫代尔|腈纶|桑蚕丝)$/;
    const readings = new Set();
    for (const view of views) {
      const lines = view.normalize("NFKC").trim().replace(/[ \t]/g, "").split(/\n+/);
      if (/^\d{3,6}-\d{1,3}$/.test(lines[0]))
        lines.shift();
      if (!/^成[份分]:?$/.test(lines.shift() ?? "") || !lines.length || lines.length > 8)
        continue;
      const total = lines.reduce((sum, line) => sum + Number(material.exec(line)?.[1]), 0);
      if (!(Math.abs(total - 100) < 0.1))
        continue;
      const composition = lines.join("\n");
      if (washScore > 0.5 || readings.has(composition))
        return true;
      readings.add(composition);
    }
    return false;
  }
  function onlyShootInformation(views) {
    const text = views.join("\n").normalize("NFKC").toUpperCase();
    return /FAB/.test(text) && /不拍视频|拍摄备注|到样时间/.test(text) && /上市日|定位/.test(text) &&
      !/合格证|执行标准|安全技术类别|检验员/.test(text) && !RETAIL_IDENTITY.test(text) &&
      !RETAIL_PRICE.test(text) && !hasRetailBarcode(text, readStyleCodes(text));
  }

  function observedLabel(file, evidence) {
    const kinds = evidence.ambiguous ? ['待区分'] :
      evidence.kind === 'hangtag' ? ['吊牌'] : evidence.kind === 'washlabel' ? ['洗唛'] : []
    return { ...evidence, file, kinds, codeConflict: evidence.conflict }
  }

  function isRepeatedWorkshopCard(printedViews, style) {
    const colors = new Map()
    for (const view of printedViews) {
      const lines = clean(view).toUpperCase().split(/\n/).map(line => line.replace(/\s+/g, '')).filter(Boolean)
      if (lines.length === 3 && /^[\u3400-\u9fff]{2,8}$/.test(lines[0]) &&
          !/森马|合格证|吊牌|洗唛|洗标|成分|面料|标签/.test(lines[0])) lines.shift()
      if (lines.length !== 2 || lines[0].replace(/^(?:款)?[号號]:?/, '') !== style) continue
      const color = lines[1].match(/^(色[号號]:?)?([A-Z0-9]{5})$/)
      if (!color) continue
      const [, field, value] = color
      const labeled = Boolean(field && lines[0] !== style)
      if (colors.has(value) && (colors.get(value) || labeled)) return true
      colors.set(value, labeled)
    }
    return false
  }

  function ocrEvidence(file, text, expected) {
    return observedLabel(file, labelEvidence(text, expected))
  }

  function summarizeLabel(evidence, kind, style, failed) {
    const candidates = evidence.filter(item => item.kinds.includes(kind))
    const parent = style.length === 13 ? style.slice(0, -1) : ''
    const uncertain = evidence.filter(item => {
      if (item.excluded) return false
      return item.kinds.includes('待区分') ||
        (!item.kinds.length && (item.codes.some(code => code === style || parent && code.startsWith(parent)) ||
          (item.scores?.[kind === '吊牌' ? 0 : 1] || 0) >= 0.9 ||
          kind === '吊牌' && (item.hangCandidate || item.barcodeLocated)))
    })
    const confirmed = candidates.filter(item => item.matched && !item.codeConflict)
    const mismatched = candidates.filter(item => !item.codeConflict && item.codes.some(code => code !== style && code !== parent))
    let status = '未检出，待复核'
    if (mismatched.length) status = '识别到不一致款号，待复核'
    else if (candidates.some(item => item.codeConflict)) status = '款号识别结果冲突，待复核'
    else if (confirmed.length) status = failed ? '部分图片识别失败，待复核' : '一致'
    else if (parent && candidates.some(item => item.codes.includes(parent))) status = '款号后缀未读出，待复核'
    else if (candidates.length) status = '已识别类型，款号未读出'
    else if (failed) status = '部分图片识别失败，待复核'
    else if (uncertain.length) status = '有候选图片，类型待复核'
    const matches = status === '一致' ? confirmed : mismatched.length ? mismatched : candidates.length ? candidates : uncertain
    const result = {
      status, files: matches.map(item => item.file).join('\n'),
      codes: [...new Set(matches.flatMap(item => item.codes))].join('、'),
    }
    if (kind === '吊牌') {
      result.excludedFiles = evidence.filter(item => item.supplierSample).map(item => item.file)
      result.handwrittenFiles = evidence.filter(item => item.handwrittenSample || item.handwrittenCertificate).map(item => item.file)
    }
    result.absenceCardFiles = evidence.filter(item => item.absenceCard).map(item => item.file)
    return result
  }

  function ocrWorkerLimit(threads, memoryGb) {
    const cpu = Math.max(1, Math.floor((Number(threads) || 4) * 2 / 3))
    const memory = Number(memoryGb)
    const memoryLimit = memory > 0 ? Math.max(1, Math.floor(memory / 2)) : 6
    return Math.min(12, cpu, memoryLimit)
  }

  function ocrDeadline(promise, timeoutMs, message) {
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { ocrTimeout: true })), timeoutMs)
    })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
  }

  function localApiOrigin() {
    const raw = new URL(params.__crawshrimp_api_base_url || 'http://127.0.0.1:18765')
    if (raw.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(raw.hostname)) throw new Error('图片核验需要本机抓虾运行时')
    return raw.origin
  }

  async function browserWorker(runtime) {
    const base = localApiOrigin() + OCR_ASSETS
    runtime.run.tesseract ??= (async () => {
      const response = await fetch(base + 'tesseract.min.js', { signal: AbortSignal.timeout(8000), credentials: 'omit' })
      if (!response.ok) throw new Error('Tesseract OCR 资源不可用')
      // The pinned browser OCR runtime is already bundled with Crawshrimp.
      ;(0, eval)(await response.text())
      return window.Tesseract
    })()
    const tesseract = await runtime.run.tesseract
    const created = tesseract.createWorker('chi_sim+eng', 1, {
      workerPath: base + 'worker.min.js', corePath: base,
      langPath: base + 'lang', cacheMethod: 'none',
    })
    try {
      return await ocrDeadline(created.then(async worker => {
        await worker.setParameters({ tessedit_pageseg_mode: '11' })
        return worker
      }), 30000, '浏览器 OCR 初始化超时')
    } catch (error) {
      void created.then(worker => worker.terminate()).catch(() => {})
      throw error
    }
  }

  function cropLabelCanvas(bitmap, layout, retry) {
    const focused = layout !== 'full'
    const lower = layout === 'lower'
    const detail = layout === 'detail'
    const labelBottom = layout === 'labelBottom'
    const width = Math.max(1, Math.round(bitmap.width * (detail ? 0.24 : lower ? 0.28 : focused ? 0.384 : 1)))
    const height = Math.max(1, Math.round(bitmap.height * (detail ? 0.60 : lower ? 0.42 : labelBottom ? 0.45 : focused ? 0.81 : 1)))
    const limit = retry ? 1150 : detail || lower ? 1550 : focused ? 1450 : 1600
    const scale = Math.min(1, limit / Math.max(width, height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const ctx = canvas.getContext('2d', { willReadFrequently: focused })
    const y = labelBottom ? Math.round(bitmap.height * 0.52) :
      Math.round((bitmap.height - height) * (detail ? 0.58 : lower ? 0.89 : 0.5))
    ctx.drawImage(bitmap, Math.round((bitmap.width - width) / 2), y, width, height, 0, 0, canvas.width, canvas.height)
    if (!focused) return canvas
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const histogram = new Uint32Array(256)
    const rgba = pixels.data
    for (let i = 0; i < rgba.length; i += 4) {
      const value = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
      rgba[i] = value
      histogram[value]++
    }
    const cutoff = rgba.length / 400
    let low = 0, high = 255, dark = histogram[0], light = histogram[255]
    while (low < high && dark < cutoff) dark += histogram[++low]
    while (high > low && light < cutoff) light += histogram[--high]
    const contrast = 255 / Math.max(1, high - low)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = (rgba[i] - low) * contrast
      rgba[i + 1] = rgba[i + 2] = rgba[i]
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas
  }

  function combineOcrViews(file, first, second, expected, ...additional) {
    return observedLabel(file, mergeLabelViews([first, second, ...additional].filter(Boolean), expected))
  }

  async function readPrintedLabel(canvas, mode) {
    const credential = params.__crawshrimp_semir_screen_token
    if (!credential) return null
    try {
      const body = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
      const response = await fetch(localApiOrigin() + '/semir-still-images/read-label?mode=' + mode, {
        method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'image/jpeg', 'X-Crawshrimp-Token': credential }, body,
      })
      if (!response.ok) return null
      const result = await response.json()
      return typeof result.text === 'string' ? result : null
    } catch {
      return null
    }
  }

  function boundedLabelFrame(bitmap, edge, angle = 0) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(angle ? height : width, angle ? width : height)
    const context = canvas.getContext('2d')
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(angle * Math.PI / 180)
    context.drawImage(bitmap, -width / 2, -height / 2, width, height)
    return canvas
  }

  async function fetchOcrImage(mountId, item) {
    const info = await request('/2/file/info', {
      mount_id: mountId, fullpath: item.fullpath, ignores: 'tag,favorite,lock,preview,thumbnail',
    })
    if (info.fullpath !== item.fullpath || String(info.mount_id) !== mountId ||
        (item.filehash && info.filehash && item.filehash !== info.filehash)) throw new Error('OCR 来源文件不符')
    const url = new URL(info.uri || info.uris?.[0], location.href)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.semirapp.com')) throw new Error('OCR 图片地址不属于森马云盘')
    const image = await fetch(url, {
      credentials: url.origin === location.origin ? 'same-origin' : 'omit', cache: 'no-store', signal: AbortSignal.timeout(45000),
    })
    if (image.status === 401) throw sessionExpired()
    if (!image.ok) throw Object.assign(new Error('读取图片失败 HTTP ' + image.status), { httpStatus: image.status })
    return image.blob()
  }

  async function loadOcrImage(mountId, item) {
    const delays = [650, 2200, 6000]
    for (const delay of delays) {
      try {
        return await fetchOcrImage(mountId, item)
      } catch (error) {
        const status = error.httpStatus
        if (error.sessionExpired || !(error.name === 'TypeError' || status === 408 || status === 429 || status >= 500 && status <= 599)) throw error
        await wait(delay)
      }
    }
    return fetchOcrImage(mountId, item)
  }

  async function recognize(worker, mountId, item, style, scores, attempt = 0) {
    const bitmap = await createImageBitmap(await loadOcrImage(mountId, item))
    try {
      const supplier = scores?.[3] || 0
      const other = (scores?.[2] || 0) + supplier
      let focused = !scores || other < OTHER_THRESHOLD || supplier >= 0.8 || namedLabel.test(item.filename)
      const views = [], printedViews = []
      let evidence = labelEvidence('', style)
      let barcodeLocated = false
      let skuFromBarcodeRegion = ''
      const crop = layout => cropLabelCanvas(bitmap, layout, attempt > 0)
      const resolved = () => evidence.excluded || evidence.shootSticker ||
        Boolean(evidence.kind && evidence.matched && !evidence.conflict)

      async function read(canvas, psm = '11') {
        if (attempt > 0 && Math.max(canvas.width, canvas.height) > 800) {
          const scale = 800 / Math.max(canvas.width, canvas.height)
          const resized = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)))
          resized.getContext('2d').drawImage(canvas, 0, 0, resized.width, resized.height)
          canvas = resized
        }
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
        return (await ocrDeadline(worker.recognize(blob, { tessedit_pageseg_mode: psm }), 35000, '单张图片 OCR 超时')).data.text
      }

      function update() {
        evidence = mergeLabelViews(views, style, supplier)
        if (skuFromBarcodeRegion && !evidence.excluded && !evidence.shootSticker) {
          const codes = readStyleCodes(skuFromBarcodeRegion)
          evidence = { ...evidence, kind: 'hangtag', ambiguous: false, codes, matched: codes.includes(style), conflict: false }
        }
      }

      async function observe(canvas, psm = '11') {
        const printed = await readPrintedLabel(canvas, 'text')
        if (printed?.text.trim()) {
          printedViews.push(printed.text)
          views.push(printed.text)
        } else {
          views.push(await read(canvas, psm))
        }
        update()
      }

      await observe(crop(focused ? 'label' : 'full'))
      // A deferred photo with a readable SKU may still be a handwritten sample
      // or a formal label. Read independent crops before judging its type.
      const deferredSku = !focused && evidence.codes.length > 0 && !resolved()
      if (deferredSku) {
        focused = true
        await observe(crop('label'))
      }
      if (focused && !resolved() && (evidence.hangCandidate || (scores?.[0] || 0) >= 0.5)) {
        const anchor = await readPrintedLabel(boundedLabelFrame(bitmap, attempt ? 1150 : 3200), 'barcode')
        barcodeLocated = anchor?.barcodeLocated === true
        if (barcodeLocated && /^10[A-Z0-9]\d{9}[A-Z]?-[A-Z0-9]{5}$/.test(anchor.text)) {
          skuFromBarcodeRegion = anchor.text
          views.push(anchor.text)
          update()
        }
      }
      if (!resolved() && focused) {
        const layouts = [['labelBottom', '11'], ['detail', '6'], ['lower', '11']]
        if (!deferredSku) layouts.unshift(['full', '11'])
        for (const [layout, psm] of layouts) {
          await observe(crop(layout), psm)
          if (resolved()) break
        }
      }
      if (focused && !resolved() && printedViews.length && !evidence.kind && (scores?.[1] || 0) > 0.25) {
        for (const angle of [90, 270]) {
          await observe(boundedLabelFrame(bitmap, attempt ? 1050 : 1400, angle))
          if (resolved()) break
        }
      }
      if (printedViews.length && evidence.hangCandidate && !evidence.excluded &&
          !evidence.shootSticker && !barcodeLocated && supplier >= 0.8) {
        // A green-channel crop retains more contrast for blue handwriting on the certificate.
        const width = Math.max(1, Math.round(bitmap.width * .4))
        const height = Math.max(1, Math.round(bitmap.height * .22))
        const scale = Math.min(1, 1000 / width)
        const ink = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
        const context = ink.getContext('2d', { willReadFrequently: true })
        context.drawImage(bitmap, Math.round((bitmap.width - width) / 2), Math.round((bitmap.height - height) / 2),
          width, height, 0, 0, ink.width, ink.height)
        const image = context.getImageData(0, 0, ink.width, ink.height)
        for (let i = 0; i < image.data.length; i += 4) image.data[i] = image.data[i + 2] = image.data[i + 1]
        context.putImageData(image, 0, 0)
        await observe(ink)
      }
      if (!resolved() && printedViews.length && (evidence.kind || evidence.codes.length || evidence.hangCandidate || barcodeLocated)) {
        views.push(await read(crop(focused ? 'label' : 'full')))
        update()
      }
      if (!evidence.kind && !evidence.hangCandidate && !evidence.excluded && !evidence.ambiguous &&
          !barcodeLocated && isCompositionOnlyLabel(printedViews, scores?.[1] || 0)) {
        evidence = { ...evidence, kind: 'washlabel' }
      }
      if (!evidence.kind && !evidence.hangCandidate && !evidence.ambiguous && !barcodeLocated && !evidence.excluded) {
        if (isHandwrittenSample(printedViews, supplier) || isReferenceOnlyCard(printedViews, style, other, supplier) ||
            isRepeatedWorkshopCard(printedViews, style)) {
          evidence = { ...evidence, excluded: true, handwrittenSample: true }
        } else if (onlyShootInformation(printedViews)) {
          evidence = { ...evidence, excluded: true }
        }
      }
      return observedLabel(item.filename, { ...evidence, barcodeLocated })
    } finally {
      bitmap.close()
    }
  }

  async function retryTimedOutImage(read, onTimeout) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await read(attempt)
      } catch (error) {
        if (!error.ocrTimeout && error.name !== 'TimeoutError') throw error
        onTimeout(error, attempt === 0)
        if (attempt === 1) throw new Error(error.message + '，已自动重试一次')
      }
    }
  }

  async function thumbnailRgb(file) {
    if (!file.thumbnail) return null
    try {
      const url = new URL(file.thumbnail, location.href)
      const sameOrigin = url.origin === location.origin
      if (url.protocol !== 'https:' || !(sameOrigin || url.hostname.endsWith('.semirapp.com'))) return null
      const response = await fetch(url, { credentials: sameOrigin ? 'same-origin' : 'omit', signal: AbortSignal.timeout(3500) })
      if (response.status === 401 && sameOrigin) throw sessionExpired()
      if (!response.ok) return null
      const bitmap = await createImageBitmap(await response.blob())
      try {
        const canvas = new OffscreenCanvas(SCREEN_SIZE, SCREEN_SIZE)
        const ctx = canvas.getContext('2d')
        const scale = SCREEN_SIZE / Math.max(bitmap.width, bitmap.height)
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, SCREEN_SIZE, SCREEN_SIZE)
        ctx.drawImage(bitmap, (SCREEN_SIZE - width) / 2, (SCREEN_SIZE - height) / 2, width, height)
        const rgba = ctx.getImageData(0, 0, SCREEN_SIZE, SCREEN_SIZE).data
        const rgb = new Uint8Array(SCREEN_SIZE * SCREEN_SIZE * 3)
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
          rgb[j] = rgba[i]
          rgb[j + 1] = rgba[i + 1]
          rgb[j + 2] = rgba[i + 2]
        }
        return rgb
      } finally {
        bitmap.close()
      }
    } catch (error) {
      if (error.sessionExpired) throw error
      return null
    }
  }

  function screenOrder(files, scores) {
    const deferred = new Set(files.filter(file => {
      const score = scores.get(file)
      return score && !namedLabel.test(file.filename) && score[2] + (score[3] || 0) >= OTHER_THRESHOLD
    }))
    const candidates = files.filter(file => !deferred.has(file))
    const [hang, wash] = [0, 1].map(kind => candidates
      .filter(file => (scores.get(file)?.[kind] || 0) >= 0.5)
      .sort((a, b) => scores.get(b)[kind] - scores.get(a)[kind]))
    const priority = [...new Set([hang[0], wash[0], hang[1], wash[1],
      ...candidates.filter(file => namedLabel.test(file.filename)), ...hang, ...wash, ...candidates].filter(Boolean))]
    return { priority, deferred: [...deferred] }
  }

  async function prioritizeOcr(runtime, sorted, scoresByFile) {
    const credential = params.__crawshrimp_semir_screen_token
    if (!credential || runtime.run.screenUnavailable) return screenOrder(sorted, scoresByFile)
    for (let offset = 0; offset < sorted.length; offset += SCREEN_BATCH) {
      const batch = sorted.slice(offset, offset + SCREEN_BATCH)
      const inputs = (await Promise.all(batch.map(async file => ({ file, pixels: await thumbnailRgb(file) }))))
        .filter(item => item.pixels)
      if (!inputs.length) continue
      const body = new Uint8Array(inputs.length * SCREEN_SIZE * SCREEN_SIZE * 3)
      inputs.forEach(({ pixels }, index) => body.set(pixels, index * pixels.length))
      try {
        const response = await fetch(localApiOrigin() + '/semir-still-images/classify', {
          method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3500),
          headers: { 'Content-Type': 'application/octet-stream', 'X-Crawshrimp-Token': credential }, body,
        })
        if (!response.ok) throw new Error('本机图片分类不可用')
        const { scores } = await response.json()
        if (!Array.isArray(scores) || scores.length !== inputs.length ||
            scores.some(row => !Array.isArray(row) || row.length !== 4 || row.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
              Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) > 0.001)) {
          throw new Error('本机图片分类结果无效')
        }
        inputs.forEach(({ file }, index) => scoresByFile.set(file, scores[index]))
      } catch {
        runtime.run.screenUnavailable = true
        break
      }
    }
    return screenOrder(sorted, scoresByFile)
  }

  function isNamedProductView(file, style, color) {
    const name = clean(file.filename).toUpperCase().replace(/\.(?:JPG|PNG)$/, '')
    if (!color || name === clean(file.filename).toUpperCase()) return false
    const sku = style + '-' + color
    return name === sku || name.startsWith(sku + '-') && /^[1-7]$/.test(name.slice(sku.length + 1))
  }

  function needsDeferredReview(evidence, style, failures) {
    const parent = style.length === 13 ? style.slice(0, 12) : ''
    return failures > 0 || evidence.some(item => item.codeConflict ||
      item.kinds.some(kind => kind === '吊牌' || kind === '洗唛') &&
      item.codes.some(code => code !== style && code !== parent)) ||
      ['吊牌', '洗唛'].some(kind => !evidence.some(item => item.kinds.includes(kind) && item.matched))
  }

  async function scanColor(runtime, mountId, files, style, color) {
    const evidence = [], failed = []
    // Start with the last camera shots, where captures of the two labels usually appear.
    const imageFiles = files.filter(file => !file.filename.startsWith('._'))
    const sorted = imageFiles.filter(file => !isNamedProductView(file, style, color)).sort((a, b) => {
      const product = item => item.filename.startsWith(style + '-')
      return Number(namedLabel.test(b.filename)) - Number(namedLabel.test(a.filename)) || Number(product(a)) - Number(product(b)) ||
        b.filename.localeCompare(a.filename, 'en', { numeric: true })
    })
    const scoresByFile = new Map()
    let scanned = 0, retried = 0
    const { priority, deferred } = await prioritizeOcr(runtime, sorted, scoresByFile)
    async function scan(queue) {
      for (const file of queue) {
        let initializing = false
        const scores = scoresByFile.get(file)
        try {
          const read = await retryTimedOutImage(async attempt => {
            if (runtime.run.sessionExpired) throw sessionExpired()
            initializing = !runtime.worker
            const worker = runtime.worker ??= await browserWorker(runtime)
            initializing = false
            return recognize(worker, mountId, file, style, scores, attempt)
          }, (error, retrying) => {
            if (retrying) retried++
            if (error.ocrTimeout && runtime.worker) {
              void runtime.worker.terminate().catch(() => {})
              runtime.worker = null
            }
          })
          evidence.push({ ...read, scores })
          scanned++
        } catch (error) {
          failed.push(file.filename + '：' + (error.name === 'TypeError' ? '图片请求失败' : error.message))
          if (error.sessionExpired) throw error
          if (initializing) return false
        }
      }
      return true
    }
    // A third candidate can contain an incorrect printed SKU after both kinds have one match.
    if (await scan(priority) && needsDeferredReview(evidence, style, failed.length)) await scan(deferred)
    const complete = sorted.length > 0 && scanned === sorted.length && !failed.length
    const canConfirmMissing = complete && (scoresByFile.size > 0 || evidence.some(item =>
      item.kind || item.supplierSample || item.handwrittenSample || item.handwrittenCertificate || item.absenceCard))
    function summarize(kind) {
      const result = summarizeLabel(evidence, kind, style, failed.length)
      if (!imageFiles.length) result.status = '无图片'
      else if (result.status === '未检出，待复核' && !canConfirmMissing) {
        result.status = '候选图片未检出，待复核'
      }
      return result
    }
    return { scanned, retried, failed, hang: summarize('吊牌'), wash: summarize('洗唛') }
  }

  function sessionExpired() {
    return Object.assign(new Error('等待森马云盘登录'), { sessionExpired: true })
  }

  function resultRows(row, values) {
    return (row.dates || [row.上市日期]).map(date => ({
      批次: row.批次, 款号: row.款号, 款色: row.款色, 色号: row.色号,
      色名: row.色名, 性别: row.性别, 上市日期: date, ...values,
    }))
  }

  async function prepareStyle(state, job, runtime) {
    runtime.stage = '查找图包'
    const source = await findSource(state, job)
    if (!source.path && !source.standalone) {
      return job.colors.map(row => ({
        row, files: [], labelStatus: '待核验',
        result: { 整理结果: source.paths ? '来源待选择' : '缺图包', 来源路径: source.paths || '',
          备注: [...row.notes, source.reason].join('；') },
      }))
    }
    const plans = source.path ? colorPlans(job, source.items).map((plan, index) => {
      const fallback = source.standalone[index]
      return plan.issue === '缺款色文件夹' && (fallback.path || fallback.alternatives) ? fallback : plan
    }) : source.standalone
    const wholeStyle = state.mode === 'organize' && source.path && canCopyWholeStyle(source.items, plans)
    const sourceTree = wholeStyle ? await tree(source.mountId, source.path, source.items) : []
    const runWrite = action => {
      if (!navigator.locks) throw new Error('当前浏览器不支持云盘写入互斥锁')
      return navigator.locks.request('crawshrimp-semir-still-package:' + state.target.mountId, () => {
        if (runtime.run.sessionExpired) throw sessionExpired()
        return action()
      })
    }
    let target = { result: '预览' }
    if (wholeStyle) {
      runtime.stage = '复制并核验图包'
      try {
        target = await runWrite(() => copyAndRename(state, source, job, sourceTree, plans))
      } catch (e) {
        if (e.sessionExpired) throw e
        target = { result: '整理未完成', error: e.message }
      }
    }
    const prepared = []
    for (const plan of plans) {
      const { row, original, issue } = plan
      runtime.target = job.style + ' / ' + row.色号
      const folder = plan.path || (source.path && original ? source.path + '/' + original : '')
      const origin = plan.path ? plan : source
      const separate = !!folder && (plan.path || !target.target)
      let assets = []
      if (folder) assets = wholeStyle && !plan.path
        ? sourceTree.filter(item => item.fullpath.startsWith(folder + '/')) : await tree(origin.mountId, folder)
      const files = assets.filter(item => !isDir(item) && IMAGE.test(item.filename))
      let colorTarget = !plan.path && original && target.target && target.target + '/' + row.target
      let result = target.result, error = target.error
      if (state.mode === 'organize' && separate) {
        runtime.stage = '复制并核验图包'
        try {
          const copied = await runWrite(() => copyStandalone(state, job, { ...origin, path: folder, original, row }, assets))
          colorTarget = copied.target
          result = copied.result
          error = ''
        } catch (e) {
          if (e.sessionExpired) throw e
          result = '整理未完成'
          error = e.message
        }
      }
      const note = [...row.notes, issue, error].filter(Boolean)
      if (original && !files.length) note.push('款色文件夹无可识别图片')
      const labelStatus = !original ? '缺款色文件夹' : files.length ? '未扫描' : '无图片'
      prepared.push({
        row, labelStatus, mountId: colorTarget ? state.target.mountId : origin.mountId,
        folder: files.length ? colorTarget || folder : '',
        result: {
          整理结果: issue || result, 来源路径: [folder || source.path ? address({ ...origin, path: folder || source.path }) : '', ...(plan.alternatives || [])].filter(Boolean).join('\n'),
          目标路径: colorTarget ? address({ ...state.target, path: colorTarget }) : '',
          目录命名: row.target, 图片数: files.length, 备注: note.join('；'),
        },
      })
    }
    return prepared
  }

  async function auditColor(item, runtime) {
    const { row, folder, mountId, labelStatus, result } = item
    const files = folder ? (await tree(mountId, folder)).filter(item => !isDir(item) && IMAGE.test(item.filename)) : []
    const audit = files.length ? await scanColor(runtime, mountId, files, row.款号, row.色号) : null
    const note = [result.备注]
    if (audit?.retried) note.push(`${audit.retried} 张图片超时后已自动重试`)
    if (audit?.failed.length) note.push('OCR失败：' + audit.failed.join('、'))
    if (audit?.hang.excludedFiles.length) note.push('供应商样品卡或表单不计作吊牌：' + audit.hang.excludedFiles.join('、'))
    if (audit?.hang.handwrittenFiles?.length && audit.hang.status === '未检出，待复核') note.push('仅有手写样卡')
    if (audit?.hang.absenceCardFiles?.length) note.push('手写缺项说明不计作标签')
    if (audit && runtime.run.screenUnavailable) note.push('缩略图模型不可用，已回退到完整 OCR')
    return resultRows(row, {
      ...result, 已识别图片数: audit?.scanned || 0, OCR失败数: audit?.failed.length || 0,
      吊牌结果: audit?.hang.status || (folder ? '无图片' : labelStatus), 吊牌图片: audit?.hang.files, 吊牌识别款号: audit?.hang.codes,
      洗唛结果: audit?.wash.status || (folder ? '无图片' : labelStatus), 洗唛图片: audit?.wash.files, 洗唛识别款号: audit?.wash.codes,
      备注: note.filter(Boolean).join('；'),
    })
  }

  function liveState(shared, run, store) {
    const active = [...run.active.values()][0]
    return { ...shared, current_exec_no: run.receipts.filter(Boolean).length, organize_total: shared.total_rows,
      organize_completed: run.prepared.flat().filter(Boolean).length, current_buyer_id: active?.target || '',
      current_store: store || active?.stage || '整理云盘图包' }
  }

  function makeRun(jobs, errors, snapshot = {}) {
    const hardware = params.__crawshrimp_ocr_hardware || {}
    return { jobs, errors, prepared: snapshot.prepared || [], receipts: snapshot.receipts || [],
      active: new Map(), workers: [], sessionExpired: false,
      workerLimit: ocrWorkerLimit(hardware.threads || navigator.hardwareConcurrency, hardware.memory_gb || navigator.deviceMemory) }
  }

  function saveCheckpoint(key, run) {
    sessionStorage.setItem(key, JSON.stringify({ prepared: run.prepared, receipts: run.receipts }))
  }

  function nextPending(items, receipts, active) {
    return items.findIndex((_, index) => !receipts[index] && !active.has(index))
  }

  function queueOperation(run, index, runtime, work, onComplete, onError, checkpoint) {
    run.active.set(index, runtime)
    work().catch(error => {
      if (error.sessionExpired) {
        run.sessionExpired = true
        return null
      }
      return onError(error)
    }).then(value => {
      if (value) {
        onComplete(value)
        saveCheckpoint(checkpoint, run)
      }
    }).catch(error => {
      run.checkpointError = error.message
    }).finally(() => {
      runtime.busy = false
      run.active.delete(index)
    })
  }

  if (window.__CRAWSHRIMP_EXPORTS__) Object.assign(window.__CRAWSHRIMP_EXPORTS__, {
    batchRows, colorPlans, equivalent, ocrEvidence, summarizeLabel, requireTarget, parseAddress, ocrWorkerLimit, nextPending, retryTimedOutImage, screenOrder, parseBatch, batchDirectory, combineOcrViews, isNamedProductView, canCopyWholeStyle, prepareStyle, scanColor, mergeLabelViews, isRepeatedWorkshopCard,
  })
  if (phase === '__exports__') return { success: true, data: [] }

  const waiting = '等待森马云盘登录'
  try {
    if (!token) throw new Error('缺少抓虾运行会话')
    if (location.hostname !== 'fmp.semirapp.com') {
      if (phase === 'organize' || phase === 'ocr') return next(phase, { ...shared, current_store: waiting }, 3000)
      throw new Error('请打开森马云盘')
    }
    const checkpoint = '__CRAWSHRIMP_SEMIR_STILL_CHECKPOINT__:' + token
    const runs = window.__CRAWSHRIMP_SEMIR_STILL_RUNS__ ??= new Map()
    if (phase === 'main' || phase === 'init') {
      const mode = clean(params.operation || 'organize')
      if (!['preview', 'organize'].includes(mode)) throw new Error('请选择有效的执行方式')
      const subset = new Set(clean(params.style_filter).toUpperCase().split(/[\s,，、]+/).filter(Boolean))
      const { jobs, errors } = batchRows(params.input_file, subset)
      const mounts = (await request('/1/account/mount', {})).list || []
      function resolveMount(entry) {
        const matches = mounts.filter(mount => entry.mountId ? String(mount.mount_id) === entry.mountId : mount.org_name === entry.mount)
        if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].mount_id))) throw new Error('找不到唯一可访问的云盘库：' + (entry.mount || entry.mountId))
        return { ...entry, mount: matches[0].org_name, mountId: String(matches[0].mount_id) }
      }
      const requestedSources = String(params.source_paths || params.source_path || '').split(/\r?\n/).filter(line => line.trim())
      const resolved = requestedSources.map(line => ({ ...resolveMount(parseAddress(line)), explicit: true }))
      const sources = [...new Map(resolved.map(source => [source.mountId + '//' + source.root, source])).values()]
      const defaultSource = sources.length ? null : resolveMount({ mount: SOURCE_MOUNT })
      const target = resolveMount(parseAddress(params.target_path || TARGET_MOUNT + '//' + TARGET_ROOT))
      const searchRoots = sources.length ? sources : jobs.flatMap(job => sourceRootList({ sources, defaultSource }, job))
      if (searchRoots.some(source => source.mountId === target.mountId &&
          (inside(source.root, target.root) || inside(target.root, source.root)))) throw new Error('来源与目标目录不能相互包含')
      const getPermissions = async entry => (await request('/1/file/ls', {
        mount_id: entry.mountId, fullpath: entry.root, current: 1, start: 0, size: 1,
      })).permisson
      const permissions = await getPermissions(target)
      if (!permissions?.includes('file_list') || (mode === 'organize' && !permissions.includes('file_write'))) {
        throw new Error('目标目录不可访问或当前帐号缺少写权限')
      }
      for (const source of sources) {
        if (!(await getPermissions(source))?.includes('file_list')) throw new Error('来源目录不可访问：' + address({ ...source, path: source.root }))
      }
      const state = { target, sources, defaultSource, mode,
        total_rows: jobs.reduce((total, job) => total + job.colors.length, 0),
        current_exec_no: 0, current_buyer_id: jobs[0]?.style || '', current_store: '读取上架明细' }
      const run = makeRun(jobs, errors)
      saveCheckpoint(checkpoint, run)
      runs.set(token, run)
      return next('organize', state)
    }
    let run = runs.get(token)
    if (!run) {
      const saved = sessionStorage.getItem(checkpoint)
      if (!saved) throw new Error('浏览器中的进度记录不可用，请重新打开任务')
      const subset = new Set(clean(params.style_filter).toUpperCase().split(/[\s,，、]+/).filter(Boolean))
      const { jobs, errors } = batchRows(params.input_file, subset)
      run = makeRun(jobs, errors, JSON.parse(saved))
      run.sessionExpired = true
      runs.set(token, run)
    }
    if (run.checkpointError) throw new Error('无法保存静物图任务进度：' + run.checkpointError)
    if (run.sessionExpired || shared.current_store === waiting || !location.pathname.startsWith('/web/')) {
      if (run.active.size) return next(phase, liveState(shared, run, waiting), 3000)
      try {
        if (!Array.isArray((await request('/1/account/mount', {})).list)) throw sessionExpired()
        run.sessionExpired = false
      } catch (error) {
        if (!error.sessionExpired) throw error
        return next(phase, liveState(shared, run, waiting), 3000)
      }
    }
    if (phase === 'organize') {
      while (run.active.size < 4) {
        const index = nextPending(run.jobs, run.prepared, run.active)
        if (index < 0) break
        const job = run.jobs[index]
        const runtime = { run, target: job.style }
        queueOperation(run, index, runtime,
          () => prepareStyle({ ...shared, season: job.season }, job, runtime),
          items => { run.prepared[index] = items },
          error => job.colors.map(row => ({ row, labelStatus: '待核验',
            result: { 整理结果: '处理失败', 备注: [...row.notes, error.message].join('；') } })),
          checkpoint)
      }
      if (run.active.size) {
        return next('organize', liveState(shared, run), 500)
      }
      return next('ocr', liveState(shared, run, '准备 OCR 核验'))
    }
    if (phase !== 'ocr') throw new Error('未知执行阶段')
    const colors = run.prepared.flat().filter(Boolean)
    while (run.active.size < run.workerLimit) {
      const index = nextPending(colors, run.receipts, run.active)
      if (index < 0) break
      const item = colors[index]
      const runtime = run.workers.find(worker => !worker.busy) || { worker: null, busy: false, run }
      if (!run.workers.includes(runtime)) run.workers.push(runtime)
      runtime.busy = true
      runtime.target = item.row.款号 + ' / ' + item.row.色号
      runtime.stage = 'OCR 核验吊牌与洗唛'
      queueOperation(run, index, runtime, () => auditColor(item, runtime),
        rows => { run.receipts[index] = rows },
        error => resultRows(item.row, { ...item.result, 备注: [item.result.备注, 'OCR失败：' + error.message].filter(Boolean).join('；') }),
        checkpoint)
    }
    if (run.active.size) return next('ocr', liveState(shared, run, 'OCR 核验吊牌与洗唛'), 700)
    void Promise.allSettled(run.workers.map(runtime => runtime.worker?.terminate()))
    sessionStorage.removeItem(checkpoint)
    runs.delete(token)
    return { success: true, data: [...run.receipts.flat(), ...run.errors], meta: { action: 'complete', has_more: false,
      shared: liveState(shared, run, '生成结果表') } }
  } catch (error) {
    if (error.sessionExpired) return next(phase, { ...shared, current_store: waiting }, 3000)
    return { success: false, error: error.message }
  }
})()
