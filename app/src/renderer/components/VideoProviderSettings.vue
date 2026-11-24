<template>
  <div class="model-provider-settings">
    <div class="model-provider-toolbar"><p>按服务商管理视频生成连接。生成凭据与素材上传凭据独立保存。</p></div>
    <div class="model-provider-list" aria-label="视频模型服务商列表">
      <article v-for="provider in providers" :key="provider.id" class="model-provider-row">
        <div class="model-provider-content">
          <button
            type="button"
            class="model-provider-logo video-brand-logo"
            :aria-label="'编辑 ' + provider.name"
            @click="openEditor(provider.id, $event)"
          >
            <img :src="provider.logo" :alt="provider.logoAlt" />
          </button>
          <div class="model-provider-main">
            <div class="model-provider-heading">
              <h4>{{ provider.name }}</h4>
              <span :class="['model-provider-status', { ready: configured(provider) }]">{{
                configured(provider) ? '已配 Key' : '未配 Key'
              }}</span
              ><span class="model-provider-tag">视频生成</span>
            </div>
            <p class="model-provider-endpoint">
              {{
                configured(provider)
                  ? '连接已保存，可在编辑中更新'
                  : defaults[provider.endpoint]
                    ? '默认地址：'
                    : '请在编辑中选择服务地址'
              }}<code v-if="!configured(provider)">{{ defaults[provider.endpoint] }}</code>
            </p>
            <div class="model-provider-models">
              <span v-for="model in provider.models" :key="model">{{ model }}</span>
            </div>
          </div>
        </div>
        <div class="model-provider-actions">
          <small>视频生成服务</small
          ><button
            type="button"
            :aria-label="'编辑 ' + provider.name + ' 连接'"
            @click="openEditor(provider.id, $event)"
          >
            编辑
          </button>
        </div>
      </article>
    </div>
    <section class="model-provider-auxiliary" aria-labelledby="video-upload-section">
      <h4 id="video-upload-section">素材上传</h4>
      <div class="model-provider-list">
        <article class="model-provider-row">
          <div class="model-provider-content">
            <span class="model-provider-logo" aria-hidden="true">OSS</span>
            <div class="model-provider-main">
              <div class="model-provider-heading">
                <h4>百炼 OSS 上传</h4>
                <span :class="['model-provider-status', { ready: configured(upload) }]">{{
                  configured(upload) ? '已配 Key' : '未配 Key'
                }}</span
                ><span class="model-provider-tag">辅助服务</span>
              </div>
              <p class="model-provider-endpoint">仅用于将本地图片或视频上传为临时素材地址。</p>
            </div>
          </div>
          <div class="model-provider-actions">
            <small>本地素材</small
            ><button type="button" aria-label="编辑百炼 OSS 上传" @click="openEditor('upload', $event)">
              编辑
            </button>
          </div>
        </article>
      </div>
    </section>
    <p class="model-provider-note">
      密钥仅保存在本机。留空保留已保存的配置；新配置 Seedance 时需选择或填写服务地址。
    </p>
    <p v-if="notice" class="model-provider-note" role="status">{{ notice }}</p>
    <dialog
      ref="dialog"
      class="model-config-dialog video-provider-dialog"
      :aria-labelledby="dialogTitle"
      @cancel.prevent="closeEditor"
      @keydown.tab="trapDialogFocus($event, dialog)"
      @click="onBackdrop"
      @close="clearEditor"
    >
      <form v-if="selected" @submit.prevent="saveEditor">
        <header class="model-config-header">
          <div>
            <p>{{ selected.id === 'upload' ? '素材上传 · 连接配置' : '视频模型 · 连接配置' }}</p>
            <h3 :id="dialogTitle">{{ selected.name }}</h3>
          </div>
          <button type="button" :disabled="saving" aria-label="关闭视频服务商编辑" @click="closeEditor">
            关闭
          </button>
        </header>
        <div class="model-config-body">
          <p class="help">{{ selected.description }}</p>
          <div v-if="selected.id === 'seedance'" class="video-field">
            <label for="seedance-route">选择服务地址</label
            ><select id="seedance-route" @change="draft['ai.video.seedance_base_url'] = $event.target.value">
              <option value="">请选择或手动填写</option>
              <option value="https://ark.cn-beijing.volces.com">火山方舟</option>
              <option value="https://ai-aigw.semir.com/doubao-seedance/api/v3">森马网关</option>
            </select>
          </div>
          <div v-for="field in selected.fields" :key="field.key" class="video-field">
            <label :for="field.key">{{ field.label }}</label
            ><input
              :id="field.key"
              v-model="draft[field.key]"
              :type="field.secret ? 'password' : field.url ? 'url' : 'text'"
              :aria-describedby="defaults[field.key] ? field.key + '-default' : undefined"
              autocomplete="new-password"
              :placeholder="field.secret ? '填写新密钥以替换' : defaults[field.key] || '可选，留空保留当前配置'"
            />
            <p v-if="defaults[field.key]" :id="field.key + '-default'" class="help video-default">
              {{ field.url ? '默认地址' : '默认值' }}：<code>{{ defaults[field.key] }}</code>
            </p>
          </div>
          <p class="help">只保存当前服务的非空配置。已有密钥不会回显或被空白覆盖。</p>
          <p v-if="error" class="video-editor-error" role="alert">{{ error }}</p>
        </div>
        <footer class="model-config-footer">
          <button type="button" :disabled="saving" @click="closeEditor">取消</button
          ><button type="submit" class="primary" :disabled="saving">
            {{ saving ? '保存中…' : '保存服务商' }}
          </button>
        </footer>
      </form>
    </dialog>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { trapDialogFocus } from '../utils/dialogAccessibility.mjs'
import seedLogoUrl from '../assets/llm-providers/bytedance-seed.ico'
import bailianLogoUrl from '../assets/llm-providers/aliyun-bailian.png'
import {
  AI_VIDEO_CONNECTION_DEFAULTS,
  buildWriteOnlyAiVideoPatch,
  isAiVideoCredentialConfigured,
} from '../utils/aiVideoSettings.mjs'
const props = defineProps({ config: { type: Object, required: true }, save: { type: Function, required: true } })
const defaults = { ...AI_VIDEO_CONNECTION_DEFAULTS, 'ai.video.seedance_base_url': '' }
const providers = [
  {
    id: 'seedance',
    name: 'Seedance',
    logo: seedLogoUrl,
    logoAlt: 'ByteDance Seed（Seedance）',
    credential: 'ai.video.seedance_api_key',
    endpoint: 'ai.video.seedance_base_url',
    models: ['Seedance 2.5 / Flash', 'Seedance 2.0 / Fast / Mini'],
    description: '选择火山方舟、森马网关，或填写兼容服务地址；现有配置留空时保持不变。',
    fields: [
      { key: 'ai.video.seedance_api_key', label: 'API Key', secret: true },
      { key: 'ai.video.seedance_base_url', label: '服务地址（新配置必填）', url: true },
    ],
  },
  {
    id: 'bailian',
    name: '阿里云百炼',
    logo: bailianLogoUrl,
    logoAlt: '阿里云百炼',
    credential: 'ai.video.bailian_api_key',
    endpoint: 'ai.video.bailian_base_url',
    models: ['HappyHorse', 'Kling', 'PixVerse'],
    description: '视频生成使用这组凭据。业务空间与区域为可选配置，素材上传使用独立凭据。',
    fields: [
      { key: 'ai.video.bailian_api_key', label: 'API Key', secret: true },
      { key: 'ai.video.bailian_base_url', label: '服务地址（可选）', url: true },
      { key: 'ai.video.bailian_workspace_id', label: '业务空间 ID（可选）' },
      { key: 'ai.video.bailian_region', label: '区域（可选）' },
    ],
  },
]
const upload = {
  id: 'upload',
  name: '百炼 OSS 上传',
  credential: 'ai.video.bailian_upload_api_key',
  description: '仅用于上传本地素材，不参与视频生成请求。上传后得到百炼可读取的临时素材地址。',
  fields: [
    { key: 'ai.video.bailian_upload_api_key', label: '上传 API Key', secret: true },
    { key: 'ai.video.bailian_uploads_url', label: '上传服务地址（可选）', url: true },
  ],
}
const dialog = ref(null),
  editor = ref(''),
  draft = ref({}),
  saving = ref(false),
  error = ref(''),
  notice = ref('')
const dialogTitle = `video-provider-${useId()}`
const selected = computed(() => [...providers, upload].find((item) => item.id === editor.value))
const configured = (provider) => isAiVideoCredentialConfigured(props.config, provider.credential)
let restoreFocus,
  alive = true
async function openEditor(id, event) {
  if (saving.value) return
  const provider = [...providers, upload].find((item) => item.id === id)
  if (!provider) return
  restoreFocus = event?.currentTarget || (typeof document === 'undefined' ? null : document.activeElement)
  editor.value = id
  error.value = ''
  draft.value = Object.fromEntries(
    provider.fields.map((field) => [field.key, field.secret ? '' : props.config[field.key] || '']),
  )
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
}
function clearEditor() {
  draft.value = {}
  editor.value = ''
  error.value = ''
  restoreFocus?.focus?.()
}
function closeEditor() {
  if (saving.value) return
  dialog.value?.close()
  clearEditor()
}
function onBackdrop(event) {
  if (event.target === dialog.value) closeEditor()
}
async function saveEditor() {
  if (saving.value || !selected.value) return
  saving.value = true
  error.value = ''
  const name = selected.value.name
  try {
    const patch = buildWriteOnlyAiVideoPatch(draft.value)
    if (
      selected.value.id === 'seedance' &&
      patch['ai.video.seedance_api_key'] &&
      !configured(selected.value) &&
      !patch['ai.video.seedance_base_url']
    ) {
      error.value = '请先选择或填写 Seedance 服务地址。'
      return
    }
    if (
      selected.value.id === 'bailian' &&
      !configured(selected.value) &&
      patch['ai.video.bailian_api_key'] &&
      !patch['ai.video.bailian_base_url'] &&
      !patch['ai.video.bailian_workspace_id'] &&
      !patch['ai.video.bailian_region']
    ) {
      patch['ai.video.bailian_base_url'] = defaults['ai.video.bailian_base_url']
    }
    if (Object.keys(patch).length) await props.save(patch)
    if (!alive) return
    notice.value = Object.keys(patch).length ? `${name} 已保存` : '没有需要更新的配置'
    saving.value = false
    closeEditor()
  } catch (e) {
    if (alive) error.value = e?.message || '保存失败，请重试'
  } finally {
    if (alive) saving.value = false
  }
}
onBeforeUnmount(() => {
  alive = false
  draft.value = {}
  restoreFocus = null
})
</script>
<style scoped>
.model-provider-logo.video-brand-logo {
  background: #fff;
}
.video-brand-logo img {
  max-width: 66px;
  max-height: 28px;
  object-fit: contain;
}
.video-provider-dialog form {
  display: flex;
  flex-direction: column;
  max-height: min(780px, calc(100vh - 40px));
}
.video-provider-dialog .model-config-body {
  flex: 1;
}
.video-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.video-default code {
  font: inherit;
  overflow-wrap: anywhere;
  user-select: text;
}
.video-editor-error {
  margin: 0;
  color: var(--red);
  font-size: 12px;
  line-height: 1.6;
}
</style>
<style scoped src="../styles/modelProviders.css"></style>
