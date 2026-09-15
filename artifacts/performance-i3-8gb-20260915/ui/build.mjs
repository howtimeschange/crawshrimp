import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import {build} from '/Users/xingyicheng/Documents/crawshrimp/app/node_modules/vite/dist/node/index.js'
import vue from '/Users/xingyicheng/Documents/crawshrimp/app/node_modules/@vitejs/plugin-vue/dist/index.mjs'
await build({ configFile:false, root:realpathSync(fileURLToPath(new URL('.', import.meta.url))), base:'./', plugins:[vue()], resolve:{alias:{vue:'/Users/xingyicheng/Documents/crawshrimp/app/node_modules/vue/dist/vue.esm-bundler.js'}}, build:{outDir:'dist',emptyOutDir:true} })
