<template>
  <section v-if="items.length" class="cs-import-queue" aria-label="素材导入队列" aria-live="polite">
    <header><strong>素材导入</strong><span>{{ items.filter(item => item.state === 'success').length }}/{{ items.length }} 已就绪</span></header>
    <ul><li v-for="item in items" :key="item.id" :class="item.state"><span class="cs-import-mark" aria-hidden="true">{{ item.state === 'success' ? '✓' : item.state === 'error' ? '!' : '·' }}</span><div><strong :title="item.name">{{ item.name }}</strong><small>{{ item.error || (item.state === 'pending' ? '正在读取与校验…' : item.state === 'queued' ? '等待处理' : item.state === 'success' ? '已导入' : '未导入') }}</small></div><button v-if="item.state === 'error'" type="button" :disabled="busy" @click="$emit('retry', item)">重试</button><button v-if="!['queued','pending'].includes(item.state)" type="button" :disabled="busy" :aria-label="`移除导入记录 ${item.name}`" title="移除这条导入记录" @click="$emit('remove', item)">×</button></li></ul>
  </section>
</template>
<script setup>
defineProps({ items: { type: Array, default: () => [] }, busy: Boolean })
defineEmits(['retry', 'remove'])
</script>
<style scoped>
.cs-import-queue { margin: 10px 0; padding: 10px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12px; }.cs-import-queue header { display: flex; justify-content: space-between; gap: 8px; }.cs-import-queue header span { color: var(--text2); }.cs-import-queue ul { margin: 8px 0 0; padding: 0; list-style: none; max-height: 220px; overflow: auto; }.cs-import-queue li { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); }.cs-import-queue li > div { flex: 1; min-width: 0; }.cs-import-queue li strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }.cs-import-queue small { display: block; color: var(--text2); margin-top: 3px; overflow-wrap: anywhere; }.cs-import-mark { width: 16px; text-align: center; color: var(--orange); }.success .cs-import-mark { color: var(--green, #458866); }.error .cs-import-mark { color: var(--red, #d85f5f); }.cs-import-queue button { color: var(--text2); background: none; border: 0; font: inherit; cursor: pointer; padding: 5px; }.cs-import-queue button:disabled { opacity: .4; cursor: default; }
</style>
