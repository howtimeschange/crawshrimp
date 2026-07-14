;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function stringList(value) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,，、;；]+/)
    return source.map(compact).filter(Boolean)
  }

  function normalizeSourceImagePaths(sourceImages) {
    const paths = sourceImages && typeof sourceImages === 'object' ? sourceImages.paths : sourceImages
    return stringList(paths)
  }

  function normalizeDirectoryFiles(value) {
    const source = Array.isArray(value?.paths) ? value.paths : (Array.isArray(value) ? value : [])
    return source
      .map(item => {
        if (typeof item === 'string') return { path: compact(item), relativePath: '' }
        return {
          path: compact(item?.path),
          relativePath: compact(item?.relativePath || item?.relative_path),
        }
      })
      .filter(item => item.path)
  }

  function normalizeSelectedModelGroups(value) {
    return stringList(value)
  }

  function normalizeModelRefIds(value) {
    return stringList(value)
  }

  function buildPlanRows(rawParams = params) {
    const sourceImages = normalizeSourceImagePaths(rawParams.source_images)
    const directoryFiles = normalizeDirectoryFiles(rawParams.material_root_files)
    const modelRefIds = normalizeModelRefIds(rawParams.model_ref_ids)
    const modelGroups = normalizeSelectedModelGroups(rawParams.model_groups)
    const backgroundPrompt = compact(rawParams.background_prompt)
    return [{
      '阶段': 'AI换脸换背景任务规划',
      '素材图片数': sourceImages.length || directoryFiles.length,
      '素材目录': compact(rawParams.material_root),
      '指定图片': sourceImages.join('\n'),
      '模特分组': modelGroups.join('、'),
      '指定模特图': modelRefIds.join('\n'),
      '背景Prompt': backgroundPrompt,
      '执行结果': backgroundPrompt ? '待后端创建AI生图任务' : '缺少背景Prompt',
      '备注': '后端会在导出前扫描图片、匹配内置模特库并创建AI生图任务',
    }]
  }

  function complete(data = [], meta = {}) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        ...meta,
      },
    }
  }

  if (testExports) {
    Object.assign(testExports, {
      stringList,
      normalizeSourceImagePaths,
      normalizeDirectoryFiles,
      normalizeSelectedModelGroups,
      normalizeModelRefIds,
      buildPlanRows,
    })
  }

  try {
    if (phase === '__exports__') return complete([])
    return complete(buildPlanRows(params))
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
    }
  }
})()
