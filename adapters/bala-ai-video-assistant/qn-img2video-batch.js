;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const UPLOAD_INPUT_ID = 'crawshrimp-bala-qn-img2video-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const DEFAULT_CATEGORY = '童装/婴儿装/亲子装'
  const DEFAULT_OUTPUT_DIR = ''
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
  const STATUS_TEXT = Object.freeze({
    '-1': '初始化',
    0: '生成中',
    1: '已完成',
    2: '失败',
    3: '排队中',
    4: '已取消',
  })

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return cleanText(value).replace(/\s+/g, '')
  }

  function stringList(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，、;；]+/)
    const result = []
    const seen = new Set()
    for (const item of source) {
      const text = cleanText(item)
      if (!text || seen.has(text)) continue
      result.push(text)
      seen.add(text)
    }
    return result
  }

  function parseInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = parseInt(String(value ?? '').trim(), 10)
    const base = Number.isFinite(parsed) ? parsed : fallback
    return Math.max(min, Math.min(max, base))
  }

  function checkboxEnabled(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return Boolean(defaultValue)
    if (Array.isArray(value)) {
      if (!value.length) return false
      return value.some(item => checkboxEnabled(item, true))
    }
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    const text = compact(value).toLowerCase()
    if (!text) return Boolean(defaultValue)
    if (['false', '0', 'no', 'off', 'disabled', 'disable', 'none', 'unchecked'].includes(text)) return false
    if (['true', '1', 'yes', 'on', 'enabled', 'enable', 'checked'].includes(text)) return true
    return true
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = cleanText(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ')
    return text.replace(/^_+|_+$/g, '') || fallback
  }

  function extensionOf(path) {
    const match = cleanText(path).split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1].toLowerCase() : ''
  }

  function isImagePath(path) {
    return IMAGE_EXTS.has(extensionOf(path))
  }

  function pathBasename(path) {
    return cleanText(path).replace(/\\/g, '/').split('/').filter(Boolean).pop() || cleanText(path)
  }

  function pathStem(path) {
    return pathBasename(path).replace(/\.[a-zA-Z0-9]+$/i, '')
  }

  function normalizeRemoteUrl(value) {
    const text = cleanText(value)
    if (!/^(?:https?:)?\/\//i.test(text)) return ''
    return text.startsWith('//') ? `https:${text}` : text
  }

  function isRemoteImage(value) {
    const url = normalizeRemoteUrl(value)
    return !!url && (!extensionOf(url) || isImagePath(url))
  }

  function findFirstRemoteUrl(value, depth = 0) {
    if (value === null || value === undefined || depth > 6) return ''
    if (typeof value === 'string') return normalizeRemoteUrl(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = findFirstRemoteUrl(item, depth + 1)
        if (matched) return matched
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    for (const key of ['fullUrl', 'url', 'imageUrl', 'ossUrl', 'cdnUrl', 'resourceUrl', 'videoUrl', 'playUrl']) {
      const matched = findFirstRemoteUrl(value[key], depth + 1)
      if (matched) return matched
    }
    for (const item of Object.values(value)) {
      const matched = findFirstRemoteUrl(item, depth + 1)
      if (matched) return matched
    }
    return ''
  }

  function safeParseJson(value, fallback = null) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value
    try {
      return JSON.parse(String(value || ''))
    } catch (error) {
      return fallback
    }
  }

  function normalizeExecutionMode(value) {
    const text = compact(value || 'plan').toLowerCase()
    if (['catalog', 'template_catalog', '模板目录'].includes(text)) return 'catalog'
    if (['live', 'generate', '生成'].includes(text)) return 'live'
    return 'plan'
  }

  function normalizeGroupMode(value) {
    const text = compact(value || 'one_image_per_video').toLowerCase()
    if (['all_images_one_video', 'all', 'one_video', 'multi_image_one_video'].includes(text)) return 'all_images_one_video'
    return 'one_image_per_video'
  }

  function normalizeSelectedImagePaths(materialImages) {
    const paths = Array.isArray(materialImages?.paths) ? materialImages.paths : materialImages
    return stringList(paths).filter(path => isImagePath(path) || isRemoteImage(path))
  }

  function normalizeDirectoryListingFiles(materialRootFiles) {
    const source = Array.isArray(materialRootFiles?.paths)
      ? materialRootFiles.paths
      : (Array.isArray(materialRootFiles) ? materialRootFiles : [])
    return source
      .map((entry, index) => {
        const rawPath = typeof entry === 'string' ? entry : entry?.path
        const filePath = cleanText(rawPath)
        if (!filePath || !isImagePath(filePath)) return null
        return {
          path: filePath,
          relativePath: cleanText(entry?.relativePath || entry?.relative_path),
          mtimeMs: Number.isFinite(Number(entry?.mtimeMs)) ? Number(entry.mtimeMs) : index,
          order: index,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aiRank = aiResultRank(a.path) - aiResultRank(b.path)
        if (aiRank) return aiRank
        if (a.relativePath && b.relativePath && a.relativePath !== b.relativePath) {
          return a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true })
        }
        return a.path.localeCompare(b.path, 'zh-CN', { numeric: true })
      })
  }

  function aiResultRank(path) {
    const text = cleanText(path)
    if (/AI生成图|ai-\d+|[-_/]ai[-_]/i.test(text)) return 0
    if (/01_模拍原图|模拍/.test(text)) return 1
    if (/03_3比4|3比4|商品竖图|主图/.test(text)) return 2
    return 5
  }

  function normalizeImageRefs(rawParams = params) {
    const direct = normalizeSelectedImagePaths(rawParams.material_images)
    const remote = stringList(rawParams.image_urls).filter(isRemoteImage)
    const limit = parseInteger(rawParams.image_limit, 20, 1, 200)
    const chosen = direct.length
      ? [...direct, ...remote]
      : [...remote, ...normalizeDirectoryListingFiles(rawParams.material_root_files).map(item => item.path)]
    const refs = []
    const seen = new Set()
    for (const ref of chosen) {
      const value = cleanText(ref)
      const identity = normalizeRemoteUrl(value) || value
      if (!value || seen.has(identity)) continue
      seen.add(identity)
      refs.push({
        ref: value,
        path: normalizeRemoteUrl(value) ? '' : value,
        url: normalizeRemoteUrl(value),
        source: normalizeRemoteUrl(value) ? 'remote' : 'local',
        name: pathBasename(value),
        styleCode: extractStyleCode(value),
      })
      if (refs.length >= limit) break
    }
    return refs
  }

  function extractStyleCode(path) {
    const match = cleanText(path).match(/\b(\d{12})\b/)
    return match ? match[1] : ''
  }

  function normalizeTemplateRequests(rawParams = params) {
    const ids = stringList(rawParams.template_id || rawParams.template_ids)
    const matches = stringList(rawParams.template_match)
    const result = []
    ids.forEach(id => result.push({ templateId: id, templateMatch: '' }))
    matches.forEach(match => result.push({ templateId: '', templateMatch: match }))
    return result.length ? result : [{ templateId: '', templateMatch: '' }]
  }

  function unwrapMtopPayload(payload, api) {
    if (!payload || typeof payload !== 'object') return payload
    if (payload.ret && Array.isArray(payload.ret)) {
      const failed = payload.ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) throw new Error(`${api} 返回失败：${payload.ret.join('；')}`)
    }
    if (payload.data !== undefined) return payload.data
    return payload
  }

  async function callMtop(api, data = {}, options = {}) {
    const client = window.lib?.mtop || window.mtop
    if (!client || typeof client.request !== 'function') {
      throw new Error('未找到软件管家页面 MTop 客户端，请确认当前 tab 是 https://quick.taobao.com/videostudio/img2video')
    }
    const payload = await client.request({
      api,
      v: options.v || '1.0',
      type: options.type || 'POST',
      dataType: 'json',
      H5Request: true,
      preventFallback: true,
      data,
    })
    return unwrapMtopPayload(payload, api)
  }

  async function fetchSellerCategory() {
    try {
      const data = await callMtop('mtop.taobao.qn.copilot.node.aigc.seller.category.get', {})
      return data?.result || data || {}
    } catch (error) {
      return {}
    }
  }

  async function fetchTemplates(category) {
    const data = await callMtop('mtop.taobao.qn.copilot.video.template.list', { mainCategory: category || DEFAULT_CATEGORY })
    const result = data?.result || data
    if (Array.isArray(result)) return result
    if (Array.isArray(result?.templates)) return result.templates
    if (Array.isArray(result?.list)) return result.list
    return []
  }

  function getTemplateSlots(template) {
    const slots = safeParseJson(template?.inputImages, [])
    if (!Array.isArray(slots)) return []
    return slots.map((slot, index) => ({
      ...slot,
      code: cleanText(slot.code ?? slot.slotCode ?? slot.id ?? index),
      name: cleanText(slot.slotName || slot.name),
      required: slot.required !== false && slot.require !== false && slot.optional !== true,
      imageUrl: cleanText(slot.imageUrl),
    }))
  }

  function templateText(template) {
    return cleanText([
      template?.templateId,
      template?.id,
      template?.name,
      template?.title,
      template?.description,
      template?.category,
      template?.type,
      template?.tag,
    ].filter(Boolean).join(' '))
  }

  function chooseTemplate(templates, request = {}, materialCount = 1) {
    const list = Array.isArray(templates) ? templates : []
    if (!list.length) return null
    const wantedId = cleanText(request.templateId)
    if (wantedId) {
      const exact = list.find(template => cleanText(template.templateId || template.id) === wantedId)
      if (exact) return exact
    }
    const needle = compact(request.templateMatch).toLowerCase()
    if (needle) {
      const matched = list.find(template => compact(templateText(template)).toLowerCase().includes(needle))
      if (matched) return matched
    }
    const ranked = list
      .map(template => {
        const slots = getTemplateSlots(template)
        const requiredCount = slots.filter(slot => slot.required).length || slots.length || 1
        const fitScore = requiredCount <= Math.max(materialCount, 1) ? 100 + requiredCount : 20 - requiredCount
        const actionScore = template.type === 'action' ? 5 : 0
        return { template, score: fitScore + actionScore }
      })
      .sort((a, b) => b.score - a.score)
    return ranked[0]?.template || list[0]
  }

  function slotSummary(template) {
    const slots = getTemplateSlots(template)
    return slots.map(slot => `${slot.code}:${slot.name || '未命名槽位'}${slot.required ? '' : '(选填)'}`).join('\n')
  }

  function buildCatalogRows(templates, category, previewDownloads = {}) {
    return (templates || []).map((template, index) => {
      const templateId = cleanText(template.templateId || template.id)
      return {
        序号: index + 1,
        作业类型: '模板预览',
        主类目: category,
        模板ID: templateId,
        模板名称: cleanText(template.name || template.title),
        模板类型: cleanText(template.type),
        模板比例: cleanText(template.ratio),
        模板时长秒: template.duration || '',
        槽位说明: slotSummary(template),
        模板预览URL: cleanText(template.videoUrl),
        模板预览本地文件: previewDownloads[templateId] || '',
        模板封面URL: cleanText(template.coverUrl),
        源图文件: '',
        源图URL: '',
        上传URL: '',
        图片数量: '',
        分组模式: '',
        提交API: '',
        提交任务ID: '',
        提交SubmitTaskID: '',
        任务状态码: '',
        任务状态: '',
        视频URL: '',
        封面URL: '',
        内容ID: '',
        本地视频文件: '',
        执行结果: '成功',
        备注: '',
      }
    })
  }

  function buildJobs(imageRefs, templates, rawParams = params) {
    const requests = normalizeTemplateRequests(rawParams)
    const groupMode = normalizeGroupMode(rawParams.group_mode)
    const jobs = []
    let index = 0
    for (const request of requests) {
      const template = chooseTemplate(templates, request, imageRefs.length)
      if (!template) continue
      const slots = getTemplateSlots(template)
      const requiredCount = Math.max(1, slots.filter(slot => slot.required).length || slots.length || 1)
      const groups = groupMode === 'all_images_one_video'
        ? [imageRefs.slice(0, Math.max(requiredCount, 1))]
        : imageRefs.map(ref => [ref])
      for (const refs of groups) {
        const materialRefs = refs.filter(Boolean)
        if (!materialRefs.length) continue
        index += 1
        jobs.push({
          index,
          templateRequest: request,
          template,
          templateId: cleanText(template.templateId || template.id),
          templateName: cleanText(template.name || template.title),
          templateType: cleanText(template.type),
          ratio: cleanText(template.ratio),
          duration: template.duration || '',
          previewUrl: cleanText(template.videoUrl),
          coverUrl: cleanText(template.coverUrl),
          materialRefs,
          groupMode,
          prompt: cleanText(rawParams.prompt),
          outputDir: cleanText(rawParams.output_dir) || DEFAULT_OUTPUT_DIR,
        })
      }
    }
    return jobs
  }

  function buildPreviewRows(jobs, templatePreviewDownloads = {}) {
    return (jobs || []).map(job => buildOutputRow(job, {
      status: '预检通过',
      result: '待生成',
      note: `计划使用 ${job.materialRefs.length} 张图片`,
      templatePreviewPath: templatePreviewDownloads[job.templateId] || '',
    }))
  }

  function ensureUploadInput() {
    if (typeof document === 'undefined') throw new Error('当前页面没有 document，无法注入本地图片')
    let input = document.querySelector?.(UPLOAD_INPUT_SELECTOR)
    if (!input) {
      input = document.createElement('input')
      input.type = 'file'
      input.id = UPLOAD_INPUT_ID
      input.multiple = true
      input.accept = 'image/png,image/jpeg,image/jpg,image/webp'
      input.setAttribute('data-crawshrimp-upload', 'bala-qn-img2video')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '-9999px'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0'
      ;(document.body || document.documentElement).appendChild(input)
    }
    return input
  }

  function getInjectedFilesByName() {
    const input = typeof document !== 'undefined' ? document.querySelector?.(UPLOAD_INPUT_SELECTOR) : null
    const files = Array.from(input?.files || [])
    const byName = new Map()
    for (const file of files) byName.set(cleanText(file.name), file)
    return byName
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error(`读取图片失败：${file?.name || ''}`))
      reader.readAsDataURL(file)
    })
  }

  async function uploadDataUrlWithPageHelper(dataUrl, name) {
    if (typeof window.$startFileUpload !== 'function') {
      throw new Error('当前页面未暴露图片上传工具 $startFileUpload，请打开软件管家图生视频页后重试')
    }
    const uploaded = await window.$startFileUpload(dataUrl)
    if (!uploaded || typeof uploaded !== 'object') throw new Error(`图片上传未返回结果：${name}`)
    if (uploaded.success === false) throw new Error(uploaded.message || `图片上传失败：${name}`)
    const url = findFirstRemoteUrl(uploaded)
    if (!url) throw new Error(`图片上传未返回 URL：${name}`)
    return { url, name, uploadResult: uploaded }
  }

  async function resolveMaterialUrls(job) {
    const filesByName = getInjectedFilesByName()
    const cache = window.__BALA_QN_IMG2VIDEO_UPLOAD_CACHE__ = window.__BALA_QN_IMG2VIDEO_UPLOAD_CACHE__ || {}
    const materials = []
    for (const material of job.materialRefs || []) {
      if (material.url) {
        materials.push({ ...material, url: material.url, uploadSource: 'remote' })
        continue
      }
      const ref = material.path || material.ref
      if (cache[ref]) {
        materials.push({ ...material, url: cache[ref], uploadSource: 'local-cache' })
        continue
      }
      const file = filesByName.get(pathBasename(ref))
      if (!file) throw new Error(`本地图片未注入或文件名不匹配：${ref}`)
      const dataUrl = await fileToDataUrl(file)
      const uploaded = await uploadDataUrlWithPageHelper(dataUrl, file.name)
      cache[ref] = uploaded.url
      materials.push({ ...material, url: uploaded.url, uploadSource: 'local-upload' })
    }
    return materials
  }

  function mapMaterialsToTemplateSlots(template, materials) {
    const slots = getTemplateSlots(template)
    if (!slots.length) {
      return materials.map((item, index) => ({ code: String(index), imageUrl: item.url }))
    }
    const mapped = []
    let index = 0
    for (const slot of slots) {
      const material = materials[index]
      if (!material) break
      mapped.push({ code: String(slot.code), imageUrl: material.url })
      index += 1
    }
    return mapped
  }

  function buildFallbackModelImages(template, inputImages, materials) {
    const modelSlot = inputImages.find(item => String(item.code) === '0') || inputImages[0]
    const slotModel = getTemplateSlots(template).find(slot => String(slot.code) === '0')
    const url = modelSlot?.imageUrl || materials?.[0]?.url || cleanText(slotModel?.imageUrl)
    if (!url) return ''
    return JSON.stringify({ front: url, back: '', left: '', right: '' })
  }

  function buildTemplatePayload(job, materials) {
    const template = job.template
    if (!template) throw new Error('未找到可用模板')
    if (!materials.length) throw new Error('没有可用图片素材')
    const provider = cleanText(template.provider) || 'content'
    if (template.type === 'action') {
      return {
        api: 'mtop.taobao.qn.copilot.img2video.template.video.generate',
        data: {
          templateId: job.templateId,
          templateVO: JSON.stringify(template),
          imageUrl: materials[0].url,
          prompt: job.prompt || cleanText(template.description),
          provider,
        },
      }
    }
    const inputImages = mapMaterialsToTemplateSlots(template, materials)
    if (!inputImages.length) throw new Error('模板槽位没有匹配到图片素材')
    return {
      api: 'mtop.taobao.qn.copilot.video.template.generate',
      data: {
        templateId: job.templateId,
        templateVO: JSON.stringify(template),
        modelVO: '',
        provider,
        modelImages: buildFallbackModelImages(template, inputImages, materials),
        inputImages: JSON.stringify(inputImages),
      },
    }
  }

  function extractTaskId(result) {
    const payload = result?.result || result
    const task = payload?.task || payload?.data?.task || payload?.videoTask || payload
    return cleanText(task?.id || task?.taskId || task?.videoTaskId || payload?.id || payload?.taskId)
  }

  function extractSubmitTaskId(result) {
    const payload = result?.result || result
    const task = payload?.task || payload?.data?.task || payload?.videoTask || payload
    return cleanText(task?.submitTaskId || payload?.submitTaskId)
  }

  function normalizeTaskState(payload) {
    const task = payload?.result?.task || payload?.task || payload?.result || payload
    const status = task?.status
    const parsedResult = safeParseJson(task?.result, task?.result || {})
    const composite = parsedResult?.compositeVideo || {}
    const videoList = Array.isArray(parsedResult?.videoList) ? parsedResult.videoList : []
    const firstVideo = videoList.find(item => item?.videoUrl || item?.playUrl || item?.contentId) || videoList[0] || {}
    const videoUrl = cleanText(composite.videoUrl || composite.playUrl || firstVideo.videoUrl || firstVideo.playUrl)
    const coverUrl = cleanText(composite.coverUrl || firstVideo.coverUrl)
    const contentId = cleanText(composite.contentId || firstVideo.contentId)
    const fileId = cleanText(composite.fileId || firstVideo.fileId)
    const errorNotice = cleanText(task?.errorNotice || parsedResult?.errorNotice || composite.errorNotice || firstVideo.errorNotice)
    return {
      task,
      status,
      statusText: STATUS_TEXT[String(status)] || STATUS_TEXT[status] || cleanText(status),
      parsedResult,
      videoUrl,
      coverUrl,
      contentId,
      fileId,
      errorNotice,
      done: Number(status) === 1 || !!videoUrl,
      failed: Number(status) === 2,
    }
  }

  function localRefsForJob(job) {
    return (job.materialRefs || []).filter(item => !item.url).map(item => item.path || item.ref).filter(Boolean)
  }

  function refsKey(refs) {
    return (refs || []).map(cleanText).sort().join('\n')
  }

  function buildRunShared(jobs, rawParams = params, options = {}) {
    return {
      jobs,
      results: options.results || [],
      job_index: 0,
      total_rows: jobs.length,
      current_exec_no: 0,
      current_row_no: 0,
      current_buyer_id: '',
      current_store: '千牛软件管家图生视频',
      batch_no: 1,
      total_batches: 1,
      execute_mode: normalizeExecutionMode(rawParams.execute_mode),
      poll_timeout_ms: parseInteger(rawParams.poll_timeout_minutes, 12, 1, 120) * 60 * 1000,
      poll_interval_ms: parseInteger(rawParams.poll_interval_seconds, 20, 5, 300) * 1000,
      submit_delay_ms: parseInteger(rawParams.submit_delay_ms, 2000, 0, 60000),
      download_videos: checkboxEnabled(rawParams.download_videos, true),
      download_concurrency: parseInteger(rawParams.download_concurrency, 2, 1, 8),
      output_dir: cleanText(rawParams.output_dir),
      downloaded_template_previews: options.downloadedTemplatePreviews || {},
      injected_job_index: null,
      injected_refs_key: '',
      active_job: null,
      active_poll_started_at: 0,
      active_poll_attempts: 0,
      last_download_result: null,
    }
  }

  function buildOutputRow(job, patch = {}) {
    const first = job?.materialRefs?.[0] || {}
    const materials = patch.materials || job?.resolvedMaterials || []
    const uploadedUrls = materials.map(item => item.url).filter(Boolean)
    const noteParts = [patch.note, patch.warning].map(cleanText).filter(Boolean)
    return {
      序号: job?.index || '',
      作业类型: '视频生成',
      主类目: patch.mainCategory || '',
      模板ID: job?.templateId || '',
      模板名称: job?.templateName || '',
      模板类型: job?.templateType || '',
      模板比例: job?.ratio || '',
      模板时长秒: job?.duration || '',
      槽位说明: slotSummary(job?.template || {}),
      模板预览URL: job?.previewUrl || '',
      模板预览本地文件: patch.templatePreviewPath || '',
      模板封面URL: job?.coverUrl || '',
      源图文件: (job?.materialRefs || []).map(item => item.path || item.ref).join('\n'),
      源图URL: (job?.materialRefs || []).map(item => item.url).filter(Boolean).join('\n'),
      上传URL: uploadedUrls.join('\n'),
      图片数量: job?.materialRefs?.length || '',
      分组模式: job?.groupMode || '',
      提交API: patch.api || '',
      提交任务ID: patch.taskId || '',
      提交SubmitTaskID: patch.submitTaskId || '',
      任务状态码: patch.taskStatus ?? '',
      任务状态: patch.status || '',
      视频URL: patch.videoUrl || '',
      封面URL: patch.coverUrl || '',
      内容ID: patch.contentId || '',
      本地视频文件: patch.localVideoPath || '',
      执行结果: patch.result || patch.status || '',
      备注: noteParts.join('；'),
    }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        has_more: true,
        shared: newShared,
      },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs, newShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function downloadUrls(items, nextPhaseName, newShared, options = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        next_phase: nextPhaseName,
        shared_key: options.sharedKey || 'last_download_result',
        concurrency: options.concurrency || 1,
        retry_attempts: options.retryAttempts || 3,
        retry_delay_ms: options.retryDelayMs || 1500,
        timeout_seconds: options.timeoutSeconds || 180,
        sleep_ms: options.sleepMs || 0,
        shared: newShared,
      },
    }
  }

  function complete(data = [], newShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: newShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '巴拉图生视频批量生成失败') }
  }

  function templatePreviewDownloadItems(templates, rawParams = params) {
    const limit = parseInteger(rawParams.template_preview_limit, 26, 1, 200)
    const targetDir = cleanText(rawParams.output_dir)
    return (templates || [])
      .filter(template => cleanText(template.videoUrl))
      .slice(0, limit)
      .map((template, index) => {
        const templateId = cleanText(template.templateId || template.id) || `template-${index + 1}`
        const name = toSafeFilename(`${String(index + 1).padStart(2, '0')}_${templateId}_${cleanText(template.name || template.title)}`, templateId)
        return {
          label: `模板预览 ${templateId}`,
          url: cleanText(template.videoUrl),
          filename: `${name}.mp4`,
          target_dir: targetDir,
          target_relative_path: `模板预览/${name}.mp4`,
          retry_attempts: 3,
          timeout_seconds: 180,
        }
      })
  }

  function mapPreviewDownloads(downloadResult) {
    const byId = {}
    for (const item of downloadResult?.items || []) {
      const label = cleanText(item.label)
      const match = label.match(/模板预览\s+(.+)$/)
      if (match && item.success && item.path) byId[match[1]] = item.path
    }
    return byId
  }

  function videoDownloadItem(job, taskState) {
    const style = job.materialRefs.map(item => item.styleCode).find(Boolean) || pathStem(job.materialRefs[0]?.ref || '')
    const taskId = cleanText(job.taskId)
    const filename = toSafeFilename(`${style || 'video'}_${job.templateName || job.templateId}_${taskId || Date.now()}`, 'bala-qn-video')
    return {
      label: `视频 ${job.index}`,
      url: taskState.videoUrl,
      filename: `${filename}.mp4`,
      target_dir: cleanText(job.outputDir || shared.output_dir),
      target_relative_path: `${toSafeFilename(style || '未分类', '未分类')}/${filename}.mp4`,
      retry_attempts: 5,
      retry_delay_ms: 2000,
      timeout_seconds: 300,
    }
  }

  function latestDownloadPath(downloadResult) {
    const item = (downloadResult?.items || []).find(entry => entry.success && entry.path)
    return cleanText(item?.path)
  }

  async function prepareTemplatesAndJobs() {
    const sellerCategory = await fetchSellerCategory()
    const category = cleanText(params.main_category) || cleanText(sellerCategory.mainCateName) || DEFAULT_CATEGORY
    const templates = await fetchTemplates(category)
    const imageRefs = normalizeImageRefs(params)
    const jobs = buildJobs(imageRefs, templates, params)
    return { sellerCategory, category, templates, imageRefs, jobs }
  }

  async function runMainPhase() {
    const executeMode = normalizeExecutionMode(params.execute_mode)
    const prepared = await prepareTemplatesAndJobs()
    const previewDownloads = {}
    const shouldDownloadPreviews = checkboxEnabled(params.download_template_previews, false)

    if (executeMode === 'catalog') {
      const rows = buildCatalogRows(prepared.templates, prepared.category)
      if (shouldDownloadPreviews) {
        const runShared = {
          mode: 'catalog',
          catalog_rows: rows,
          templates: prepared.templates,
          category: prepared.category,
          current_exec_no: 1,
          total_rows: rows.length,
          current_store: '千牛软件管家图生视频',
        }
        return downloadUrls(
          templatePreviewDownloadItems(prepared.templates, params),
          'finalize_catalog',
          runShared,
          { sharedKey: 'template_preview_downloads', concurrency: 3, timeoutSeconds: 180 },
        )
      }
      return complete(rows, { mode: 'catalog', total_rows: rows.length, category: prepared.category })
    }

    if (!prepared.imageRefs.length) {
      return complete([{
        序号: '',
        作业类型: '视频生成',
        主类目: prepared.category,
        执行结果: '预检失败',
        备注: '请先选择图片、填写远程图片 URL，或选择带文件列表的素材目录',
      }])
    }
    if (!prepared.templates.length) {
      return complete([{
        序号: '',
        作业类型: '视频生成',
        主类目: prepared.category,
        执行结果: '预检失败',
        备注: '未读取到软件管家模板，请确认当前页面已登录且主类目正确',
      }])
    }
    if (!prepared.jobs.length) {
      return complete([{
        序号: '',
        作业类型: '视频生成',
        主类目: prepared.category,
        执行结果: '预检失败',
        备注: '未匹配到可用模板或可用图片',
      }])
    }

    const runShared = buildRunShared(prepared.jobs, params, { downloadedTemplatePreviews: previewDownloads })
    runShared.main_category = prepared.category
    runShared.seller_category = prepared.sellerCategory

    if (executeMode !== 'live') {
      const rows = buildPreviewRows(prepared.jobs, previewDownloads).map(row => ({ ...row, 主类目: prepared.category }))
      if (shouldDownloadPreviews) {
        return downloadUrls(
          templatePreviewDownloadItems(prepared.jobs.map(job => job.template), params),
          'finalize_plan',
          { ...runShared, preview_rows: rows },
          { sharedKey: 'template_preview_downloads', concurrency: 3, timeoutSeconds: 180 },
        )
      }
      return complete(rows, { ...runShared, results: rows })
    }

    if (shouldDownloadPreviews) {
      return downloadUrls(
        templatePreviewDownloadItems(prepared.jobs.map(job => job.template), params),
        'prepare_after_preview_downloads',
        runShared,
        { sharedKey: 'template_preview_downloads', concurrency: 3, timeoutSeconds: 180 },
      )
    }
    return nextPhase('process_row', 0, runShared)
  }

  async function runFinalizeCatalogPhase() {
    const downloads = mapPreviewDownloads(shared.template_preview_downloads || {})
    return complete(buildCatalogRows(shared.templates || [], shared.category || DEFAULT_CATEGORY, downloads), {
      ...shared,
      downloaded_template_previews: downloads,
    })
  }

  async function runFinalizePlanPhase() {
    const downloads = mapPreviewDownloads(shared.template_preview_downloads || {})
    const rows = (shared.preview_rows || []).map(row => ({
      ...row,
      模板预览本地文件: downloads[row.模板ID] || row.模板预览本地文件 || '',
    }))
    return complete(rows, { ...shared, downloaded_template_previews: downloads, results: rows })
  }

  async function runPrepareAfterPreviewDownloadsPhase() {
    const downloads = mapPreviewDownloads(shared.template_preview_downloads || {})
    return nextPhase('process_row', 0, {
      ...shared,
      downloaded_template_previews: downloads,
    })
  }

  async function runProcessRowPhase() {
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const index = Number(shared.job_index || 0)
    const job = jobs[index]
    if (!job) {
      return complete(shared.results || [], shared)
    }

    const localRefs = localRefsForJob(job)
    const localKey = refsKey(localRefs)
    if (localRefs.length && (shared.injected_job_index !== index || shared.injected_refs_key !== localKey)) {
      ensureUploadInput()
      return injectFiles([{ selector: UPLOAD_INPUT_SELECTOR, files: localRefs }], 'process_row', 500, {
        ...shared,
        injected_job_index: index,
        injected_refs_key: localKey,
        current_exec_no: index + 1,
        current_row_no: index + 1,
        current_buyer_id: job.templateName || job.templateId,
      })
    }

    const activeBase = {
      ...shared,
      current_exec_no: index + 1,
      current_row_no: index + 1,
      current_buyer_id: job.templateName || job.templateId,
    }

    try {
      const materials = await resolveMaterialUrls(job)
      const payload = buildTemplatePayload(job, materials)
      const submit = await callMtop(payload.api, payload.data)
      const taskId = extractTaskId(submit)
      const submitTaskId = extractSubmitTaskId(submit)
      if (!taskId) throw new Error('提交成功但未识别到任务ID')
      const activeJob = {
        ...job,
        resolvedMaterials: materials,
        submitApi: payload.api,
        taskId,
        submitTaskId,
      }
      return nextPhase('poll_job', 0, {
        ...activeBase,
        active_job: activeJob,
        active_poll_started_at: Date.now(),
        active_poll_attempts: 0,
      })
    } catch (error) {
      const failedRow = {
        ...buildOutputRow(job, {
          status: '提交失败',
          result: '失败',
          note: error?.message || error,
          templatePreviewPath: shared.downloaded_template_previews?.[job.templateId] || '',
        }),
        主类目: shared.main_category || DEFAULT_CATEGORY,
      }
      return nextPhase('process_row', shared.submit_delay_ms || 0, {
        ...activeBase,
        results: [...(shared.results || []), failedRow],
        job_index: index + 1,
        active_job: null,
      })
    }
  }

  async function runPollJobPhase() {
    const activeJob = shared.active_job
    if (!activeJob) return nextPhase('process_row', 0, shared)
    const attempts = Number(shared.active_poll_attempts || 0) + 1
    const startedAt = Number(shared.active_poll_started_at || Date.now())
    try {
      const payload = await callMtop('mtop.taobao.qn.copilot.quick.task.get', { id: activeJob.taskId })
      const state = normalizeTaskState(payload)
      if (state.done) {
        const completedJob = {
          ...activeJob,
          taskState: state,
        }
        if (shared.download_videos && state.videoUrl) {
          return downloadUrls(
            [videoDownloadItem(completedJob, state)],
            'finalize_video_download',
            {
              ...shared,
              active_job: completedJob,
              active_poll_attempts: attempts,
              last_task_payload: payload,
            },
            {
              sharedKey: 'last_download_result',
              concurrency: shared.download_concurrency || 1,
              timeoutSeconds: 300,
              retryAttempts: 5,
            },
          )
        }
        return nextPhase('process_row', shared.submit_delay_ms || 0, finishActiveJob(completedJob, state, '已生成', '成功'))
      }
      if (state.failed) {
        return nextPhase('process_row', shared.submit_delay_ms || 0, finishActiveJob(activeJob, state, '生成失败', '失败', state.errorNotice))
      }
      if (Date.now() - startedAt >= Number(shared.poll_timeout_ms || 0)) {
        return nextPhase('process_row', shared.submit_delay_ms || 0, finishActiveJob(activeJob, state, '轮询超时', '超时', '已提交但在本次超时时间内未完成'))
      }
      return nextPhase('poll_job', shared.poll_interval_ms || 20000, {
        ...shared,
        active_poll_attempts: attempts,
        last_task_payload: payload,
      })
    } catch (error) {
      if (Date.now() - startedAt >= Number(shared.poll_timeout_ms || 0)) {
        const state = { status: '', statusText: '轮询失败', videoUrl: '', coverUrl: '', contentId: '' }
        return nextPhase('process_row', shared.submit_delay_ms || 0, finishActiveJob(activeJob, state, '轮询失败', '失败', error?.message || error))
      }
      return nextPhase('poll_job', shared.poll_interval_ms || 20000, {
        ...shared,
        active_poll_attempts: attempts,
        last_poll_error: error?.message || String(error),
      })
    }
  }

  function finishActiveJob(job, state, status, result, note = '', localVideoPath = '') {
    const index = Number(shared.job_index || 0)
    const row = {
      ...buildOutputRow(job, {
        status,
        result,
        api: job.submitApi,
        taskId: job.taskId,
        submitTaskId: job.submitTaskId,
        taskStatus: state.status,
        videoUrl: state.videoUrl,
        coverUrl: state.coverUrl,
        contentId: state.contentId,
        localVideoPath,
        materials: job.resolvedMaterials || [],
        templatePreviewPath: shared.downloaded_template_previews?.[job.templateId] || '',
        note,
      }),
      主类目: shared.main_category || DEFAULT_CATEGORY,
    }
    return {
      ...shared,
      results: [...(shared.results || []), row],
      job_index: index + 1,
      current_exec_no: index + 1,
      current_row_no: index + 1,
      active_job: null,
      last_download_result: null,
    }
  }

  async function runFinalizeVideoDownloadPhase() {
    const activeJob = shared.active_job
    if (!activeJob) return nextPhase('process_row', 0, shared)
    const state = activeJob.taskState || {}
    const downloadPath = latestDownloadPath(shared.last_download_result || {})
    const note = downloadPath ? '' : '视频已生成，但本地下载失败或未返回文件路径'
    const result = downloadPath ? '成功' : '下载失败'
    return nextPhase('process_row', shared.submit_delay_ms || 0, finishActiveJob(activeJob, state, downloadPath ? '已下载' : '已生成', result, note, downloadPath))
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      cleanText,
      stringList,
      checkboxEnabled,
      normalizeExecutionMode,
      normalizeGroupMode,
      normalizeSelectedImagePaths,
      normalizeDirectoryListingFiles,
      normalizeImageRefs,
      normalizeTemplateRequests,
      getTemplateSlots,
      chooseTemplate,
      buildCatalogRows,
      buildJobs,
      buildPreviewRows,
      mapMaterialsToTemplateSlots,
      buildFallbackModelImages,
      buildTemplatePayload,
      extractTaskId,
      extractSubmitTaskId,
      normalizeTaskState,
      buildRunShared,
      buildOutputRow,
      templatePreviewDownloadItems,
      mapPreviewDownloads,
      videoDownloadItem,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main' || phase === 'init') return await runMainPhase()
    if (phase === 'finalize_catalog') return await runFinalizeCatalogPhase()
    if (phase === 'finalize_plan') return await runFinalizePlanPhase()
    if (phase === 'prepare_after_preview_downloads') return await runPrepareAfterPreviewDownloadsPhase()
    if (phase === 'process_row') return await runProcessRowPhase()
    if (phase === 'poll_job') return await runPollJobPhase()
    if (phase === 'finalize_video_download') return await runFinalizeVideoDownloadPhase()
    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
