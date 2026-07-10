export function createPromptLibraryRequestGuard() {
  let sequence = 0
  let currentKey = ''

  return {
    begin(key) {
      currentKey = String(key || '')
      sequence += 1
      return sequence
    },
    isCurrent(token, key) {
      return token === sequence && String(key || '') === currentKey
    },
    invalidate() {
      currentKey = ''
      sequence += 1
    },
  }
}
