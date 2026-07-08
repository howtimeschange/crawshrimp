<template>
  <section class="aiw-workbench aiw-option-3">
    <header class="aiw-topbar">
      <div>
        <p class="aiw-kicker">AI 生图</p>
        <h2>本地 1XM 图片模型工作台</h2>
        <p class="aiw-subtitle">支持主图、参考图、Prompt、自定义尺寸和多模型生成</p>
      </div>
      <button class="aiw-ghost" type="button" @click="emit('open-settings')">去设置 1XM Key</button>
    </header>

    <div class="aiw-param-ribbon" aria-label="生成参数">
      <label>
        <span>模型</span>
        <select>
          <option>GPT Image 2K</option>
          <option>GPT Image 4K</option>
          <option>Gemini 3.1 Flash Image Preview</option>
          <option>Gemini 3 Pro Image Preview</option>
        </select>
      </label>
      <label>
        <span>比例</span>
        <select>
          <option>1:1</option>
          <option>4:5</option>
          <option>3:4</option>
        </select>
      </label>
      <label>
        <span>张数</span>
        <input type="number" min="1" max="8" value="4" />
      </label>
      <label>
        <span>风格</span>
        <select>
          <option>电商白底</option>
          <option>生活方式</option>
          <option>详情页场景</option>
        </select>
      </label>
    </div>

    <div class="aiw-main-grid">
      <aside class="aiw-prompt-panel">
        <div class="aiw-panel-head">
          <span>提示词</span>
          <button type="button">导入商品</button>
        </div>
        <textarea placeholder="描述商品、卖点、模特姿态、背景和禁用元素..."></textarea>
        <div class="aiw-chip-row">
          <button type="button">白底主图</button>
          <button type="button">儿童外套</button>
          <button type="button">材质细节</button>
        </div>
      </aside>

      <main class="aiw-results-grid" aria-label="生成结果">
        <article v-for="item in placeholders" :key="item" class="aiw-result-card">
          <div class="aiw-result-preview">{{ item }}</div>
          <footer>
            <span>待生成</span>
            <button type="button">选择</button>
          </footer>
        </article>
      </main>

      <aside class="aiw-history-drawer">
        <div class="aiw-panel-head">
          <span>历史</span>
          <button type="button">筛选</button>
        </div>
        <ol>
          <li>
            <strong>商品主图批次</strong>
            <span>4 张 · 待接入</span>
          </li>
          <li>
            <strong>详情页场景批次</strong>
            <span>6 张 · 待接入</span>
          </li>
        </ol>
      </aside>
    </div>

    <footer class="aiw-generate-footer">
      <div>
        <strong>本地生成队列</strong>
        <span>默认输出文件夹：~/Downloads/抓虾导出/AI生图；Windows：%USERPROFILE%\Downloads\抓虾导出\AI生图</span>
      </div>
      <button type="button" disabled>开始生成</button>
    </footer>
  </section>
</template>

<script setup>
const emit = defineEmits(['open-settings'])
const placeholders = ['A', 'B', 'C', 'D']
</script>

<style scoped>
.aiw-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 18px 20px;
  background: #121316;
  color: var(--text);
}

.aiw-topbar,
.aiw-param-ribbon,
.aiw-prompt-panel,
.aiw-results-grid,
.aiw-history-drawer,
.aiw-generate-footer {
  border: 1px solid var(--border);
  background: var(--bg2);
}

.aiw-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border-radius: 8px;
}

.aiw-kicker {
  margin: 0 0 6px;
  color: var(--orange);
  font-size: 12px;
  font-weight: 800;
}

.aiw-topbar h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.aiw-subtitle {
  margin: 7px 0 0;
  color: var(--text2);
  line-height: 1.5;
}

.aiw-param-ribbon {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) repeat(3, minmax(120px, 0.8fr));
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
}

.aiw-param-ribbon label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.aiw-param-ribbon span,
.aiw-panel-head,
.aiw-generate-footer span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-param-ribbon select,
.aiw-param-ribbon input,
.aiw-prompt-panel textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}

.aiw-param-ribbon select,
.aiw-param-ribbon input {
  height: 36px;
  padding: 0 10px;
}

.aiw-main-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(420px, 1.5fr) minmax(220px, 0.7fr);
  gap: 14px;
}

.aiw-prompt-panel,
.aiw-history-drawer {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
}

.aiw-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiw-prompt-panel textarea {
  flex: 1;
  min-height: 260px;
  resize: none;
  padding: 12px;
  line-height: 1.6;
}

.aiw-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.aiw-results-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
  overflow: auto;
  border-radius: 8px;
}

.aiw-result-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.aiw-result-preview {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text3);
  font-size: 34px;
  font-weight: 800;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%),
    #17181d;
  background-size: 22px 22px;
}

.aiw-result-card footer,
.aiw-generate-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiw-result-card footer {
  padding: 10px;
}

.aiw-history-drawer ol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.aiw-history-drawer li {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiw-generate-footer {
  padding: 12px 14px;
  border-radius: 8px;
}

.aiw-generate-footer div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  font: inherit;
  font-weight: 700;
  padding: 8px 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.aiw-ghost {
  flex: 0 0 auto;
  border-color: rgba(255, 107, 43, 0.35);
  background: rgba(255, 107, 43, 0.1);
  color: var(--orange);
}

@media (max-width: 1100px) {
  .aiw-param-ribbon,
  .aiw-main-grid,
  .aiw-results-grid {
    grid-template-columns: 1fr;
  }

  .aiw-topbar,
  .aiw-generate-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
