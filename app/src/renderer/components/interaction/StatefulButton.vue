<template>
  <button :type="type" class="cs-stateful" :class="`is-${state}`" :disabled="disabled || state === 'pending'" :aria-busy="state === 'pending'" :aria-label="state === 'pending' ? pendingLabel : state === 'success' ? successLabel : state === 'error' ? errorLabel : undefined" @click="$emit('click', $event)">
    <span class="cs-stateful-idle" :class="{ hidden: state !== 'idle' }"><slot /></span>
    <span class="cs-stateful-reserve" aria-hidden="true"><span>{{ pendingLabel }}</span><span>{{ successLabel }}</span><span>{{ errorLabel }}</span></span>
    <span v-if="state !== 'idle'" class="cs-stateful-feedback" role="status"><i v-if="state === 'pending'" class="cs-small-spinner" aria-hidden="true" /><span v-else aria-hidden="true">{{ state === 'success' ? '✓' : '!' }}</span>{{ state === 'pending' ? pendingLabel : state === 'success' ? successLabel : errorLabel }}</span>
  </button>
</template>
<script setup>
defineProps({ state: { type: String, default: 'idle' }, disabled: Boolean, type: { type: String, default: 'button' }, pendingLabel: { type: String, default: '处理中…' }, successLabel: { type: String, default: '已完成' }, errorLabel: { type: String, default: '重试' } })
defineEmits(['click'])
</script>
<style scoped>
.cs-stateful { position: relative; display: inline-grid; place-items: center; min-width: 108px; min-height: 34px; padding: 7px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg3); color: var(--text); font: inherit; cursor: pointer; transition: opacity .16s, transform .16s; }
.cs-stateful:active:not(:disabled) { transform: translateY(1px); }.cs-stateful:disabled { cursor: default; opacity: .65; }.cs-stateful-idle, .cs-stateful-feedback { grid-area: 1/1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; }.cs-stateful-reserve { display: grid; grid-area: 1/1; visibility: hidden; padding-left: 18px; }.cs-stateful-reserve > span { grid-area: 1/1; }.hidden { visibility: hidden; }.cs-stateful-feedback { animation: appear .16s ease-out; }.cs-stateful:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }.cs-small-spinner { width: 12px; height: 12px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }@keyframes appear { from { opacity: 0; transform: translateY(2px); } }@media(prefers-reduced-motion:reduce) { *, *::before { animation: none !important; transition: none !important; } }
</style>
