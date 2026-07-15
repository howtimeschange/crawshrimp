<template>
  <div v-if="modelValue" class="bala-model-modal" @click.self="close">
    <section class="bala-model-dialog" role="dialog" aria-modal="true" aria-label="选择 AI 模特素材">
      <header class="bala-model-head">
        <div>
          <strong>选择 AI 模特素材</strong>
          <span>已选 {{ selectedModelIds.length }} 张</span>
        </div>
        <button type="button" class="bala-icon-button" aria-label="关闭" @click="close">×</button>
      </header>

      <div class="bala-model-toolbar">
        <div class="bala-age-rail" aria-label="年龄分类">
          <button
            v-for="age in ageOptions"
            :key="age"
            type="button"
            :class="{ selected: filters.age_label === age }"
            @click="setAge(age)"
          >
            {{ age || '全部' }}
          </button>
        </div>

        <div class="bala-model-filters">
          <div class="bala-segmented" aria-label="性别">
            <button
              v-for="gender in genderOptions"
              :key="gender"
              type="button"
              :class="{ selected: filters.gender === gender }"
              @click="setGender(gender)"
            >
              {{ gender || '全部' }}
            </button>
          </div>
          <div class="bala-group-chips" aria-label="模特分组">
            <button
              v-for="group in groupOptions"
              :key="group"
              type="button"
              :class="{ selected: filters.group === group }"
              @click="setGroup(group)"
            >
              {{ group || '全部' }}
            </button>
          </div>
          <input
            v-model="filters.search"
            class="bala-model-search"
            placeholder="搜索表情 / 文件名，例如 标准、侧脸、微笑"
            @input="scheduleLoad"
          />
        </div>
      </div>

      <div v-if="error" class="bala-model-state error">{{ error }}</div>
      <div v-else-if="loading" class="bala-model-state">正在读取模特素材...</div>
      <div v-else class="bala-model-grid">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          :class="['bala-model-tile', { selected: selectedModelIds.includes(item.id) }]"
          @click="toggleModel(item)"
        >
          <img :src="modelImageSrc(item)" :alt="item.expression || item.filename || item.id" loading="lazy" />
          <span class="bala-model-check">{{ selectedModelIds.includes(item.id) ? '已选' : '选择' }}</span>
          <strong>{{ item.expression || item.filename || item.id }}</strong>
          <span>{{ item.group_label || item.group }} · {{ item.width || '-' }}×{{ item.height || '-' }}</span>
        </button>
        <div v-if="!items.length" class="bala-model-state">没有匹配的模特素材</div>
      </div>

      <footer class="bala-model-foot">
        <div class="bala-selected-strip">
          <span v-if="!selectedModelIds.length">还未选择模特</span>
          <span v-for="item in selectedModelItems" :key="item.id">{{ item.group_label || item.group }} / {{ item.expression || item.filename }}</span>
        </div>
        <button type="button" class="bala-secondary" @click="clearSelection">清空</button>
        <button type="button" class="bala-primary" :disabled="!selectedModelIds.length" @click="confirmSelection">
          确认选择
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialSelectedIds: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const ageOptions = ['', '新生儿', '婴童', '幼童', '中大童']
const genderOptions = ['', '通用', '女', '男']
const groupOptions = ['', '66', '73女', '73男', '100女', '100男', '140女', '140男']

const filters = reactive({
  age_label: '',
  gender: '',
  group: '',
  search: '',
})
const items = ref([])
const selectedModelIds = ref([])
const selectedItemMap = reactive(new Map())
const loading = ref(false)
const error = ref('')
let loadTimer = null

const selectedModelItems = computed(() =>
  selectedModelIds.value.map(id => selectedItemMap.get(id)).filter(Boolean)
)

watch(() => props.modelValue, (open) => {
  if (!open) return
  selectedModelIds.value = Array.from(new Set((props.initialSelectedIds || []).map(item => String(item || '').trim()).filter(Boolean)))
  void loadModels()
})

function apiBase() {
  return String(window.cs?.getApiBase?.() || '').replace(/\/+$/, '')
}

function modelImageSrc(item) {
  const url = String(item?.image_url || '').trim()
  if (/^https?:\/\//i.test(url)) return url
  return `${apiBase()}${url.startsWith('/') ? '' : '/'}${url}`
}

function close() {
  emit('update:modelValue', false)
}

function setAge(age) {
  filters.age_label = age
  filters.group = ''
  void loadModels()
}

function setGender(gender) {
  filters.gender = gender
  filters.group = ''
  void loadModels()
}

function setGroup(group) {
  filters.group = group
  void loadModels()
}

function scheduleLoad() {
  window.clearTimeout(loadTimer)
  loadTimer = window.setTimeout(() => void loadModels(), 180)
}

async function loadModels() {
  if (!props.modelValue) return
  loading.value = true
  error.value = ''
  try {
    const payload = await window.cs.listBalaModelLibrary({
      age_label: filters.age_label,
      gender: filters.gender,
      group: filters.group,
      search: filters.search,
    })
    const nextItems = Array.isArray(payload?.items) ? payload.items : []
    items.value = nextItems
    for (const item of nextItems) {
      if (item?.id) selectedItemMap.set(String(item.id), item)
    }
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function toggleModel(item) {
  const id = String(item?.id || '').trim()
  if (!id) return
  selectedItemMap.set(id, item)
  if (selectedModelIds.value.includes(id)) {
    selectedModelIds.value = selectedModelIds.value.filter(itemId => itemId !== id)
  } else {
    selectedModelIds.value = [...selectedModelIds.value, id]
  }
}

function clearSelection() {
  selectedModelIds.value = []
}

function confirmSelection() {
  emit('confirm', {
    selectedModelIds: [...selectedModelIds.value],
    selectedModelItems: selectedModelItems.value,
  })
  close()
}
</script>

<style scoped>
.bala-model-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.42);
}

.bala-model-dialog {
  width: min(980px, 92vw);
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  background: #f8fafc;
  border-left: 1px solid #cbd5e1;
  box-shadow: -24px 0 48px rgba(15, 23, 42, 0.16);
}

.bala-model-head,
.bala-model-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.bala-model-head {
  justify-content: space-between;
}

.bala-model-head div,
.bala-model-tile {
  display: grid;
  gap: 4px;
}

.bala-model-head strong {
  font-size: 16px;
}

.bala-model-head span,
.bala-model-tile span,
.bala-selected-strip {
  font-size: 12px;
  color: #64748b;
}

.bala-icon-button,
.bala-secondary,
.bala-primary,
.bala-age-rail button,
.bala-segmented button,
.bala-group-chips button {
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
}

.bala-icon-button {
  width: 32px;
  font-size: 18px;
}

.bala-model-toolbar {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid #e2e8f0;
}

.bala-age-rail,
.bala-model-filters,
.bala-group-chips,
.bala-segmented {
  display: flex;
  gap: 8px;
}

.bala-age-rail {
  flex-direction: column;
}

.bala-model-filters {
  flex-direction: column;
}

.bala-group-chips,
.bala-segmented {
  flex-wrap: wrap;
}

.bala-age-rail button.selected,
.bala-segmented button.selected,
.bala-group-chips button.selected,
.bala-model-tile.selected {
  border-color: #0f766e;
  background: #ccfbf1;
  color: #115e59;
}

.bala-model-search {
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 10px;
  background: #ffffff;
}

.bala-model-grid {
  overflow: auto;
  padding: 16px 18px 22px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  align-content: start;
  gap: 12px;
}

.bala-model-tile {
  position: relative;
  padding: 8px;
  text-align: left;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.bala-model-tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 6px;
  background: #e2e8f0;
}

.bala-model-check {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #ffffff !important;
}

.bala-model-foot {
  border-top: 1px solid #e2e8f0;
  border-bottom: 0;
}

.bala-selected-strip {
  flex: 1;
  display: flex;
  gap: 8px;
  overflow: hidden;
}

.bala-selected-strip span {
  white-space: nowrap;
}

.bala-secondary,
.bala-primary {
  padding: 0 14px;
}

.bala-primary {
  border-color: #0f766e;
  background: #0f766e;
  color: #ffffff;
}

.bala-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bala-model-state {
  padding: 18px;
  color: #64748b;
}

.bala-model-state.error {
  color: #b91c1c;
}
</style>
