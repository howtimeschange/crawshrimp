# 🦐 抓虾 · crawshrimp

> 通用网页自动化底座 — 安装适配包，启动即用

## 是什么

抓虾是一个桌面应用底座（Electron + Python），核心能力：

- 通过 **Chrome DevTools Protocol（CDP）** 直连用户已登录的浏览器
- 向目标页面注入 **JS 脚本**，提取数据 / 执行操作
- 提供 **插件化适配包**（Adapter）机制：每个平台一个包，底座负责加载、调度、导出
- 内置 **Vue 前端 GUI**：平台管理 / 任务面板 / 数据查看 / 设置

## 快速开始

```bash
git clone https://github.com/howtimeschange/crawshrimp
cd crawshrimp

# 安装 Python 依赖
cd core && pip install -r requirements.txt

# 启动 Python Core
python api_server.py

# 另开终端，启动 Electron
cd ../app && npm install && npm start
```

## 目录结构

```
crawshrimp/
├── core/              # Python 底座（FastAPI + CDP + 调度 + 导出）
├── app/               # Electron 前端（Vue 3 + Vite）
├── adapters/          # 内置示例适配包
│   └── temu/          # Temu 商家助手
├── sdk/               # 适配包开发工具 & 规范文档
└── .github/workflows/ # CI/CD
```

## 开发适配包

见 [sdk/ADAPTER_GUIDE.md](sdk/ADAPTER_GUIDE.md)

## 相关项目

- [temu-assistant](https://github.com/howtimeschange/temu-assistant) — 抓虾的前身，Temu 专用版
