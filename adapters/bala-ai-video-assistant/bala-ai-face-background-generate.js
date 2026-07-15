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

  function normalizeOperationType(value) {
    const text = compact(value).toLowerCase()
    if (['background_swap', 'background', '换背景', 'ai换背景'].includes(text)) return 'background_swap'
    if (['outfit_swap', 'outfit', '换装', 'ai换装'].includes(text)) return 'outfit_swap'
    if (['pose_swap', 'pose', '换姿势', 'ai换姿势'].includes(text)) return 'pose_swap'
    return 'face_swap'
  }

  function operationLabel(operationType) {
    if (operationType === 'background_swap') return 'AI换背景'
    if (operationType === 'outfit_swap') return 'AI换装'
    if (operationType === 'pose_swap') return 'AI换姿势'
    return 'AI换脸'
  }

  function validationMessage(operationType, rawParams, modelRefIds, modelGroups) {
    if (operationType === 'face_swap' && !modelRefIds.length && !modelGroups.length) return '缺少模特素材'
    if (operationType === 'background_swap' && !compact(rawParams.background_prompt)) return '缺少背景Prompt'
    if (operationType === 'outfit_swap' && !stringList(rawParams.garment_images?.paths || rawParams.garment_images).length) return '缺少服装图'
    if (operationType === 'pose_swap' && !compact(rawParams.pose_prompt)) return '缺少姿势Prompt'
    return ''
  }

  function buildPlanRows(rawParams = params) {
    const operationType = normalizeOperationType(rawParams.operation_type)
    const sourceImages = normalizeSourceImagePaths(rawParams.source_images)
    const directoryFiles = normalizeDirectoryFiles(rawParams.material_root_files)
    const modelRefIds = normalizeModelRefIds(rawParams.model_ref_ids)
    const modelGroups = normalizeSelectedModelGroups(rawParams.model_groups)
    const backgroundPrompt = compact(rawParams.background_prompt)
    const garmentImages = stringList(rawParams.garment_images?.paths || rawParams.garment_images)
    const outfitReferenceImages = stringList(rawParams.outfit_reference_images?.paths || rawParams.outfit_reference_images)
    const variantReferenceImages = stringList(rawParams.variant_reference_images?.paths || rawParams.variant_reference_images)
    const posePrompt = compact(rawParams.pose_prompt)
    const validation = validationMessage(operationType, rawParams, modelRefIds, modelGroups)
    return [{
      '阶段': 'AI换图任务规划',
      '操作类型': operationLabel(operationType),
      '素材图片数': sourceImages.length || directoryFiles.length,
      '素材目录': compact(rawParams.material_root),
      '指定图片': sourceImages.join('\n'),
      '模特分组': modelGroups.join('、'),
      '指定模特图': modelRefIds.join('\n'),
      '背景Prompt': backgroundPrompt,
      '服装图文件': garmentImages.join('\n'),
      '搭配参考图文件': outfitReferenceImages.join('\n'),
      '同款不同色参考图文件': variantReferenceImages.join('\n'),
      '姿势Prompt': posePrompt,
      '补充要求': compact(rawParams.prompt_extra),
      '执行结果': validation || '待后端创建AI生图任务',
      '备注': '后端会在导出前扫描图片、匹配内置素材并创建AI生图任务',
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
      normalizeOperationType,
      operationLabel,
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
