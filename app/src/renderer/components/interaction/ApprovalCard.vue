<template>
  <section class="cs-approval-card" :class="{ confirmed }" :aria-label="title">
    <header><strong>{{ title }}</strong><span v-if="confirmed" class="cs-approval-badge">✓ {{ confirmedLabel }}</span></header>
    <p v-if="summary" class="cs-approval-summary" aria-live="polite">{{ summary }}</p>
    <div class="cs-approval-content"><slot /></div>
    <footer v-if="$slots.actions"><slot name="actions" /></footer>
  </section>
</template>
<script setup>
defineProps({ title: String, summary: String, confirmed: Boolean, confirmedLabel: { type: String, default: '已保存' } })
</script>
<style scoped>
.cs-approval-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); color: var(--text); padding: 14px; min-width: 0; }.cs-approval-card header { display: flex; gap: 10px; align-items: center; justify-content: space-between; font-size: 13px; }.cs-approval-badge { color: var(--green, #458866); font-size: 12px; white-space: nowrap; }.cs-approval-summary { margin: 8px 0; font-size: 12px; color: var(--text2); line-height: 1.6; }.cs-approval-content { min-width: 0; }.cs-approval-card footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--border); }.confirmed { border-color: color-mix(in srgb, var(--green, #458866) 40%, var(--border)); }
</style>
