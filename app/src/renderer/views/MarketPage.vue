<template>
  <div class="view">
    <div class="market-hero">
      <div class="market-logo">🏪</div>
      <h2>抓虾市场</h2>
      <p>发现和分享社区适配脚本，一键安装，即刻抓取</p>
      <div class="coming-soon">即将开放</div>
    </div>
    <div class="feature-list">
      <div class="feature-item">
        <span class="f-icon">🔍</span>
        <div>
          <strong>搜索脚本</strong>
          <p>按平台、类别搜索社区贡献的抓取脚本</p>
        </div>
      </div>
      <div class="feature-item">
        <span class="f-icon">⭐</span>
        <div>
          <strong>评分与评价</strong>
          <p>查看脚本质量评分，选择稳定可靠的版本</p>
        </div>
      </div>
      <div class="feature-item">
        <span class="f-icon">🔄</span>
        <div>
          <strong>自动更新</strong>
          <p>脚本版本更新时自动提示，一键升级</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; padding: 40px; }
.market-hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.market-logo { font-size: 56px; }
.market-hero h2 { font-size: 24px; font-weight: 800; color: var(--text); }
.market-hero p { font-size: 14px; color: var(--text2); }
.coming-soon { padding: 6px 20px; border-radius: 20px; background: var(--orange-bg); color: var(--orange); font-size: 12px; font-weight: 700; border: 1px solid var(--orange); }
.feature-list { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; max-width: 600px; }
.feature-item { display: flex; gap: 14px; align-items: flex-start; background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; width: 180px; }
.f-icon { font-size: 22px; }
.feature-item strong { display: block; font-size: 13px; color: var(--text); margin-bottom: 4px; }
.feature-item p { font-size: 11px; color: var(--text3); line-height: 1.5; }
</style>
