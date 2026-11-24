const DEFAULT_SYSTEM_PROMPT = `你是一位精通英语母语表达、欧美互联网文化、科技/AI圈热梗与地道俚语的双语解析助手。

# 背景
用户是中文母语者，浏览 X (Twitter) 英文帖子时，单个单词往往认识，但组合在一起因为俚语、双关、文化梗、反讽、上下文或老外手快打出的错别字，导致看不懂真实意思。

# 输出要求（用自然地道的中文回答）
1. **💡 核心意思**：先用一两句大白话直接说清楚这条帖子的真实意思、语气（吐槽/反讽/玩梗/吃瓜/夸赞等）和笑点。
2. **🔍 词组、俚语与梗拆解**：逐一拆解其中的俚语、习惯用法、网络缩写、双关、文化背景或老外常见拼写/语法错误（如果有的话，还原正确写法）。
3. **🧩 结合上下文与配图**（如有父帖、引用帖或配图）：说明它和原帖/引用帖/图片之间的关系，把前因后果讲透。

如果用户后续针对某一句或某个词追问，请直接、简洁、精准地解答，不用重复完整模板。`;

const DEFAULT_CONFIG = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: '',
  model: 'gemini-2.5-flash',
  includeImages: true,
  includeContext: true,
  theme: 'system',
  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

function getChatCompletionsUrl(baseUrl) {
  const clean = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

async function imageUrlToDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = await resp.arrayBuffer();
    // Skip overly large images (> 4MB)
    if (buffer.byteLength > 4 * 1024 * 1024) return null;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn('[X-Explainer] Failed to fetch image:', url, err);
    return null;
  }
}

async function prepareMessages(rawMessages, includeImages) {
  const prepared = [];
  for (const msg of rawMessages) {
    if (!includeImages || !msg.images || msg.images.length === 0) {
      prepared.push({ role: msg.role, content: msg.content });
      continue;
    }

    const parts = [{ type: 'text', text: msg.content }];
    const imageUrls = msg.images.slice(0, 4); // Limit to 4 images
    const dataUrls = await Promise.all(imageUrls.map((u) => imageUrlToDataUrl(u)));
    for (const dataUrl of dataUrls) {
      if (dataUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: dataUrl }
        });
      }
    }
    prepared.push({
      role: msg.role,
      content: parts.length > 1 ? parts : msg.content
    });
  }
  return prepared;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'get-config') {
    getConfig().then((config) => sendResponse({ config }));
    return true;
  }

  if (message?.type === 'test-connection') {
    (async () => {
      const start = Date.now();
      try {
        const { baseUrl, apiKey, model } = message.payload;
        const url = getChatCompletionsUrl(baseUrl);
        if (!url) throw new Error('Base URL 不能为空');
        if (!model) throw new Error('Model 不能为空');

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model.trim(),
            messages: [{ role: 'user', content: 'Hi, reply with OK only.' }],
            max_tokens: 16
          })
        });

        const text = await resp.text();
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
        }
        const data = JSON.parse(text);
        const reply = data?.choices?.[0]?.message?.content || 'OK';
        sendResponse({
          ok: true,
          latencyMs: Date.now() - start,
          reply: reply.trim().slice(0, 80)
        });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err?.message || String(err)
        });
      }
    })();
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'x-explainer-stream') return;

  let controller = null;

  port.onDisconnect.addListener(() => {
    if (controller) {
      controller.abort();
      controller = null;
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'abort') {
      if (controller) {
        controller.abort();
        controller = null;
      }
      return;
    }

    if (msg.type !== 'chat') return;

    if (controller) {
      controller.abort();
    }
    controller = new AbortController();

    try {
      const config = await getConfig();
      const url = getChatCompletionsUrl(config.baseUrl);
      if (!url || !config.model) {
        port.postMessage({
          type: 'error',
          code: 'NO_CONFIG',
          error: '请先在插件设置中配置 API Base URL、API Key 和模型名称。'
        });
        return;
      }

      const apiKey = (config.apiKey || '').trim();
      const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)/i.test(url);
      if (!apiKey && !isLocal) {
        port.postMessage({
          type: 'error',
          code: 'NO_CONFIG',
          error: '尚未配置 API Key，请点击右上角设置按钮填写。'
        });
        return;
      }

      const systemPrompt = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT).trim();
      const userMessages = await prepareMessages(msg.messages || [], config.includeImages);
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...userMessages
      ];

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model.trim(),
          messages: apiMessages,
          stream: true,
          temperature: 0.4
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let detail = errText.slice(0, 400);
        try {
          const parsed = JSON.parse(errText);
          detail = parsed?.error?.message || parsed?.message || detail;
        } catch (_) {}
        port.postMessage({
          type: 'error',
          error: `请求失败 (HTTP ${resp.status})：${detail}`
        });
        return;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') && !resp.body) {
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || '';
        if (content) port.postMessage({ type: 'chunk', content });
        port.postMessage({ type: 'done' });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedAny = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
            port.postMessage({ type: 'done' });
            return;
          }
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                receivedAny = true;
                port.postMessage({ type: 'chunk', content: delta });
              }
            } catch (_) {
              // Ignore partial or malformed SSE JSON chunks
            }
          }
        }
      }

      // Fallback if server returned non-SSE JSON body despite stream: true
      if (!receivedAny && buffer.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const content = parsed?.choices?.[0]?.message?.content || '';
          if (content) port.postMessage({ type: 'chunk', content });
        } catch (_) {}
      }

      port.postMessage({ type: 'done' });
    } catch (err) {
      if (err?.name === 'AbortError') {
        port.postMessage({ type: 'aborted' });
      } else {
        port.postMessage({
          type: 'error',
          error: `网络或接口错误：${err?.message || String(err)}`
        });
      }
    } finally {
      controller = null;
    }
  });
});
