;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const GUANG_URL = 'https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video?ugc_scene=pc_newcreator_video&pageType=video&site=guangguang'
  const RECOMMEND_URL = 'https://huodong.taobao.com/wow/z/guang/publish-feeds/videoPreview?ugc_scene=qn_material_manager&pageType=video&from=sucaizhongxin&hidePageTitleText=true'
  const VIDEO_SELECTOR_URL = 'https://sucai.wangpu.taobao.com/videoSelector.htm?type=video&leafCatId=undefined&index=1&appKey=38829&multiple=3&hideHeader=true&videoOptions=4&validAspectRatio=(1:1,3:4,9:16)&publishType=rapid&bizCode=seller_rapid_vod_publish&canSelectAuditing=1&switchAccount=2&smartCut=true&from=pc_sell_detailfirstvideo&maxDuration=300&scene=seller_publish_setmainpic&handleId=sucai&source=sell&#/'
  const SELL_EDIT_URL = 'https://sell.publish.tmall.com/tmall/publish.htm'
  const VIDEO_SELECTOR_API = 'mtop.taobao.seller.content.material.list'
  const GUANG_PUBLISH_API = 'mtop.taobao.media.guang.pcPublish.publish'
  const RECOMMEND_PUBLISH_API = 'mtop.taobao.spongebob.item.material.publish'
  const READY_RETRY_LIMIT = 45
  const UPLOAD_RETRY_LIMIT = 90
  const SELECTOR_RETRY_LIMIT = 45

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return compact(value).replace(/[\s_\-./（）()【】\[\]:：]+/g, '').toLowerCase()
  }

  function columnValue(row, names) {
    const wanted = names.map(normalizeKey)
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.includes(normalizeKey(key))) return compact(value)
    }
    return ''
  }

  function excelRowNumber(row, index) {
    const value = Number(row?.__row_number || row?.__row_no || row?.行号 || row?.表格行号)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : index + 2
  }

  function normalizeItemId(value) {
    const text = compact(value)
    const query = text.match(/(?:[?&]|^)(?:id|itemId|item_id)=([0-9]{8,})/i)
    if (query) return query[1]
    const direct = text.match(/[0-9]{8,}/)
    return direct ? direct[0] : ''
  }

  function normalizeContentId(value) {
    const match = compact(value).match(/[0-9]{8,}/)
    return match ? match[0] : ''
  }

  function checkboxEnabled(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'boolean') return value
    return !['0', 'false', 'off', 'no', '否'].includes(compact(value).toLowerCase())
  }

  function extensionOf(path) {
    const match = compact(path).split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1].toLowerCase() : ''
  }

  function isVideoPath(path) {
    return ['mp4', 'mov', 'm4v', 'avi', 'wmv', 'mpeg', 'mpg', 'flv', 'mkv'].includes(extensionOf(path))
  }

  function videoListingPaths(rawParams = params) {
    const entries = Array.isArray(rawParams.video_dir_files?.paths) ? rawParams.video_dir_files.paths : []
    return entries
      .map(entry => compact(typeof entry === 'string' ? entry : entry?.path))
      .filter(path => path && isVideoPath(path))
  }

  function matchVideoPath(styleCode, rawParams = params) {
    const override = compact(rawParams.video_override_path)
    if (override) return override
    const paths = videoListingPaths(rawParams)
    const code = compact(styleCode)
    if (!paths.length) return ''
    if (!code) return paths.length === 1 ? paths[0] : ''
    const exactStem = paths.find(path => {
      const name = path.replace(/\\/g, '/').split('/').pop() || ''
      return name.replace(/\.[^.]+$/, '') === code
    })
    if (exactStem) return exactStem
    const contains = paths.filter(path => path.includes(code))
    return contains.length === 1 ? contains[0] : ''
  }

  function parseScheduleTimestamp(dayValue, timeValue) {
    const day = compact(dayValue)
    const time = compact(timeValue)
    if (!day && !time) return null
    const dayMatch = day.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
    if (!dayMatch) throw new Error(`无法识别定时日期：${day}`)
    const timeMatch = time.match(/(\d{1,2})[:时](\d{1,2})(?:[:分](\d{1,2}))?/)
    const hour = timeMatch ? Number(timeMatch[1]) : 0
    const minute = timeMatch ? Number(timeMatch[2]) : 0
    const second = timeMatch?.[3] ? Number(timeMatch[3]) : 0
    if (hour > 23 || minute > 59 || second > 59) throw new Error(`无法识别定时时间：${time}`)
    const iso = `${dayMatch[1]}-${String(dayMatch[2]).padStart(2, '0')}-${String(dayMatch[3]).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`
    const value = Date.parse(iso)
    if (!Number.isFinite(value)) throw new Error(`无法识别定时发布时间：${day} ${time}`)
    return value
  }

  function outputBase(job) {
    return {
      '款号': compact(job?.style_code),
      'ID': compact(job?.item_id),
      '视频标题': compact(job?.title),
      '视频描述': compact(job?.description),
      '参与活动': compact(job?.activity),
      '定时/日': compact(job?.schedule_day),
      '定时/具体时间': compact(job?.schedule_time),
      '上传情况': '',
      '内容ID': compact(job?.existing_content_id),
      '光合发布状态': '',
      '光合内容ID': '',
      '光合接口回执': '',
      '搜推素材状态': '',
      '搜推内容ID': '',
      '搜推接口回执': '',
      '商品视频绑定状态': '',
      '宝贝展示视频ID': '',
      '商品提交回执': '',
      '刷新读回': '',
      '备注': '',
    }
  }

  function previewRow(job) {
    return {
      ...outputBase(job),
      '上传情况': '预检通过',
      '光合发布状态': job.publish_guang ? '计划发布' : '已关闭',
      '搜推素材状态': job.publish_recommend ? '计划发布' : '已关闭',
      '商品视频绑定状态': job.bind_product ? '计划替换宝贝展示并提交' : '已关闭',
      '备注': `视频：${job.video_path}；${job.schedule_at ? `定时毫秒：${job.schedule_at}` : '立即发布'}`,
    }
  }

  function failureRow(styleCode, itemId, title, description, message, row = {}) {
    const base = outputBase({
      style_code: styleCode,
      item_id: itemId,
      title,
      description,
      activity: columnValue(row, ['参与活动']),
      schedule_day: columnValue(row, ['定时/日']),
      schedule_time: columnValue(row, ['定时/具体时间']),
      existing_content_id: columnValue(row, ['内容ID']),
    })
    return { ...base, '上传情况': '预检失败', '备注': compact(message) }
  }

  function normalizeJobs(rawParams = params) {
    const rows = Array.isArray(rawParams.input_file?.rows) ? rawParams.input_file.rows : []
    const jobs = []
    const invalidRows = []
    const seen = new Set()
    rows.forEach((row, index) => {
      const styleCode = columnValue(row, ['款号', '商品款号', '商品编码', '商家编码', 'style_code', 'styleCode'])
      const itemId = normalizeItemId(columnValue(row, ['ID', '商品ID', '天猫商品ID', '宝贝ID', '商品链接', 'item_id', 'itemId']))
      const title = columnValue(row, ['视频标题', '添加标题', '标题'])
      const description = columnValue(row, ['视频描述', '内容描述', '描述'])
      const activity = columnValue(row, ['参与活动'])
      const scheduleDay = columnValue(row, ['定时/日', '定时日期'])
      const scheduleTime = columnValue(row, ['定时/具体时间', '定时时间'])
      const existingContentId = normalizeContentId(columnValue(row, ['内容ID', '光合内容ID']))
      const rowNo = excelRowNumber(row, index)
      const videoPath = matchVideoPath(styleCode, rawParams)
      if (!itemId) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行缺少商品ID`, row))
        return
      }
      if (!title) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行缺少视频标题`, row))
        return
      }
      if (title.length > 20) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行视频标题超过搜推素材20字限制`, row))
        return
      }
      if (description.length < 10 || description.length > 1000) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行视频描述需为10-1000字`, row))
        return
      }
      if (!videoPath) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行未匹配到视频；请填写测试视频路径或选择按款号命名的视频目录`, row))
        return
      }
      if (seen.has(itemId)) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行与前面商品任务重复`, row))
        return
      }
      let scheduleAt = null
      try {
        scheduleAt = parseScheduleTimestamp(scheduleDay, scheduleTime)
      } catch (error) {
        invalidRows.push(failureRow(styleCode, itemId, title, description, `模板第${rowNo}行${compact(error?.message || error)}`, row))
        return
      }
      seen.add(itemId)
      jobs.push({
        row_no: rowNo,
        style_code: styleCode,
        item_id: itemId,
        title,
        description,
        activity,
        schedule_day: scheduleDay,
        schedule_time: scheduleTime,
        schedule_at: scheduleAt,
        video_path: videoPath,
        existing_content_id: existingContentId,
        publish_guang: checkboxEnabled(rawParams.publish_guang, true),
        publish_recommend: checkboxEnabled(rawParams.publish_recommend, true),
        bind_product: checkboxEnabled(rawParams.bind_product, true),
      })
    })
    return { jobs, invalidRows }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: Number(sleepMs || 0),
        has_more: true,
        shared: newShared,
      },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 500, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: Number(sleepMs || 0),
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

  function currentJob(state = shared) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Math.max(0, Number(state.job_index || 0))
    return { jobs, index, job: jobs[index] || null }
  }

  function currentWork(state = shared) {
    return state.current_work && typeof state.current_work === 'object' ? state.current_work : {}
  }

  function navigateTo(url, next, state = shared, label = '') {
    if (compact(location.href) !== url) location.href = url
    return nextPhase(next, 1200, {
      ...state,
      page_ready_attempts: 0,
      current_store: label || url,
    })
  }

  function loginExpired() {
    const href = compact(location.href)
    const text = compact(document.body?.innerText)
    return /login\.(taobao|tmall)\.com/i.test(href) || /亲，请登录|扫码登录|密码登录/.test(text)
  }

  function findReactFiber(element) {
    if (!element) return null
    const key = Object.keys(element).find(name =>
      name.startsWith('__reactInternalInstance') || name.startsWith('__reactFiber'),
    )
    return key ? element[key] : null
  }

  function findPublishRuntime() {
    const elements = Array.from(document.querySelectorAll?.('input,textarea,button') || [])
    for (const element of elements) {
      let fiber = findReactFiber(element)
      while (fiber) {
        const props = fiber.memoizedProps
        if (
          props?.store?.getState &&
          props?.actions?.content?.updateContentItem &&
          typeof props.dispatch === 'function'
        ) {
          return {
            store: props.store,
            actions: props.actions,
            dispatch: props.dispatch,
          }
        }
        fiber = fiber.return
      }
    }
    return null
  }

  function publishContent(runtime) {
    const state = runtime?.store?.getState?.() || {}
    return state?.content?.value || state?.content || {}
  }

  function publishConfig(runtime) {
    const state = runtime?.store?.getState?.() || {}
    return state?.config?.value || state?.config || {}
  }

  function setContentValue(runtime, key, value) {
    runtime.dispatch(runtime.actions.content.updateContentItem({ key, value }))
  }

  function publishPageReady(expectedUrlPrefix) {
    return location.href.startsWith(expectedUrlPrefix) && Boolean(findPublishRuntime()) && Boolean(document.querySelector?.('input[type=file]'))
  }

  function findDescriptionEditorProps() {
    const candidates = Array.from(document.querySelectorAll?.('textarea') || [])
    for (const textarea of candidates) {
      let fiber = findReactFiber(textarea)
      let matched = null
      while (fiber) {
        const props = fiber.memoizedProps || {}
        if (
          typeof props.onChange === 'function' &&
          props.value?.document &&
          typeof props.value?.insertText === 'function'
        ) {
          matched = props
        }
        fiber = fiber.return
      }
      if (matched) return matched
    }
    return null
  }

  function descriptionEditorText() {
    return compact(findDescriptionEditorProps()?.value?.document?.text)
  }

  function setDescriptionEditorValue(description, required = false) {
    const editorProps = findDescriptionEditorProps()
    if (!editorProps) {
      if (required) throw new Error('搜推素材内容描述富文本编辑器尚未准备好')
      return ''
    }
    let nextValue = editorProps.value
    const rawTextNodes = nextValue.document.getTexts?.() || []
    const textNodes = Array.isArray(rawTextNodes) ? rawTextNodes : rawTextNodes.toArray?.() || []
    for (const textNode of [...textNodes].reverse()) {
      const text = String(textNode?.text || '')
      const path = textNode?.key ? nextValue.document.getPath?.(textNode.key) : null
      if (path && text) nextValue = nextValue.removeText(path, 0, text)
    }
    const firstText = nextValue.document.getFirstText?.()
    const path = firstText?.key ? nextValue.document.getPath?.(firstText.key) : null
    if (!path) throw new Error('内容描述富文本编辑器文本路径不可用')
    nextValue = nextValue.insertText(path, 0, description, [])
    editorProps.onChange({ value: nextValue })
    return compact(nextValue?.document?.text)
  }

  function selectRadioGroupValueByLabel(label, value) {
    const input = Array.from(document.querySelectorAll?.('input[type=radio]') || []).find(candidate =>
      compact(candidate.parentElement?.parentElement?.innerText) === label,
    )
    let fiber = findReactFiber(input)
    while (fiber) {
      const props = fiber.memoizedProps || {}
      const typeName = fiber.type?.displayName || fiber.type?.name || ''
      if (typeName === 'RadioGroup' && typeof props.onChange === 'function') {
        props.onChange(String(value), { target: input, currentTarget: input })
        return true
      }
      fiber = fiber.return
    }
    return false
  }

  async function prepareGuangRequiredOptions(runtime) {
    let value = publishContent(runtime)
    for (let attempt = 0; attempt < 30 && !value.coverUser?.url && !value.intellectCover?.length; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
      value = publishContent(runtime)
    }
    const cover = value.coverUser?.url ? value.coverUser : value.intellectCover?.[0]
    if (!cover?.url) throw new Error('光合视频封面尚未生成')
    setContentValue(runtime, 'coverUser', {
      url: cover.url,
      width: Number(cover.width || value.video?.width || 0) || undefined,
      height: Number(cover.height || value.video?.height || 0) || undefined,
      origin: cover.origin || 'intellect',
      statInfo: {
        source: cover.origin || null,
        cover_text: null,
        cover_text_content: null,
      },
    })
    if (!selectRadioGroupValueByLabel('内容无需标注', '0')) {
      throw new Error('光合创作者声明控件尚未准备好')
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    return publishContent(runtime).coverUser
  }

  function describeError(error, fallback = '') {
    if (!error) return fallback
    if (typeof error === 'string') return compact(error)
    const ret = Array.isArray(error.ret) ? error.ret.join('；') : ''
    const data = error.data || error.result || {}
    return [
      data.errorMsg,
      data.message,
      error.message,
      error.msg,
      ret,
      data.errorCode ? `errorCode=${data.errorCode}` : '',
    ].map(compact).filter(Boolean).join('；') || fallback
  }

  function unwrapMtopPayload(payload, api) {
    if (!payload || typeof payload !== 'object') return payload
    if (Array.isArray(payload.ret)) {
      const failed = payload.ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) throw new Error(`${api} 返回失败：${describeError(payload, payload.ret.join('；'))}`)
    }
    return payload.data !== undefined ? payload.data : payload
  }

  async function callMtop(api, data = {}, options = {}) {
    const client = window.lib?.mtop || window.mtop
    if (!client || typeof client.request !== 'function') throw new Error(`当前页面未找到 MTop 客户端：${api}`)
    try {
      const payload = await client.request({
        api,
        v: options.v || '1.0',
        type: options.type || 'GET',
        dataType: 'json',
        H5Request: true,
        preventFallback: true,
        ...(options.timeout ? { timeout: Number(options.timeout) } : {}),
        data,
      })
      return unwrapMtopPayload(payload, api)
    } catch (error) {
      throw new Error(`${api} 返回失败：${describeError(error, '未知错误')}`)
    }
  }

  function publishApiForScene(scene) {
    return scene === 'qn_material_manager' ? RECOMMEND_PUBLISH_API : GUANG_PUBLISH_API
  }

  function rotateLeft(value, amount) {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0
  }

  function md5Hex(value) {
    const encoded = encodeURIComponent(String(value))
    const bytes = []
    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] === '%') {
        bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16))
        index += 2
      } else {
        bytes.push(encoded.charCodeAt(index))
      }
    }
    const byteLength = bytes.length
    const words = []
    for (let index = 0; index < byteLength; index += 1) {
      words[index >> 2] = (words[index >> 2] || 0) | (bytes[index] << ((index % 4) * 8))
    }
    words[byteLength >> 2] = (words[byteLength >> 2] || 0) | (0x80 << ((byteLength % 4) * 8))
    const paddedWordLength = (((byteLength + 8) >>> 6) + 1) * 16
    words.length = paddedWordLength
    words[paddedWordLength - 2] = (byteLength * 8) >>> 0
    words[paddedWordLength - 1] = Math.floor((byteLength * 8) / 0x100000000)

    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]
    const constants = Array.from({ length: 64 }, (_, index) =>
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
    )
    let a = 0x67452301
    let b = 0xefcdab89
    let c = 0x98badcfe
    let d = 0x10325476
    for (let offset = 0; offset < words.length; offset += 16) {
      const startA = a
      const startB = b
      const startC = c
      const startD = d
      for (let index = 0; index < 64; index += 1) {
        let mixed
        let wordIndex
        if (index < 16) {
          mixed = (b & c) | (~b & d)
          wordIndex = index
        } else if (index < 32) {
          mixed = (d & b) | (~d & c)
          wordIndex = (5 * index + 1) % 16
        } else if (index < 48) {
          mixed = b ^ c ^ d
          wordIndex = (3 * index + 5) % 16
        } else {
          mixed = c ^ (b | ~d)
          wordIndex = (7 * index) % 16
        }
        const next = (a + mixed + constants[index] + (words[offset + wordIndex] || 0)) >>> 0
        a = d
        d = c
        c = b
        b = (b + rotateLeft(next, shifts[index])) >>> 0
      }
      a = (a + startA) >>> 0
      b = (b + startB) >>> 0
      c = (c + startC) >>> 0
      d = (d + startD) >>> 0
    }
    return [a, b, c, d].map(word =>
      [0, 8, 16, 24].map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join(''),
    ).join('')
  }

  function createRequestId(content = {}) {
    const existing = compact(content.umi_pub_session || window.sessionId)
    if (existing) return existing
    try {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID()
    } catch (error) {}
    return `crawshrimp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function normalizePublishItem(item) {
    const result = { ...(item || {}) }
    delete result.picUrl
    return result
  }

  function coverTypeForOrigin(origin) {
    return {
      intellect: '2',
      user_upload: '1',
      upload: '1',
      user_frame: '0',
      frame: '0',
      default: '0',
    }[compact(origin)] || '0'
  }

  function publishAbParams(config = {}) {
    return Object.values(config.abParams || {}).map(value => {
      const item = { ...(value || {}) }
      delete item.dataTracks
      return item
    })
  }

  async function generatePublishSession(scene) {
    const data = await callMtop('mtop.taobao.media.guang.session.generate', {
      request: JSON.stringify({ ugcScene: scene }),
    }, { type: 'POST' })
    const session = data?.model || data?.result || data || {}
    const publishSession = compact(session.publishSession || session.session)
    if (!publishSession) throw new Error('发布会话生成成功但未返回 publishSession')
    return publishSession
  }

  function buildDirectPublishRequest(scene, runtime, publishSession) {
    const content = publishContent(runtime)
    const config = publishConfig(runtime)
    const requestId = createRequestId(content)
    const userId = compact(window.__USER_INFO__?.userId)
    if (!userId) throw new Error('当前发布器未提供用户标识，无法生成发布校验值')
    const cover = content.coverUser || {}
    const publishExtra = {
      ...(content.publishExtra && typeof content.publishExtra === 'object' ? content.publishExtra : {}),
      ...(config.publishParams && typeof config.publishParams === 'object' ? config.publishParams : {}),
      ...(compact(window.sessionId || content.umi_pub_session)
        ? { umi_pub_session: compact(window.sessionId || content.umi_pub_session) }
        : {}),
      text_type: '0',
      cover_type: coverTypeForOrigin(cover.origin),
      post_channel: scene === 'qn_material_manager' ? 'exnormal' : 'normal',
      ...(content.onlineTime ? { online_time: content.onlineTime } : {}),
      ...(compact(window.dataSession) ? { dataSession: compact(window.dataSession) } : {}),
      is_rcmd_publisher: '1',
      ...(scene === 'qn_material_manager' ? { duplicate_tips: 0 } : {}),
    }
    const request = {
      id: compact(content.id),
      bizCode: compact(config.bizCode || content.bizCode),
      shortTitle: encodeURIComponent(compact(content.shortTitle)),
      requestId,
      title: encodeURIComponent(compact(content.title)),
      contentType: 'video',
      ugcScene: scene,
      shareResult: compact(content.shareResult),
      topics: Array.isArray(content.topics) ? content.topics : [],
      items: (Array.isArray(content.items) ? content.items : []).map(normalizePublishItem),
      video: {
        fileId: compact(content.fileId || content.video?.fileId),
        interactiveId: compact(content.interactiveObject?.id),
        statInfo: { audio: Array.isArray(content.video?.statInfo?.audio) ? content.video.statInfo.audio : [] },
      },
      coverUser: [{
        url: compact(cover.url),
        width: Number(cover.width || 0) || undefined,
        height: Number(cover.height || 0) || undefined,
        statInfo: {
          source: null,
          cover_text: null,
          cover_text_content: null,
        },
      }],
      downloadEnable: compact(content.downloadEnable || '0'),
      customModuleFrontData: content.customModuleFrontData || {},
      ...(config.publishParams?.enableHosting === 'true'
        ? { hostingStatus: config.publishParams?.hostingDefaultValue === 'true' ? 1 : 0 }
        : {}),
      ...(publishAbParams(config).length ? { abParams: publishAbParams(config) } : {}),
      pois: Array.isArray(content.pois) ? content.pois : [],
      shops: Array.isArray(content.shops) ? content.shops : [],
      collections: Array.isArray(content.collections) ? content.collections : [],
      publishExtra,
      ...(content.onlineTime ? { onlineTime: content.onlineTime } : {}),
      ...(scene !== 'qn_material_manager' && content.contentSource?.fromType !== ''
        ? { contentSource: { fromType: Number(content.contentSource?.fromType || 0) } }
        : {}),
      publishSession,
      publishToken: md5Hex(`${userId}2088666${requestId}`),
    }
    return request
  }

  function extractContentId(payload) {
    const direct = normalizeContentId(payload)
    if (direct) return direct
    const wrapped = normalizeContentId(payload?.contentId || payload?.content_id || payload?.id || payload?.data || payload?.model || payload?.result)
    if (wrapped) return wrapped
    for (const value of nestedValues(payload)) {
      const id = normalizeContentId(value?.contentId || value?.content_id)
      if (id) return id
      const primitive = normalizeContentId(value)
      if (primitive) return primitive
    }
    return ''
  }

  async function publishPreparedContent(scene) {
    const api = publishApiForScene(scene)
    const runtime = findPublishRuntime()
    if (!runtime) throw new Error('发布器 Redux runtime 尚未准备好')
    const publishSession = await generatePublishSession(scene)
    const request = buildDirectPublishRequest(scene, runtime, publishSession)
    const payload = await callMtop(api, {
      request: JSON.stringify(request),
    }, { type: 'POST', timeout: 120000 })
    const contentId = extractContentId(payload)
    if (!contentId) throw new Error(`${api} 已返回成功但未识别到内容ID`)
    return {
      contentId,
      receipt: `${api} SUCCESS contentId=${contentId}`,
      payload,
    }
  }

  function normalizeItem(item, itemId) {
    const id = normalizeItemId(item?.itemId || item?.id || itemId)
    const title = compact(item?.title || item?.itemTitle || item?.name)
    let picUrl = compact(item?.picUrl || item?.image || item?.itemPic)
    if (picUrl.startsWith('//')) picUrl = `https:${picUrl}`
    return { ...item, itemId: id, id, title, itemTitle: title, picUrl, source: 'selfShop' }
  }

  function extractArray(value, depth = 0) {
    if (depth > 6 || value == null) return []
    if (Array.isArray(value)) return value
    if (typeof value !== 'object') return []
    for (const key of ['items', 'list', 'dataSource', 'data', 'result', 'model']) {
      const found = extractArray(value[key], depth + 1)
      if (found.length) return found
    }
    for (const child of Object.values(value)) {
      const found = extractArray(child, depth + 1)
      if (found.length) return found
    }
    return []
  }

  async function searchGuangItem(itemId, ugcScene) {
    const data = await callMtop('mtop.taobao.media.guang.item.listItems', {
      source: 'selfShop',
      cursor: '',
      keyword: String(itemId),
      pageSize: 15,
      expoContents: '',
      sortType: '',
      sortValue: '',
      ugc_scene: ugcScene,
      ugcScene,
      pageType: 'video',
      site: ugcScene === 'pc_newcreator_video' ? 'guangguang' : '',
      publishVersion: '1',
      secondLevelFilterValue: '-1',
    })
    const items = extractArray(data).map(item => normalizeItem(item, itemId)).filter(item => item.itemId)
    return items.find(item => item.itemId === String(itemId)) || items[0] || null
  }

  function summarizeCapture(capture) {
    const matches = Array.isArray(capture?.matches) ? capture.matches : []
    return matches.map(match => {
      const url = compact(match.url)
      let label = url
      try {
        const parsed = new URL(url)
        label = parsed.searchParams.get('api') || parsed.pathname
      } catch (error) {}
      return `${label} HTTP ${match.status || match.status_code || 'unknown'}`
    }).join('；')
  }

  function parseJsonLike(value) {
    if (value && typeof value === 'object') return value
    const text = compact(value)
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (error) {}
    const start = text.indexOf('(')
    const end = text.lastIndexOf(')')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start + 1, end))
      } catch (error) {}
    }
    return null
  }

  function nestedValues(value, depth = 0) {
    if (depth > 8 || value == null) return []
    if (Array.isArray(value)) return value.flatMap(item => nestedValues(item, depth + 1))
    if (typeof value !== 'object') return []
    return [value, ...Object.values(value).flatMap(item => nestedValues(item, depth + 1))]
  }

  function capturePayloads(capture) {
    return (Array.isArray(capture?.matches) ? capture.matches : [])
      .map(match => parseJsonLike(match.body || match.response_body || match.responseBody))
      .filter(Boolean)
  }

  function extractCaptureError(capture) {
    for (const payload of capturePayloads(capture)) {
      const ret = Array.isArray(payload?.ret) ? payload.ret : []
      const failed = ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) return describeError(payload, ret.join('；'))
      for (const value of nestedValues(payload)) {
        if (value?.success === false || value?.fail === true) {
          return describeError(value, '平台返回失败')
        }
      }
    }
    return ''
  }

  function extractContentIdFromCapture(capture) {
    for (const payload of capturePayloads(capture)) {
      for (const value of nestedValues(payload)) {
        const id = normalizeContentId(value?.contentId || value?.content_id)
        if (id) return id
      }
    }
    return ''
  }

  function mergeWork(state, patch) {
    return { ...state, current_work: { ...currentWork(state), ...patch } }
  }

  function finishJob(state, patch = {}) {
    const { job, jobs, index } = currentJob(state)
    const work = { ...currentWork(state), ...patch }
    const statuses = [
      work.guang_status && `光合：${work.guang_status}`,
      work.recommend_status && `搜推：${work.recommend_status}`,
      work.product_status && `商品：${work.product_status}`,
    ].filter(Boolean)
    const row = {
      ...outputBase(job),
      '上传情况': statuses.join('；') || '已完成',
      '内容ID': compact(work.guang_content_id || job?.existing_content_id),
      '光合发布状态': compact(work.guang_status),
      '光合内容ID': compact(work.guang_content_id || job?.existing_content_id),
      '光合接口回执': compact(work.guang_receipt),
      '搜推素材状态': compact(work.recommend_status),
      '搜推内容ID': compact(work.recommend_content_id),
      '搜推接口回执': compact(work.recommend_receipt),
      '商品视频绑定状态': compact(work.product_status),
      '宝贝展示视频ID': compact(work.product_video_id),
      '商品提交回执': compact(work.product_receipt),
      '刷新读回': compact(work.refresh_readback),
      '备注': [...new Set((work.notes || []).map(compact).filter(Boolean))].join('；'),
    }
    const results = [...(state.results || []), row]
    const nextIndex = index + 1
    if (nextIndex >= jobs.length) {
      return complete([...(state.invalid_rows || []), ...results], {
        ...state,
        results,
        job_index: nextIndex,
        current_work: {},
        current_store: '短视频批量上传完成',
      })
    }
    return nextPhase('navigate_guang', 500, {
      ...state,
      results,
      job_index: nextIndex,
      current_work: {},
      current_exec_no: nextIndex + 1,
      current_row_no: jobs[nextIndex]?.row_no || 0,
      current_buyer_id: jobs[nextIndex]?.style_code || jobs[nextIndex]?.item_id || '',
      current_store: `准备上传 ${nextIndex + 1}/${jobs.length}`,
    })
  }

  function appendNote(state, note) {
    const work = currentWork(state)
    return mergeWork(state, { notes: [...(work.notes || []), compact(note)].filter(Boolean) })
  }

  function routeAfterGuang(state) {
    const { job } = currentJob(state)
    if (job?.publish_recommend) return nextPhase('navigate_recommend', 500, state)
    if (job?.bind_product) return nextPhase('navigate_selector', 500, state)
    return finishJob(state)
  }

  function routeAfterRecommend(state) {
    const { job } = currentJob(state)
    if (job?.bind_product) return nextPhase('navigate_selector', 500, state)
    return finishJob(state)
  }

  async function preparePublishForm(job, scene) {
    const runtime = findPublishRuntime()
    if (!runtime) throw new Error('发布器 Redux runtime 尚未准备好')
    const item = await searchGuangItem(job.item_id, scene)
    if (!item) throw new Error(`商品 ${job.item_id} 未在发布器商品接口中查到`)
    setContentValue(runtime, 'items', [item])
    // 关联商品会异步触发智能标题/封面更新；等它稳定后再写业务标题和描述，
    // 避免页面 effect 把脚本刚写入的文本覆盖为空。
    await new Promise(resolve => setTimeout(resolve, 1200))
    setContentValue(runtime, 'shortTitle', job.title)
    setContentValue(runtime, 'title', job.description)
    setDescriptionEditorValue(job.description, scene === 'qn_material_manager')
    if (scene === 'pc_newcreator_video') setContentValue(runtime, 'onlineTime', job.schedule_at)
    if (scene === 'pc_newcreator_video') await prepareGuangRequiredOptions(runtime)
    await new Promise(resolve => setTimeout(resolve, 250))
    const value = publishContent(runtime)
    return {
      item,
      readback: {
        shortTitle: value.shortTitle,
        title: value.title,
        editorTitle: descriptionEditorText(),
        coverUser: value.coverUser,
        items: value.items,
        onlineTime: value.onlineTime,
        fileId: value.fileId,
        videoStatus: value.videoStatus,
        compliantResult: value.compliantResult,
        compliantResultList: value.compliantResultList,
      },
    }
  }

  function validatePublishReadback(job, readback, scene) {
    if (compact(readback.shortTitle) !== job.title) throw new Error('发布器标题写入后读回不一致')
    if (compact(readback.title) !== job.description) throw new Error('发布器描述写入后读回不一致')
    if (scene === 'qn_material_manager' && compact(readback.editorTitle) !== job.description) {
      throw new Error('搜推素材富文本描述写入后读回不一致')
    }
    const itemId = normalizeItemId(readback.items?.[0]?.itemId || readback.items?.[0]?.id)
    if (itemId !== job.item_id) throw new Error('发布器关联商品写入后读回不一致')
    if (scene === 'pc_newcreator_video' && (readback.onlineTime ?? null) !== (job.schedule_at ?? null)) {
      throw new Error('光合定时时间写入后读回不一致')
    }
    if (scene === 'pc_newcreator_video' && !compact(readback.coverUser?.url)) {
      throw new Error('光合视频封面写入后读回为空')
    }
    if (!readback.fileId || readback.videoStatus !== 'success') throw new Error('视频尚未上传完成')
  }

  async function queryVideoRecord(contentId) {
    const data = await callMtop(VIDEO_SELECTOR_API, {
      hideInvalidVideo: false,
      name: String(contentId),
      pageNum: 1,
      pageSize: 20,
      channels: '[]',
      keyWord: String(contentId),
      appKey: '38829',
      type: 'mobile',
    })
    const records = extractArray(data)
    return records.find(record => normalizeContentId(record?.contentId || record?.id) === String(contentId)) || null
  }

  function buildDisplayVideo(record) {
    const id = normalizeContentId(record?.id || record?.contentId)
    if (!id) throw new Error('视频选择器记录缺少内容ID')
    return {
      videoId: Number(id),
      videoInfo: {
        mainPicUrl: compact(record.snapshot),
        videoId: Number(id),
        sceneCode: 'auctionVideos',
        sceneName: 'auctionVideos',
        width: Number(record.width || 0) || undefined,
        height: Number(record.height || 0) || undefined,
        videoRadio: compact(record.aspectRatio),
        videoRatio: compact(record.aspectRatio),
        videoUrl: compact(record.playUrl || record.originalVideoUrl),
        duration: Number(record.length || record.duration || 0) || undefined,
      },
      videoType: '宝贝展示',
      status: 0,
      empty: false,
    }
  }

  function getSellComponentValue(name) {
    try {
      const state = window.__SELL_STATE__?.getState?.()
      return state?.getComponentValue?.(name)
    } catch (error) {
      return undefined
    }
  }

  function findAuctionVideoProps() {
    const root = document.querySelector?.('#sell-field-auctionVideos')
    let fiber = findReactFiber(root)
    while (fiber) {
      const props = fiber.memoizedProps
      if (props?.name === 'auctionVideos' && Array.isArray(props.value) && typeof props.onChange === 'function') {
        return props
      }
      fiber = fiber.return
    }
    return null
  }

  function bindDisplayVideo(record) {
    const props = findAuctionVideoProps()
    if (!props) throw new Error('商品编辑页 auctionVideos 官方 onChange 尚未准备好')
    const displayVideo = buildDisplayVideo(record)
    const lectureVideos = props.value.filter(item => compact(item?.videoType) !== '宝贝展示')
    props.onChange([...lectureVideos, displayVideo])
    const readback = getSellComponentValue('auctionVideos') || []
    return { displayVideo, lectureVideos, readback }
  }

  function buildProductSubmitRequest() {
    const state = window.__SELL_STATE__?.getState?.()
    const models = state?.engine?.getModels?.()
    const globalValue = models?.global?.value
    const formValues = models?.formValues
    if (!state?.getGlobal || !globalValue || !formValues) {
      throw new Error('商品编辑页官方表单状态尚未准备好')
    }
    const params = new URLSearchParams()
    const append = (key, value) => {
      if (value === undefined) return
      params.append(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
    append('isLightCombine', state.getGlobal('isLightCombine'))
    append('isSetsCombine', state.getGlobal('isSetsCombine'))
    append('combineToNormal', state.getGlobal('combineToNormal'))
    append('tmSpuPublishType', state.getGlobal('tmSpuPublishType'))
    append('isUnBondedGift', state.getGlobal('isUnBondedGift'))
    append('spu_qf_param', state.getGlobal('spu_qf_param'))
    append('catId', state.getGlobal('catId'))
    append('itemId', state.getGlobal('id'))
    append('submitUrlDataKey', state.getGlobal('scUrlDataComp'))
    append('roleType', state.getGlobal('roleType'))
    append('jsonBody', { ...globalValue, ...formValues })
    append('globalExtendInfo', models.global?.globalExtendInfo)
    return {
      method: 'POST',
      url: new URL('submit.htm', location.href).href,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    }
  }

  function findSellPageState() {
    const state = window.__SELL_STATE__?.getState?.()
    const plugins = state?.engine?._engine?._core?._pluginCenter?.plugins
    const candidates = Array.isArray(plugins) ? plugins : Object.values(plugins || {})
    for (const plugin of candidates) {
      const pageState = plugin?.app?.pageState || plugin?.pageState
      if (typeof pageState?.submit === 'function') return pageState
    }
    return null
  }

  function productSubmitErrorMessages(value) {
    const messages = []
    const seen = new Set()
    const visit = (item, depth = 0) => {
      if (depth > 8 || item == null) return
      if (typeof item === 'string') {
        const text = compact(item)
        if (text && !messages.includes(text)) messages.push(text)
        return
      }
      if (typeof item !== 'object' || seen.has(item)) return
      seen.add(item)
      if (Array.isArray(item)) {
        item.forEach(child => visit(child, depth + 1))
        return
      }
      for (const [key, child] of Object.entries(item)) {
        if (/^(?:msg|message|errorMsg|errorMessage)$/i.test(key)) visit(child, depth + 1)
        else if (child && typeof child === 'object') visit(child, depth + 1)
      }
    }
    visit(value)
    return messages
  }

  async function submitProductViaApi() {
    const request = buildProductSubmitRequest()
    const pageState = findSellPageState()
    if (!pageState) throw new Error('商品编辑页 pageState.submit API 尚未准备好')
    const state = window.__SELL_STATE__?.getState?.()
    const models = state?.engine?.getModels?.()
    const data = Object.fromEntries(new URLSearchParams(request.body).entries())
    let backendError = null
    let payload
    try {
      payload = await pageState.submit({
        url: 'submit.htm',
        method: 'POST',
        data,
        headers: {
          'x-gpf-type': models?.global?.edit ? '1' : '0',
          'x-gpf-renderId': compact(models?.global?.frontDataLog?.traceId),
        },
        backendErrorCallback: value => {
          backendError = value
        },
      })
    } catch (error) {
      const messages = productSubmitErrorMessages(error)
      throw new Error(`商品提交接口返回失败：${messages.join('；') || describeError(error, '未知错误')}`)
    }
    const globalMessage = payload?.models?.globalMessage || {}
    const messageType = compact(globalMessage.type)
    if (messageType !== 'success' || payload?.success === false) {
      const messages = productSubmitErrorMessages(backendError || payload)
      throw new Error(`商品提交接口返回失败：${messages.join('；') || messageType || '未知错误'}`)
    }
    return {
      receipt: `pageState.submit POST /tmall/submit.htm ${messageType}`,
      payload,
    }
  }

  function selectorPageReady() {
    return location.href.startsWith('https://sucai.wangpu.taobao.com/videoSelector.htm') && Boolean(window.lib?.mtop?.request || window.mtop?.request)
  }

  function sellPageReady(itemId) {
    return location.href.startsWith(SELL_EDIT_URL) &&
      normalizeItemId(location.href) === String(itemId) &&
      Array.isArray(getSellComponentValue('auctionVideos')) &&
      Boolean(findAuctionVideoProps()) &&
      Boolean(findSellPageState())
  }

  if (testExports) {
    Object.assign(testExports, {
      normalizeJobs,
      parseScheduleTimestamp,
      matchVideoPath,
      normalizeContentId,
      extractContentId,
      extractContentIdFromCapture,
      extractCaptureError,
      buildDisplayVideo,
      md5Hex,
      buildDirectPublishRequest,
      buildProductSubmitRequest,
      findSellPageState,
      productSubmitErrorMessages,
      outputBase,
      previewRow,
      validatePublishReadback,
    })
  }
  if (phase === '__exports__') return complete([])

  if (phase === 'main' || phase === 'init') {
    const { jobs, invalidRows } = normalizeJobs(params)
    const previewRows = [...invalidRows, ...jobs.map(previewRow)]
    if (compact(params.execute_mode).toLowerCase() !== 'live') {
      return complete(previewRows, {
        jobs,
        invalid_rows: invalidRows,
        results: [],
        total_rows: previewRows.length,
        current_store: '短视频批量上传预检完成',
      })
    }
    if (!jobs.length || invalidRows.length) {
      return complete(previewRows.length ? previewRows : [failureRow('', '', '', '', 'Excel 没有可执行数据行')], {
        jobs,
        invalid_rows: invalidRows,
        results: [],
        total_rows: previewRows.length,
      })
    }
    return nextPhase('navigate_guang', 0, {
      jobs,
      invalid_rows: [],
      results: [],
      job_index: 0,
      current_work: {},
      total_rows: jobs.length,
      current_exec_no: 1,
      current_row_no: jobs[0].row_no,
      current_buyer_id: jobs[0].style_code || jobs[0].item_id,
      current_store: `准备上传 1/${jobs.length}`,
    })
  }

  if (phase === 'navigate_guang') {
    const { job } = currentJob(shared)
    if (!job) return complete([...(shared.invalid_rows || []), ...(shared.results || [])], shared)
    if (!job.publish_guang) {
      const state = mergeWork(shared, {
        guang_content_id: job.existing_content_id,
        guang_status: job.existing_content_id ? '使用模板已有内容ID' : '已关闭',
      })
      return routeAfterGuang(state)
    }
    if (publishPageReady('https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video')) {
      return nextPhase('prepare_guang_upload', 0, shared)
    }
    return navigateTo(GUANG_URL, 'wait_guang_page', shared, '进入光合视频发布器')
  }

  if (phase === 'wait_guang_page') {
    if (loginExpired()) return finishJob(mergeWork(shared, { guang_status: '失败' }), { notes: ['光合登录已失效'] })
    if (publishPageReady('https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video')) {
      return nextPhase('prepare_guang_upload', 0, shared)
    }
    const attempts = Number(shared.page_ready_attempts || 0) + 1
    if (attempts > READY_RETRY_LIMIT) return finishJob(appendNote(mergeWork(shared, { guang_status: '失败' }), '等待光合发布器超时'))
    return nextPhase('wait_guang_page', 1000, { ...shared, page_ready_attempts: attempts })
  }

  if (phase === 'prepare_guang_upload') {
    const { job, index } = currentJob(shared)
    if (shared.guang_injected_job_index === index) return nextPhase('wait_guang_upload', 1000, shared)
    return injectFiles(
      [{ selector: 'input[type=file][name=file]', files: [job.video_path] }],
      'wait_guang_upload',
      1000,
      {
        ...shared,
        guang_injected_job_index: index,
        upload_attempts: 0,
        current_store: '光合视频上传中',
      },
    )
  }

  if (phase === 'wait_guang_upload') {
    const runtime = findPublishRuntime()
    const value = publishContent(runtime)
    if (value.videoStatus === 'success' && value.fileId) return nextPhase('prepare_guang_form', 0, shared)
    const attempts = Number(shared.upload_attempts || 0) + 1
    if (attempts > UPLOAD_RETRY_LIMIT) {
      return routeAfterGuang(appendNote(mergeWork(shared, { guang_status: '失败' }), `等待光合视频上传超时：${value.videoStatus || 'unknown'}`))
    }
    return nextPhase('wait_guang_upload', 1000, { ...shared, upload_attempts: attempts })
  }

  if (phase === 'prepare_guang_form') {
    const { job } = currentJob(shared)
    try {
      const runtime = findPublishRuntime()
      const config = publishConfig(runtime)
      const quota = config?.publishPerm?.extInfo || {}
      if (compact(quota.limit).toLowerCase() === 'true') throw new Error('光合发布额度已受限')
      if (Number(quota.publishCountMax || 0) > 0 && Number(quota.publishCountCur || 0) >= Number(quota.publishCountMax)) {
        throw new Error(`光合当日发布额度已用完：${quota.publishCountCur}/${quota.publishCountMax}`)
      }
      const prepared = await preparePublishForm(job, 'pc_newcreator_video')
      validatePublishReadback(job, prepared.readback, 'pc_newcreator_video')
      let state = mergeWork(shared, {
        guang_file_id: prepared.readback.fileId,
        guang_form_readback: prepared.readback,
      })
      for (const warning of prepared.readback.compliantResultList || []) {
        state = appendNote(state, `光合提示：${compact(warning.title || warning.subTitle)}`)
      }
      return nextPhase('publish_guang_api', 200, state)
    } catch (error) {
      const state = appendNote(mergeWork(shared, { guang_status: '失败' }), compact(error?.message || error))
      return routeAfterGuang(state)
    }
  }

  if (phase === 'publish_guang_api') {
    try {
      const { job } = currentJob(shared)
      validatePublishReadback(job, currentWork(shared).guang_form_readback || {}, 'pc_newcreator_video')
      const result = await publishPreparedContent('pc_newcreator_video')
      return routeAfterGuang(mergeWork(shared, {
        guang_status: '发布成功',
        guang_content_id: result.contentId,
        guang_receipt: result.receipt,
      }))
    } catch (error) {
      return routeAfterGuang(appendNote(mergeWork(shared, { guang_status: '失败' }), compact(error?.message || error)))
    }
  }

  if (phase === 'navigate_recommend') {
    if (publishPageReady('https://huodong.taobao.com/wow/z/guang/publish-feeds/videoPreview')) {
      return nextPhase('prepare_recommend_upload', 0, shared)
    }
    return navigateTo(RECOMMEND_URL, 'wait_recommend_page', shared, '进入千牛搜推素材视频发布器')
  }

  if (phase === 'wait_recommend_page') {
    if (loginExpired()) return routeAfterRecommend(appendNote(mergeWork(shared, { recommend_status: '失败' }), '千牛搜推素材登录已失效'))
    if (publishPageReady('https://huodong.taobao.com/wow/z/guang/publish-feeds/videoPreview')) {
      return nextPhase('prepare_recommend_upload', 0, shared)
    }
    const attempts = Number(shared.page_ready_attempts || 0) + 1
    if (attempts > READY_RETRY_LIMIT) return routeAfterRecommend(appendNote(mergeWork(shared, { recommend_status: '失败' }), '等待搜推素材发布器超时'))
    return nextPhase('wait_recommend_page', 1000, { ...shared, page_ready_attempts: attempts })
  }

  if (phase === 'prepare_recommend_upload') {
    const { job, index } = currentJob(shared)
    if (shared.recommend_injected_job_index === index) return nextPhase('wait_recommend_upload', 1000, shared)
    return injectFiles(
      [{ selector: 'input[type=file][name=file]', files: [job.video_path] }],
      'wait_recommend_upload',
      1000,
      {
        ...shared,
        recommend_injected_job_index: index,
        upload_attempts: 0,
        current_store: '搜推素材视频上传中',
      },
    )
  }

  if (phase === 'wait_recommend_upload') {
    const value = publishContent(findPublishRuntime())
    if (value.videoStatus === 'success' && value.fileId && value.compliantResult === 'success') {
      return nextPhase('prepare_recommend_form', 0, shared)
    }
    const attempts = Number(shared.upload_attempts || 0) + 1
    if (attempts > UPLOAD_RETRY_LIMIT) {
      return routeAfterRecommend(appendNote(mergeWork(shared, { recommend_status: '失败' }), `等待搜推视频合规检查超时：${value.videoStatus || 'unknown'}/${value.compliantResult || 'unknown'}`))
    }
    return nextPhase('wait_recommend_upload', 1000, { ...shared, upload_attempts: attempts })
  }

  if (phase === 'prepare_recommend_form') {
    const { job } = currentJob(shared)
    try {
      const prepared = await preparePublishForm(job, 'qn_material_manager')
      validatePublishReadback(job, prepared.readback, 'qn_material_manager')
      return nextPhase('publish_recommend_api', 200, mergeWork(shared, {
        recommend_file_id: prepared.readback.fileId,
        recommend_form_readback: prepared.readback,
      }))
    } catch (error) {
      return routeAfterRecommend(appendNote(mergeWork(shared, { recommend_status: '失败' }), compact(error?.message || error)))
    }
  }

  if (phase === 'publish_recommend_api') {
    try {
      const { job } = currentJob(shared)
      validatePublishReadback(job, currentWork(shared).recommend_form_readback || {}, 'qn_material_manager')
      const result = await publishPreparedContent('qn_material_manager')
      return routeAfterRecommend(mergeWork(shared, {
        recommend_status: '发布成功',
        recommend_content_id: result.contentId,
        recommend_receipt: result.receipt,
      }))
    } catch (error) {
      return routeAfterRecommend(appendNote(mergeWork(shared, { recommend_status: '失败' }), compact(error?.message || error)))
    }
  }

  if (phase === 'navigate_selector') {
    const { job } = currentJob(shared)
    const guangContentId = currentWork(shared).guang_content_id || job?.existing_content_id
    if (!guangContentId) {
      return finishJob(appendNote(mergeWork(shared, { product_status: '未执行' }), '没有光合内容ID，无法替换宝贝展示视频'))
    }
    if (selectorPageReady()) return nextPhase('query_video_record', 0, { ...shared, selector_attempts: 0 })
    return navigateTo(VIDEO_SELECTOR_URL, 'wait_selector_page', shared, '进入视频选择器读取光合视频')
  }

  if (phase === 'wait_selector_page') {
    if (loginExpired()) return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), '视频选择器登录已失效'))
    if (selectorPageReady()) return nextPhase('query_video_record', 0, { ...shared, selector_attempts: 0 })
    const attempts = Number(shared.page_ready_attempts || 0) + 1
    if (attempts > READY_RETRY_LIMIT) return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), '等待视频选择器超时'))
    return nextPhase('wait_selector_page', 1000, { ...shared, page_ready_attempts: attempts })
  }

  if (phase === 'query_video_record') {
    const { job } = currentJob(shared)
    const contentId = currentWork(shared).guang_content_id || job.existing_content_id
    try {
      const record = await queryVideoRecord(contentId)
      if (record) {
        return nextPhase('navigate_sell', 0, mergeWork(shared, {
          product_video_record: record,
          product_video_id: contentId,
        }))
      }
    } catch (error) {
      const attempts = Number(shared.selector_attempts || 0)
      if (attempts >= SELECTOR_RETRY_LIMIT) {
        return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), compact(error?.message || error)))
      }
    }
    const attempts = Number(shared.selector_attempts || 0) + 1
    if (attempts > SELECTOR_RETRY_LIMIT) {
      return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), `视频选择器未找到光合内容ID ${contentId}`))
    }
    return nextPhase('query_video_record', 2000, { ...shared, selector_attempts: attempts })
  }

  if (phase === 'navigate_sell') {
    const { job } = currentJob(shared)
    if (sellPageReady(job.item_id)) return nextPhase('bind_product_video', 0, shared)
    return navigateTo(`${SELL_EDIT_URL}?id=${encodeURIComponent(job.item_id)}`, 'wait_sell_page', shared, '进入商品编辑页')
  }

  if (phase === 'wait_sell_page') {
    const { job } = currentJob(shared)
    if (loginExpired()) return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), '商品编辑页登录已失效'))
    if (sellPageReady(job.item_id)) return nextPhase('bind_product_video', 0, shared)
    const attempts = Number(shared.page_ready_attempts || 0) + 1
    if (attempts > READY_RETRY_LIMIT) return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), '等待商品编辑页超时'))
    return nextPhase('wait_sell_page', 1000, { ...shared, page_ready_attempts: attempts })
  }

  if (phase === 'bind_product_video') {
    try {
      const record = currentWork(shared).product_video_record
      const bound = bindDisplayVideo(record)
      const expectedId = normalizeContentId(bound.displayVideo.videoId)
      const lectureKept = bound.lectureVideos.some(item => compact(item.videoType) === '宝贝讲解')
      const displayReadback = bound.readback.find(item => compact(item.videoType) === '宝贝展示')
      if (normalizeContentId(displayReadback?.videoId) !== expectedId) throw new Error('宝贝展示视频写入后读回不一致')
      if (!lectureKept) throw new Error('宝贝讲解视频未保留，已停止提交')
      return nextPhase('submit_product_api', 300, mergeWork(shared, {
        product_video_id: expectedId,
        product_pre_submit_readback: bound.readback,
      }))
    } catch (error) {
      return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), compact(error?.message || error)))
    }
  }

  if (phase === 'submit_product_api') {
    try {
      const result = await submitProductViaApi()
      return nextPhase('navigate_sell_readback', 1500, mergeWork(shared, {
        product_status: '已提交，待刷新读回',
        product_receipt: result.receipt,
      }))
    } catch (error) {
      return finishJob(appendNote(mergeWork(shared, { product_status: '失败' }), compact(error?.message || error)))
    }
  }

  if (phase === 'navigate_sell_readback') {
    const { job } = currentJob(shared)
    const url = `${SELL_EDIT_URL}?id=${encodeURIComponent(job.item_id)}`
    if (compact(location.href) !== url) location.href = url
    else location.reload()
    return nextPhase('wait_sell_readback', 1200, { ...shared, page_ready_attempts: 0 })
  }

  if (phase === 'wait_sell_readback') {
    const { job } = currentJob(shared)
    if (!sellPageReady(job.item_id)) {
      const attempts = Number(shared.page_ready_attempts || 0) + 1
      if (attempts > READY_RETRY_LIMIT) {
        return finishJob(appendNote(mergeWork(shared, { product_status: '读回失败' }), '商品提交后刷新页面超时'))
      }
      return nextPhase('wait_sell_readback', 1000, { ...shared, page_ready_attempts: attempts })
    }
    const videos = getSellComponentValue('auctionVideos') || []
    const expectedId = currentWork(shared).product_video_id
    const lecture = videos.find(item => compact(item.videoType) === '宝贝讲解')
    const display = videos.find(item => compact(item.videoType) === '宝贝展示')
    const passed = normalizeContentId(display?.videoId) === expectedId && Boolean(lecture)
    const state = mergeWork(shared, {
      product_status: passed ? '提交并刷新读回成功' : '提交后刷新读回不一致',
      refresh_readback: `宝贝讲解=${normalizeContentId(lecture?.videoId) || '缺失'}；宝贝展示=${normalizeContentId(display?.videoId) || '缺失'}`,
    })
    return finishJob(passed ? state : appendNote(state, '刷新后商品视频状态与预期不一致'))
  }

  return {
    success: false,
    error: `未知执行阶段：${phase}`,
    data: [...(shared.invalid_rows || []), ...(shared.results || [])],
  }
})()
