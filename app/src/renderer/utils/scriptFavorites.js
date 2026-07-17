function favoriteTime(value) {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

export function partitionScriptGroups(groups = [], favorites = {}) {
  const favoriteMap = favorites && typeof favorites === 'object' ? favorites : {}
  const records = (Array.isArray(groups) ? groups : []).map((group, index) => ({ group, index }))
  const isFavorite = group => Object.prototype.hasOwnProperty.call(favoriteMap, group?.adapter_id)
  const favoriteRecords = records.filter(({ group }) => isFavorite(group))

  favoriteRecords.sort((left, right) =>
    favoriteTime(favoriteMap[right.group.adapter_id]) - favoriteTime(favoriteMap[left.group.adapter_id]) ||
    left.index - right.index)

  return {
    favorites: favoriteRecords.map(({ group }) => group),
    scripts: records.filter(({ group }) => !isFavorite(group)).map(({ group }) => group),
  }
}
