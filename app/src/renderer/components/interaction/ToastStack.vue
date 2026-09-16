<template>
  <Teleport to="body"><aside class="cs-toast-stack" aria-label="操作通知"><TransitionGroup name="cs-toast">
    <section v-for="item in interactionToasts" :key="item.id" class="cs-toast" :class="item.state" :role="item.state === 'error' ? 'alert' : 'status'">
      <span class="cs-toast-icon" aria-hidden="true">{{ item.state === 'pending' ? '◌' : item.state === 'success' ? '✓' : '!' }}</span>
      <div><strong>{{ item.title }}</strong><p v-if="item.detail">{{ item.detail }}</p><button v-if="item.action" type="button" @click="act(item)">{{ item.actionLabel }}</button></div>
      <button class="cs-toast-close" type="button" aria-label="关闭通知" @click="dismissToast(item.id)">×</button>
    </section>
  </TransitionGroup></aside></Teleport>
</template>
<script setup>
import { interactionToasts, dismissToast, notifyOperation } from '../../utils/interactionToasts'
async function act(item) { try { await item.action() } catch (error) { notifyOperation({ id: item.id, state: 'error', title: '无法打开', detail: error.message }) } }
</script>
<style scoped>
.cs-toast-stack { position: fixed; right: 20px; bottom: 20px; z-index: 2000; width: min(370px, calc(100vw - 40px)); display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-height: 70vh; overflow: auto; }.cs-toast { display: flex; align-items: flex-start; gap: 10px; padding: 13px 14px; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 6px 24px #0002; pointer-events: auto; font-size: 13px; }.cs-toast > div { flex: 1; min-width: 0; }.cs-toast p { margin: 5px 0; color: var(--text2); overflow-wrap: anywhere; }.cs-toast-icon { color: var(--orange); }.cs-toast.error .cs-toast-icon { color: var(--red, #dc5555); }.cs-toast button { border: 0; background: none; color: var(--orange); cursor: pointer; font: inherit; padding: 4px 0; }.cs-toast .cs-toast-close { color: var(--text2); padding: 0 3px; font-size: 18px; }.pending .cs-toast-icon { animation: spin 1s linear infinite; }.cs-toast-enter-active,.cs-toast-leave-active,.cs-toast-move { transition: opacity .18s, transform .18s; }.cs-toast-enter-from,.cs-toast-leave-to { opacity: 0; transform: translateY(8px); }@keyframes spin { to { transform: rotate(360deg); } }@media(prefers-reduced-motion:reduce) { * { animation: none !important; transition: none !important; } }
</style>
