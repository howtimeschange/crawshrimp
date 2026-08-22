import { normalizePromptLibrary } from './localPromptLibrary.js'

export async function loadLocalPromptLibraryViewSources({
  listLocalPromptLibraries,
  loadCloudLibraries,
  loadCloudOnInit = false,
  onLocalReady,
} = {}) {
  if (typeof listLocalPromptLibraries !== 'function') {
    throw new Error('listLocalPromptLibraries is required')
  }
  if (typeof loadCloudLibraries !== 'function') {
    throw new Error('loadCloudLibraries is required')
  }

  const payload = await listLocalPromptLibraries()
  const localLibraries = (Array.isArray(payload?.libraries) ? payload.libraries : [])
    .map(library => normalizePromptLibrary({ ...library, source_type: 'local' }))

  if (typeof onLocalReady === 'function') {
    await onLocalReady(localLibraries)
  }

  const cloudRefresh = loadCloudOnInit
    ? Promise.resolve()
      .then(() => loadCloudLibraries({ silent: true }))
      .then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error }),
      )
    : Promise.resolve({ ok: true, skipped: true })
  return { localLibraries, cloudRefresh }
}
