# Tweet Slang Explainer (X 推文俚语解析助手)

一个轻量、零依赖的 Manifest V3 浏览器扩展：在 X (Twitter) 每条推文下方注入「✦ 解析」按钮，一键在右侧抽屉里调用你自己的 AI 接口，结合完整上下文与配图，用自然中文拆解英文推文里的俚语、网络热梗、文化背景和常见错别字，并支持多轮追问。

## ✨ 核心功能
- **一键解析推文**：自动拆解英语俚语、网络热词、反讽语气、双关梗与老外常见拼写错误。
- **完整上下文抓取**：自动附带引用的推文（Quote Tweet）、回复链父帖、链接卡片与推文配图（支持多模态视觉模型）。
- **侧边栏流式展示 & 多轮追问**：Shadow DOM 样式隔离，自动适配 X 深色/浅色主题；支持流式 Markdown 输出、快捷追问标签与按推文缓存会话历史。
- **通用 OpenAI 兼容接口（BYOK）**：内置 **Gemini / OpenAI / DeepSeek / OpenRouter / 本地 Ollama** 一键预设，支持任意兼容中转站地址与自定义系统提示词。
- **隐私安全**：无开发者后端，API Key 仅保存在本地 `chrome.storage.local`；详见 [PRIVACY.md](./PRIVACY.md)。

## 🚀 本地安装（开发者模式）
1. 克隆本仓库：
   ```bash
   git clone https://github.com/senwong/x-post-explainer.git
   ```
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启右上角 **开发者模式**。
3. 点击 **加载解压缩的扩展**，选择本项目目录。
4. 点击扩展图标填入你的 API Key 并点击「测试连接」→「保存设置」，即可在 `x.com` 上使用。

## 📄 隐私政策
见 [PRIVACY.md](./PRIVACY.md)。
