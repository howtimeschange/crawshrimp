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
  const ID = /^[A-Z0-9]{12}$/
  const COLOR = /^[A-Z0-9]{5}$/
  const IMAGE = /\.(jpe?g|png|webp|bmp|gif|tiff?|heic|avif)$/i
  const TYPE_WORDS = {
    吊牌: /吊牌|执行标准|产品标准|安全技术类别|质量等级|检验员|建议零售价|零售价|\bRMB\b|[¥￥]\s*\d/i,
    洗唛: /洗[唛标]|水洗标|洗[涤滌]说明|洗[涤滌]方法|维护方法|不可漂白|不可干洗|不可熨烫|印花部位|浸泡时间|WASH(?:ING)?\s*INSTRUC|CARE\s*INSTRUC|DO\s*NOT\s*BLEACH/i,
  }

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

  function batchRows(input, subset) {
    const tables = Object.values(input?.sheets || {})
    const rows = tables.length ? tables.flatMap(sheet => sheet.rows || []) : input?.rows || []
    if (!rows.length) throw new Error('请上传包含上架明细的 Excel')
    const styles = new Map(), errors = [], blocked = new Set()
    let selected = 0
    for (const row of rows) {
      const seasonKey = Object.keys(row).find(key => /^Q季|^季度$|^上新季$|^上市季$/.test(key))
      const season = clean(row[seasonKey]).toUpperCase(), batch = clean(row.批次)
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
      if (/取消/.test(batch)) {
        errors.push({ ...detail, 整理结果: '已取消', 备注: '表格批次标记为取消' })
        continue
      }
      if (!/^\d{2}Q[1-4]$/.test(season) || !/^第\d{1,2}批$/.test(batch) || !date) {
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
      const job = styles.get(key) || { style, season, batch, group, colors: [] }
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
      error.busy = response.status === 403 && /空间正在被操作中/.test(data?.error_msg || '')
      error.sessionExpired = response.status === 401
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

  function colorPlans(job, items) {
    return job.colors.map(row => {
      const sourceName = job.style + '-' + row.色号
      const matches = items.filter(item => [sourceName, row.target].includes(item.filename))
      if (!matches.length) return { row, issue: '缺款色文件夹' }
      if (matches.length > 1 || !isDir(matches[0])) return { row, issue: '款色文件夹命名冲突' }
      return { row, original: matches[0].filename }
    })
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
    const { target: destination, season, batch } = state
    const batchPath = await mkdir(destination, destination.root, season + batch)
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
    const { target: destination, season, batch } = state
    const batchPath = await mkdir(destination, destination.root, season + batch)
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

  function ocrEvidence(file, text, expected) {
    const normalized = clean(text).toUpperCase()
    const compact = normalized.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')
    const codes = [...new Set(normalized.split(/\n/).flatMap(line => {
      const combined = line.replace(/(?<=[A-Z0-9])\s+(?=[A-Z0-9])/g, '')
      return [...combined.matchAll(/(?:^|[^A-Z0-9])(10[A-Z0-9]\d{9})(?=$|[^A-Z0-9]|[A-Z0-9]{5}(?:$|[^A-Z0-9]))/g)].map(match => match[1])
    }))]
    const hasHang = TYPE_WORDS.吊牌.test(compact)
    const hasWash = TYPE_WORDS.洗唛.test(compact)
    const kinds = hasWash && (hasHang ? /水洗标|洗唛|洗标|洗涤说明|WASH(?:ING)?\s*INSTRUC/i.test(compact) : true) ?
      (hasHang ? ['待区分'] : ['洗唛']) : hasHang ? ['吊牌'] : []
    return { file, kinds, codes, matched: codes.includes(expected) }
  }

  function summarizeLabel(evidence, kind, style, failed) {
    const candidates = evidence.filter(item => item.kinds.includes(kind))
    const uncertain = evidence.filter(item => item.kinds.includes('待区分') || (!item.kinds.length && item.codes.length))
    const otherCodes = candidates.flatMap(item => item.codes.filter(code => code !== style))
    let status = '未检出，待复核'
    if (otherCodes.length) status = '识别到不一致款号，待复核'
    else if (candidates.some(item => item.matched)) status = '一致'
    else if (candidates.length) status = '已识别类型，款号未读出'
    else if (failed) status = '部分图片识别失败，待复核'
    else if (uncertain.length) status = '有候选图片，类型待复核'
    const matches = candidates.length ? candidates : uncertain
    return {
      status, files: matches.map(item => item.file).join('\n'),
      codes: [...new Set(matches.flatMap(item => item.codes))].join('、'),
    }
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

  async function browserWorker(runtime) {
    const raw = new URL(params.__crawshrimp_api_base_url || 'http://127.0.0.1:18765')
    if (raw.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(raw.hostname)) throw new Error('OCR 需要本机抓虾运行时')
    const base = raw.origin + OCR_ASSETS
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

  async function recognize(worker, mountId, item) {
    const info = await request('/2/file/info', {
      mount_id: mountId, fullpath: item.fullpath, ignores: 'tag,favorite,lock,preview,thumbnail',
    })
    if (info.fullpath !== item.fullpath || String(info.mount_id) !== mountId) throw new Error('OCR 来源文件不符')
    const url = new URL(info.uri || info.uris?.[0], location.href)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.semirapp.com')) throw new Error('OCR 图片地址不属于森马云盘')
    const image = await fetch(url, {
      credentials: url.origin === location.origin ? 'same-origin' : 'omit', cache: 'no-store', signal: AbortSignal.timeout(45000),
    })
    if (!image.ok) throw new Error('读取图片失败 HTTP ' + image.status)
    const bitmap = await createImageBitmap(await image.blob())
    let blob
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.94 })
    } finally {
      bitmap.close()
    }
    return (await ocrDeadline(worker.recognize(blob), 35000, '单张图片 OCR 超时')).data.text
  }

  async function retryTimedOutImage(read, onTimeout) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await read()
      } catch (error) {
        if (!error.ocrTimeout && error.name !== 'TimeoutError') throw error
        onTimeout(error, attempt === 0)
        if (attempt === 1) throw new Error(error.message + '，已自动重试一次')
      }
    }
  }

  async function scanColor(runtime, mountId, files, style) {
    const evidence = [], failed = []
    // Camera filenames usually place label shots near the end. This only changes scan order.
    const sorted = [...files].sort((a, b) => {
      const product = item => item.filename.startsWith(style + '-')
      const namedLabel = item => /吊牌|洗唛|洗标|水洗|hang.?tag|wash.?label/i.test(item.filename)
      return Number(namedLabel(b)) - Number(namedLabel(a)) || Number(product(a)) - Number(product(b)) ||
        b.filename.localeCompare(a.filename, 'en', { numeric: true })
    })
    let scanned = 0, retried = 0
    for (const file of sorted) {
      let initializing = false
      try {
        const text = await retryTimedOutImage(async () => {
          if (runtime.run.sessionExpired) throw sessionExpired()
          initializing = !runtime.worker
          const worker = runtime.worker ??= await browserWorker(runtime)
          initializing = false
          return recognize(worker, mountId, file)
        }, (error, retrying) => {
          if (retrying) retried++
          if (error.ocrTimeout && runtime.worker) {
            void runtime.worker.terminate().catch(() => {})
            runtime.worker = null
          }
        })
        evidence.push(ocrEvidence(file.filename, text, style))
        scanned++
      } catch (error) {
        failed.push(file.filename + '：' + (error.name === 'TypeError' ? '图片请求失败' : error.message))
        if (error.sessionExpired) throw error
        if (initializing) break
      }
      if (['吊牌', '洗唛'].every(kind => evidence.some(item => item.kinds.includes(kind) && item.matched))) break
    }
    return { scanned, retried, failed, hang: summarizeLabel(evidence, '吊牌', style, failed.length),
      wash: summarizeLabel(evidence, '洗唛', style, failed.length) }
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
    const sourceTree = source.path ? await tree(source.mountId, source.path, source.items) : []
    const runWrite = action => {
      if (!navigator.locks) throw new Error('当前浏览器不支持云盘写入互斥锁')
      return navigator.locks.request('crawshrimp-semir-still-package:' + state.target.mountId, () => {
        if (runtime.run.sessionExpired) throw sessionExpired()
        return action()
      })
    }
    let target = { result: '预览' }
    if (state.mode === 'organize' && source.path) {
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
      const assets = plan.path ? await tree(origin.mountId, plan.path) : sourceTree.filter(item => item.fullpath.startsWith(folder + '/'))
      const files = assets.filter(item => !isDir(item) && IMAGE.test(item.filename))
      let colorTarget = !plan.path && original && target.target && target.target + '/' + row.target
      let result = target.result, error = target.error
      if (state.mode === 'organize' && plan.path) {
        runtime.stage = '复制并核验图包'
        try {
          const copied = await runWrite(() => copyStandalone(state, job, plan, assets))
          colorTarget = copied.target
          result = copied.result
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
    const audit = files.length ? await scanColor(runtime, mountId, files, row.款号) : null
    const note = [result.备注]
    if (audit?.retried) note.push(`${audit.retried} 张图片超时后已自动重试`)
    if (audit?.failed.length) note.push('OCR失败：' + audit.failed.join('、'))
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
    batchRows, colorPlans, equivalent, ocrEvidence, summarizeLabel, requireTarget, parseAddress, ocrWorkerLimit, nextPending, retryTimedOutImage,
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
          () => prepareStyle({ ...shared, season: job.season, batch: job.batch }, job, runtime),
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
