const {app,BrowserWindow,session}=require('electron')
const path=require('node:path'),fs=require('node:fs')
app.setPath('userData',path.join(__dirname,'user-data-fixed'))
app.on('window-all-closed',()=>{})
app.commandLine.appendSwitch('disable-renderer-backgrounding')
setTimeout(()=>app.exit(2),120000).unref()
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}))
 for(const rate of [1,4]) {
  const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{backgroundThrottling:false}})
  await win.loadURL('about:blank');win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate',{rate})
  await win.loadFile(path.join(__dirname,'dist/index.html'),{query:{count:'5000'}})
  while(!(await win.webContents.executeJavaScript('Boolean(window.probe?.ready)'))) await new Promise(r=>setTimeout(r,100))
  console.log(JSON.stringify({rate,...await win.webContents.executeJavaScript(`(async()=>{
    await new Promise(r=>setTimeout(r,1500));const before=window.probe.storageWrites.length,measurements=[];
    for(let i=0;i<30;i++){measurements.push((await window.runInteraction()).toggleMs);await new Promise(r=>setTimeout(r,200))}
    await new Promise(r=>setTimeout(r,1500));
    const writes=window.probe.storageWrites.length-before;measurements.sort((a,b)=>a-b);
    await window.runInteraction();window.dispatchEvent(new Event('beforeunload'));
    const saved=JSON.parse(localStorage.getItem('crawshrimp.bala-ai-video.workspace-state.v2'));
    const styles=saved.workspaces['/virtual-review-workspace'].image.styles;
    return {p95:measurements[28],median:measurements[14],max:measurements[29],writes,errors:window.probe.errors,savedSelected:styles.flatMap(s=>s.modelPhotos).filter(a=>a.selected).length,selected:document.querySelectorAll('.aiv-thumb.selected').length}
  })()`) }));
  console.log(JSON.stringify({rate,scenario:'save-failure',...await win.webContents.executeJavaScript(`(async()=>{
    const original = Storage.prototype.setItem;
    const cs = window.cs;
    Storage.prototype.setItem = function(){throw new Error('injected storage failure')};
    window.cs = new Proxy(cs,{get(target,name){if(name==='writeBalaWorkspaceManifest')return async()=>{throw new Error('injected manifest failure')};return target[name]}});
    await window.runInteraction();await new Promise(r=>setTimeout(r,1500));
    const error=document.querySelector('.aiv-workspace-persistence-error')?.textContent || '';
    Storage.prototype.setItem=original;window.cs=cs;
    return {error,visible:Boolean(error)};
  })()`)}));win.destroy()
 }
 app.exit(0)
}).catch(e=>{console.error(e);app.exit(1)})
