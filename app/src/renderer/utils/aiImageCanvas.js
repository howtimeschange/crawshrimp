function nextNodeId(nodes) {
  return `node-${String((nodes || []).length + 1).padStart(3, '0')}`
}

export function createCanvasDocument({ title = 'AI 生图画布', jobUid = '', nodes = [] } = {}) {
  return {
    version: 1,
    title,
    job_uid: jobUid,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.isArray(nodes) ? nodes : [],
  }
}

export function insertImageNode(document, image, options = {}) {
  const current = document && typeof document === 'object' ? document : createCanvasDocument()
  const nodes = Array.isArray(current.nodes) ? current.nodes : []
  const index = nodes.length
  const node = {
    id: image.id || nextNodeId(nodes),
    type: 'image',
    label: image.label || image.path || image.url || `图片 ${index + 1}`,
    path: image.path || '',
    url: image.url || '',
    source: image.source || 'result',
    role: image.role || 'reference',
    selected: Boolean(image.selected),
    x: Number.isFinite(image.x) ? image.x : 40 + (index % 4) * 280,
    y: Number.isFinite(image.y) ? image.y : 40 + Math.floor(index / 4) * 300,
    size: {
      width: Number.isFinite(image.width) ? image.width : 240,
      height: Number.isFinite(image.height) ? image.height : 240,
    },
    meta: image.meta && typeof image.meta === 'object' ? image.meta : {},
  }
  return {
    ...current,
    nodes: [...nodes, { ...node, ...options }],
  }
}

export function selectedNodesAsReferences(document) {
  const nodes = Array.isArray(document?.nodes) ? document.nodes : []
  return nodes
    .filter((node) => node && node.selected && node.type === 'image' && String(node.path || '').trim())
    .sort((left, right) => {
      const leftY = Number.isFinite(left.y) ? left.y : 0
      const rightY = Number.isFinite(right.y) ? right.y : 0
      if (leftY !== rightY) return leftY - rightY
      const leftX = Number.isFinite(left.x) ? left.x : 0
      const rightX = Number.isFinite(right.x) ? right.x : 0
      return leftX - rightX
    })
    .map((node) => node.path)
}
