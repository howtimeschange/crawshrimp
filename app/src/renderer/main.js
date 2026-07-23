import { createApp } from 'vue'
import App from './App.vue'
import { installDevCsBridge } from './utils/devCsBridge'
import { applyTheme, readThemePreference } from './utils/theme.mjs'

installDevCsBridge()

const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)')
applyTheme(readThemePreference(window.localStorage), {
  documentRef: document,
  systemPrefersDark: Boolean(systemThemeMedia?.matches),
})

createApp(App).mount('#app')
