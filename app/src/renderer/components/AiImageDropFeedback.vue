<template>
  <p class="input-capacity">{{ capacity.label }} {{ capacity.count }} 张 · 合计 {{ capacity.total }}/10 · 还可添加 {{ capacity.remaining }} 张<span v-if="capacity.count > 1"> · 拖动图片排序</span></p>
  <div v-if="active || busy" class="drop-overlay" :class="{ full: !capacity.remaining }" role="status">
    <div class="drop-notice">
      <strong>{{ busy ? '正在导入图片…' : capacity.remaining ? `松手添加到${capacity.label}` : '已达上限，请先移除图片' }}</strong>
      <span>{{ capacity.label }} {{ capacity.count }}/{{ capacity.limit }} 张 · 合计 {{ capacity.total }}/10 张</span>
      <span>{{ busy ? '正在检查文件并保存' : `还可添加 ${capacity.remaining} 张 · 单张不超过 20 MB` }}</span>
    </div>
  </div>
</template>
<script setup>
defineProps({ capacity: { type: Object, required: true }, active: Boolean, busy: Boolean })
</script>
<style scoped>
.input-capacity { margin: 8px 0; color: var(--text2); font-size: 12px; line-height: 1.6; }
.drop-overlay { position: absolute; inset: 0; z-index: 5; border: 2px dashed var(--orange, #ff7026); border-radius: 8px; background: color-mix(in srgb, var(--bg) 90%, transparent); padding: 10px; pointer-events: none; }
.drop-notice { position: sticky; top: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 6px; border-radius: 6px; background: var(--bg); box-shadow: 0 4px 20px #0002; text-align: center; }
.drop-notice strong { color: var(--orange, #ff7026); font-size: 16px; }
.drop-notice span { color: var(--text2); font-size: 12px; line-height: 1.5; }
.full { border-style: solid; }
</style>
