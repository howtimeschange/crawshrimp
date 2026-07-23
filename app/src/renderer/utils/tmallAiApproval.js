function stringList(value) {
  const source = Array.isArray(value) ? value : []
  return Array.from(new Set(source.map(item => String(item || '').trim()).filter(Boolean)))
}

export function isCustomReferencePrompt(name) {
  const text = String(name || '').trim()
  return text.includes('创意拍') || text.includes('组合拍')
}

export function applyCustomReferenceDefaults(prompts, customReferencePaths) {
  const customPaths = stringList(customReferencePaths)
  return (Array.isArray(prompts) ? prompts : []).map(prompt => {
    if (
      !prompt
      || prompt.reference_binding_mode === 'manual'
      || !isCustomReferencePrompt(prompt.prompt_name || prompt.name)
    ) {
      return prompt
    }
    return {
      ...prompt,
      reference_binding_mode: 'automatic',
      use_custom_references: customPaths.length > 0,
      reference_paths: stringList([...(prompt.reference_paths || []), ...customPaths]),
    }
  })
}

export function markPromptReferenceSelection(prompt, referencePaths) {
  const paths = stringList(referencePaths)
  return {
    ...(prompt || {}),
    reference_binding_mode: 'manual',
    use_custom_references: paths.length > 0,
    reference_paths: paths,
  }
}

export function restorePromptReferencePaths(prompt, mainPath, referenceAssets) {
  const main = String(mainPath || '').trim()
  const promptPaths = stringList(prompt?.reference_paths)
  const bindingMode = String(prompt?.reference_binding_mode || '').trim()
  if (bindingMode === 'automatic' || bindingMode === 'manual') {
    return stringList([main, ...promptPaths])
  }
  const selectedLegacyPaths = new Set(
    (Array.isArray(referenceAssets) ? referenceAssets : [])
      .filter(asset => asset?.use_for_generation)
      .map(asset => String(asset?.path || '').trim())
      .filter(Boolean),
  )
  return stringList([
    main,
    ...promptPaths.filter(path => path !== main && selectedLegacyPaths.has(path)),
  ])
}

export function removeReferencePathFromPrompts(prompts, referencePath) {
  const removedPath = String(referencePath || '').trim()
  return (Array.isArray(prompts) ? prompts : []).map(prompt => {
    const referencePaths = stringList(prompt?.reference_paths).filter(path => path !== removedPath)
    return {
      ...(prompt || {}),
      reference_paths: referencePaths,
      use_custom_references: referencePaths.length > 0 && Boolean(prompt?.use_custom_references),
    }
  })
}
