const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {scanDirectory}=require('../../app/src/directoryScanWorker')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'crawshrimp-fixed-scan-'))
;(async()=>{try{
 for(let i=0;i<20000;i++)fs.writeFileSync(path.join(root,`file-${i}.jpg`),'x')
 let ticks=0,maxGap=0,last=performance.now();const start=last
 const timer=setInterval(()=>{ticks++;const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now},5)
 const result=await scanDirectory(root,{maxFiles:20000})
 clearInterval(timer)
 console.log(JSON.stringify({platform:process.platform,count:result.paths.length,elapsedMs:performance.now()-start,ticks,maxGapMs:maxGap}))
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
