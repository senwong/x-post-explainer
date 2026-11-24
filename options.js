const DEFAULT_SYSTEM_PROMPT = `你是一位精通英语母语表达、欧美互联网文化、科技/AI圈热梗与地道俚语的双语解析助手。

# 背景
用户是中文母语者，浏览 X (Twitter) 英文帖子时，单个单词往往认识，但组合在一起因为俚语、双关、文化梗、反讽、上下文或老外手快打出的错别字，导致看不懂真实意思。

# 输出要求（用自然地道的中文回答）
1. **💡 核心意思**：先用一两句大白话直接说清楚这条帖子的真实意思、语气（吐槽/反讽/玩梗/吃瓜/夸赞等）和笑点。
2. **🔍 词组、俚语与梗拆解**：逐一拆解其中的俚语、习惯用法、网络缩写、双关、文化背景或老外常见拼写/语法错误（如果有的话，还原正确写法）。
3. **🧩 结合上下文与配图**（如有父帖、引用帖或配图）：说明它和原帖/引用帖/图片之间的关系，把前因后果讲透。

如果用户后续针对某一句或某个词追问，请直接、简洁、精准地解答，不用重复完整模板。`;

const PRESETS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    includeImages: true
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    includeImages: true
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    includeImages: false
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    includeImages: true
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    includeImages: false
  }
};

const els = {
  form: document.getElementById('settingsForm'),
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  toggleKeyBtn: document.getElementById('toggleKeyBtn'),
  model: document.getElementById('model'),
  themeButtons: Array.from(document.querySelectorAll('#themeSegmented .seg-btn')),
  includeContext: document.getElementById('includeContext'),
  includeImages: document.getElementById('includeImages'),
  systemPrompt: document.getElementById('systemPrompt'),
  resetPromptBtn: document.getElementById('resetPromptBtn'),
  testBtn: document.getElementById('testBtn'),
  statusBox: document.getElementById('statusBox')
};

const systemDarkMq = window.matchMedia('(prefers-color-scheme: dark)');
let currentTheme = 'system';

function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemDarkMq.matches ? 'dark' : 'light';
}

function applyTheme(mode) {
  currentTheme = mode || 'system';
  const effective = resolveTheme(currentTheme);
  document.documentElement.setAttribute('data-theme', effective);
  els.themeButtons.forEach((btn) => {
    const active = btn.getAttribute('data-theme') === currentTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

systemDarkMq.addEventListener('change', () => {
  if (currentTheme === 'system') applyTheme('system');
});

els.themeButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.getAttribute('data-theme') || 'system';
    applyTheme(mode);
    await chrome.storage.local.set({ theme: mode });
  });
});

function showStatus(text, type = 'info') {
  els.statusBox.textContent = text;
  els.statusBox.className = `status ${type}`;
}

async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ type: 'get-config' });
  const cfg = resp?.config || {};
  els.baseUrl.value = cfg.baseUrl || PRESETS.gemini.baseUrl;
  els.apiKey.value = cfg.apiKey || '';
  els.model.value = cfg.model || PRESETS.gemini.model;
  applyTheme(cfg.theme || 'system');
  els.includeContext.checked = cfg.includeContext !== false;
  els.includeImages.checked = cfg.includeImages !== false;
  els.systemPrompt.value = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-preset');
    const preset = PRESETS[key];
    if (!preset) return;
    els.baseUrl.value = preset.baseUrl;
    els.model.value = preset.model;
    els.includeImages.checked = preset.includeImages;
    showStatus(`已填充 ${btn.textContent} 预设，请确认 API Key 后保存。`, 'info');
  });
});

els.toggleKeyBtn.addEventListener('click', () => {
  const isPwd = els.apiKey.type === 'password';
  els.apiKey.type = isPwd ? 'text' : 'password';
  els.toggleKeyBtn.textContent = isPwd ? '隐藏' : '显示';
});

els.resetPromptBtn.addEventListener('click', () => {
  els.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  showStatus('已恢复默认系统提示词（点击保存后生效）。', 'info');
});

function getOriginPattern(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}/*`;
  } catch (_) {
    return null;
  }
}

async function ensureHostPermission(rawUrl) {
  const originPattern = getOriginPattern(rawUrl);
  if (!originPattern) return { ok: false, error: 'Base URL 格式不正确，请以 https:// 或 http:// 开头。' };
  try {
    const has = await chrome.permissions.contains({ origins: [originPattern] });
    if (has) return { ok: true };
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      return { ok: false, error: `未授予访问 ${originPattern} 的权限，请在浏览器弹窗中允许后重试。` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `申请域名权限失败：${err?.message || String(err)}` };
  }
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const baseUrl = els.baseUrl.value.trim();
  const perm = await ensureHostPermission(baseUrl);
  if (!perm.ok) {
    showStatus(perm.error, 'error');
    return;
  }

  const payload = {
    baseUrl,
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    theme: currentTheme,
    includeContext: els.includeContext.checked,
    includeImages: els.includeImages.checked,
    systemPrompt: els.systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT
  };
  await chrome.storage.local.set(payload);
  showStatus('设置已保存！现在去 X (Twitter) 点击推文旁的「解析」即可使用。', 'success');
});

els.testBtn.addEventListener('click', async () => {
  const baseUrl = els.baseUrl.value.trim();
  const perm = await ensureHostPermission(baseUrl);
  if (!perm.ok) {
    showStatus(perm.error, 'error');
    return;
  }

  showStatus('正在测试 API 连接...', 'info');
  els.testBtn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'test-connection',
      payload: {
        baseUrl,
        apiKey: els.apiKey.value.trim(),
        model: els.model.value.trim()
      }
    });
    if (resp?.ok) {
      showStatus(`连接成功！（耗时 ${resp.latencyMs}ms，返回：${resp.reply}）`, 'success');
    } else {
      showStatus(`连接失败：${resp?.error || '未知错误'}`, 'error');
    }
  } catch (err) {
    showStatus(`测试出错：${err?.message || String(err)}`, 'error');
  } finally {
    els.testBtn.disabled = false;
  }
});

loadSettings();
