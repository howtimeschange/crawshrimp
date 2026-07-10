'use strict'

function normalizeCandidate(rawPath = '') {
  return String(rawPath || '').trim().replace(/\\/g, '/').toLowerCase()
}

function addCandidate(candidates, seen, rawPath = '') {
  const candidate = String(rawPath || '').trim()
  if (!candidate) return
  const key = normalizeCandidate(candidate)
  if (seen.has(key)) return
  seen.add(key)
  candidates.push(candidate)
}

function collectCrawshrimpDataDirCandidates(options = {}) {
  const candidates = []
  const seen = new Set()
  const platform = String(options.platform || process.platform)

  addCandidate(candidates, seen, options.primaryDataDir)
  if (platform === 'win32') {
    addCandidate(candidates, seen, options.legacyDataDir)
    addCandidate(candidates, seen, options.windowsLocalDataDir)
  } else if (platform === 'darwin') {
    addCandidate(candidates, seen, options.legacyDataDir)
    addCandidate(candidates, seen, options.macLocalDataDir)
  }

  return candidates
}

module.exports = {
  collectCrawshrimpDataDirCandidates,
}
