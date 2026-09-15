import { createApp, nextTick } from 'vue'
import Workflow from '/Users/xingyicheng/Documents/crawshrimp/app/src/renderer/views/AiVideoWorkflow.vue'
const count = Number(new URLSearchParams(location.search).get('count') || 1875)
const workspace = '/virtual-review-workspace'
const groups = [], files = []
for (let i = 0; i < count; i++) {
  const groupIndex = Math.floor(i / 175)
  const styleCode = String(208326100000 + groupIndex)
  if (!groups[groupIndex]) groups[groupIndex] = { styleCode, modelPhotos: [], detailPhotos: [], otherPhotos: [] }
  const asset = { id: `photo-${i}`, path: `${workspace}/${styleCode}/01_模拍原图/photo-${i}.jpg`, name: `photo-${i}.jpg`, filename: `photo-${i}.jpg`, contentHash: i.toString(16).padStart(64,'0'), fileVersion: '1', selected: false, editSelected: false, versions: [] }
  groups[groupIndex].modelPhotos.push(asset)
  files.push({ ...asset, styleCode, sourceType: 'model', version: '1' })
}
localStorage.clear()
localStorage.setItem('crawshrimp.bala-ai-video.workspace-dir', workspace)
localStorage.setItem('crawshrimp.bala-ai-video.workspace-state.v2', JSON.stringify({ version: 2, activeWorkspace: workspace, workspaces: { [workspace]: { workspaceDir: workspace, activeStep: 'materials', input: { activeMaterialStyleCode: groups[0].styleCode }, material: { task: {status:'idle'} }, image: {styles: groups}, video: {} } } }))
window.probe = { count, longTasks: [], storageWrites: [], calls: {}, errors: [] }
new PerformanceObserver(list => window.probe.longTasks.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration})))).observe({type:'longtask',buffered:true})
const setItem = Storage.prototype.setItem
Storage.prototype.setItem = function(key, value) { const start = performance.now(); const result = setItem.call(this,key,value); window.probe.storageWrites.push({key,bytes:value.length,ms:performance.now()-start}); return result }
window.cs = new Proxy({}, { get(_, name) {
  if (name === 'getApiBase') return () => ''
  if (/^on/.test(name)) return () => () => {}
  return async (...args) => {
    window.probe.calls[name] = (window.probe.calls[name] || 0) + 1
    if (name === 'readBalaWorkspaceManifest') return null
    if (name === 'writeBalaWorkspaceManifest') return {ok:true}
    if (name === 'listBalaWorkspaceImages') return files
    if (name === 'listBalaWorkspaceVideos') return []
    if (name === 'getTaskStatus') return {}
    if (name === 'getSettings') return {}
    if (/Thumbnail|Preview/.test(name)) return {ok:true,data_url:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}
    if (/^delete/.test(name)) return {ok:true}
    return []
  }
} })
const app = createApp(Workflow)
app.config.errorHandler = e => window.probe.errors.push(String(e.stack || e))
const start = performance.now()
app.mount('#app')
await nextTick()
window.probe.mountMs = performance.now() - start
await new Promise(resolve => setTimeout(resolve, 100))
window.probe.ready = true
window.runInteraction = async () => {
  const begin = performance.now()
  document.querySelector('.aiv-thumb')?.click()
  await nextTick()
  const toggleMs = performance.now() - begin
  return {toggleMs, count: document.querySelectorAll('.aiv-thumb').length, selected: document.querySelectorAll('.aiv-thumb.selected').length, error: document.querySelector('.aiv-workspace-persistence-error')?.textContent}
}
window.unmountProbe = () => app.unmount()
