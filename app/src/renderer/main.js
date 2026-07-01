import { createApp } from 'vue'
import App from './App.vue'
import { installDevCsBridge } from './utils/devCsBridge'

installDevCsBridge()

createApp(App).mount('#app')
