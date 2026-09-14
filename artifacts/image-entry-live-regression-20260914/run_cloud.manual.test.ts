// Manual opt-in real-network regression. Never part of ordinary CI.
import { test } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createAndPollOneXmImageTask } from '../worker/one-xm-image'
import type { Env } from '../worker/env'
const enabled = process.env.CRAWSHRIMP_REAL_IMAGE_REGRESSION === '1'
test.skipIf(!enabled)('manual: cloud executor with real Woka and Semir models', async () => {
 const root='/Users/xingyicheng/Documents/crawshrimp/artifacts/image-entry-live-regression-20260914'
 const cfg=JSON.parse(readFileSync('/tmp/crawshrimp-entry-live-regression-20260914/config.json','utf8')).ai
 const env={WOKA_IMAGE_API_KEY:cfg.woka.api_key,SEMIR_IMAGE_GPT_API_KEY:cfg.semir.gpt_api_key,SEMIR_IMAGE_GEMINI_API_KEY:cfg.semir.gemini_api_key} as Env
 const secrets=Object.values(env).filter(Boolean) as string[]
 const image='data:image/png;base64,'+readFileSync('/tmp/crawshrimp-entry-live-regression-20260914/fixture-shirt.png').toString('base64')
 for(const provider of ['woka','semir']) for(const model of ['gpt-image-2','gemini-3.1-flash-image-preview','gemini-3-pro-image-preview']) for(const editing of [false,true]) {
  const id=`cloud-direct-${editing?'edit':'single'}--${provider}--${model}`, report=`${root}/${id}.json`
  if(existsSync(report))continue
  const started=Date.now();let record: Record<string,unknown>
  try {
   const result=await createAndPollOneXmImageTask(env,{model:`${provider}/${model}`,prompt:editing?'Create a realistic product photograph of this blue T-shirt on a white background. No people or text.':'A blue ceramic mug on a white table, realistic product photograph, no text.',imageDataUrls:editing?[image]:[],size:'1:1',quality:model.startsWith('gemini')?'1K':'low',outputFormat:'png',count:1})
   if(result.status!=='completed')throw new Error(`Unexpected status ${result.status}`)
   mkdirSync(`/tmp/crawshrimp-entry-live-regression-20260914/cloud-outputs`,{recursive:true})
   const files=result.dataUrls.map((url,i)=>{const bytes=Buffer.from(url.split(',')[1],'base64');const path=`/tmp/crawshrimp-entry-live-regression-20260914/cloud-outputs/${id}-${i}.png`;writeFileSync(path,bytes);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})
   record={ok:files.length===1,files}
  }catch(e){let message=String(e);for(const secret of secrets)message=message.split(secret).join('[redacted]');record={ok:false,error:message.slice(0,600)}}
  record={...record,surface:`cloud-direct-${editing?'edit':'single'}`,model:`${provider}/${model}`,seconds:Math.round((Date.now()-started)/10)/100,execution:'actual Worker generation function, actual fetch; local Node runtime, not deployed Worker/UI'}
  writeFileSync(report,JSON.stringify(record,null,2));console.log(JSON.stringify({surface:record.surface,model:record.model,ok:record.ok,seconds:record.seconds}))
 }
}, 3600000)
