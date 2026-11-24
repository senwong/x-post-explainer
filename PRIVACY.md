# Privacy Policy — Tweet Slang Explainer (X 推文俚语解析助手)

**Last Updated:** November 24, 2026

## 1. Overview
Tweet Slang Explainer ("the Extension") is a browser extension that helps users understand English slang, memes, idioms, and context in posts on X (Twitter) using an AI API configured by the user.

## 2. Data Collection and Storage
- **No Developer Backend:** The Extension does **not** operate any developer-owned server and does **not** collect, store, sell, or transmit your personal data, browsing history, or analytics to the developer.
- **Local Configuration Only:** Your API Base URL, API Key, model name, and prompt preferences are stored exclusively in your browser's local storage (`chrome.storage.local`).

## 3. Data Sent to Third-Party AI Providers
- Data is **only** transmitted when you explicitly click the **"解析" (Explain)** button on a post or send a follow-up question in the side drawer.
- When triggered, the Extension sends the selected post's text, optional thread/quoted post context, and optional post images directly from your browser to the OpenAI-compatible API endpoint that **you** configured (e.g., Google Gemini, OpenAI, DeepSeek, OpenRouter, or a custom endpoint).
- Your use of any third-party AI provider is governed by that provider's own privacy policy.

## 4. Permissions Justification
- `storage`: Saves your local API settings and preferences.
- `host_permissions` / `optional_host_permissions`: Used solely to fetch post images (`pbs.twimg.com`) for multimodal explanation and to send API requests to your configured AI endpoint.

## 5. Contact
If you have any questions about this Privacy Policy, please contact the developer via the Chrome Web Store support page.
