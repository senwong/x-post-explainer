(function () {
  'use strict';

  const BTN_ATTR = 'data-x-explainer-injected';
  const HOST_ID = 'x-explainer-drawer-host';

  // In-memory session cache keyed by tweetId
  // { ctx, messages: [{ role, content, images? }], uiMessages: [{ role, content }] }
  const sessions = new Map();

  let currentTweetId = null;
  let activePort = null;
  let isStreaming = false;
  let drawerRoot = null;
  let drawerRefs = null;
  let themeMode = 'system'; // 'system' | 'light' | 'dark'
  let shouldAutoScroll = true;
  let lastScrollTop = 0;
  const SCROLL_REATTACH_THRESHOLD = 8;

  const systemDarkMq = window.matchMedia('(prefers-color-scheme: dark)');

  function resolveEffectiveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemDarkMq.matches ? 'dark' : 'light';
  }

  function getThemeMeta(mode) {
    if (mode === 'light') return { icon: '☀', title: '主题：浅色（点击切换）' };
    if (mode === 'dark') return { icon: '☾', title: '主题：深色（点击切换）' };
    return { icon: '◐', title: '主题：跟随系统（点击切换）' };
  }

  function loadInitialTheme() {
    try {
      chrome.storage.local.get({ theme: 'system' }, (res) => {
        themeMode = res?.theme || 'system';
        updateDrawerTheme();
      });
    } catch (_) {}
  }

  systemDarkMq.addEventListener('change', () => {
    if (themeMode === 'system') updateDrawerTheme();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.theme) {
        themeMode = changes.theme.newValue || 'system';
        updateDrawerTheme();
      }
    });
  } catch (_) {}

  function createSparkleSvg(size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.3L19 10.2l-5.1 1.9L12 17.5l-1.9-5.4L5 10.2l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>`;
  }

  function injectButtonStyle() {
    if (document.getElementById('x-explainer-btn-style')) return;
    const style = document.createElement('style');
    style.id = 'x-explainer-btn-style';
    style.textContent = `
      .x-explainer-trigger-wrap {
        display: inline-flex;
        align-items: center;
        margin-left: 6px;
      }
      .x-explainer-trigger-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding: 0 9px;
        border: 1px solid rgba(29, 155, 240, 0.35);
        border-radius: 9999px;
        background: rgba(29, 155, 240, 0.08);
        color: rgb(29, 155, 240);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        white-space: nowrap;
      }
      .x-explainer-trigger-btn:hover {
        background: rgba(29, 155, 240, 0.18);
        border-color: rgba(29, 155, 240, 0.65);
      }
      .x-explainer-trigger-btn:active {
        transform: scale(0.96);
      }
    `;
    document.head.appendChild(style);
  }

  function injectButtonIntoArticle(article) {
    if (!article || article.getAttribute(BTN_ATTR) === '1') return;

    const actionGroups = article.querySelectorAll('[role="group"]');
    const actionBar = actionGroups[actionGroups.length - 1];
    if (!actionBar) return;

    article.setAttribute(BTN_ATTR, '1');

    const wrap = document.createElement('div');
    wrap.className = 'x-explainer-trigger-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-explainer-trigger-btn';
    btn.title = '用 AI 解析这条推文的俚语、梗与上下文';
    btn.innerHTML = `${createSparkleSvg(13)}<span>解析</span>`;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleExplainClick(article);
    });

    wrap.appendChild(btn);
    actionBar.appendChild(wrap);
  }

  function scanTweets() {
    const articles = document.querySelectorAll(`article[data-testid="tweet"]:not([${BTN_ATTR}="1"])`);
    articles.forEach(injectButtonIntoArticle);
  }

  function ensureDrawer() {
    if (drawerRoot && drawerRefs) {
      updateDrawerTheme();
      return;
    }

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      document.body.appendChild(host);
    }

    drawerRoot = host.attachShadow({ mode: 'open' });
    drawerRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          z-index: 2147483640;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        }
        .drawer {
          --bg: #0f1419;
          --bg-elev: #161b22;
          --bg-subtle: #1e2630;
          --border: #2f3336;
          --text: #e7e9ea;
          --text-muted: #8b98a5;
          --accent: #1d9bf0;
          --accent-soft: rgba(29, 155, 240, 0.14);
          --danger: #f4212e;
          --user-bubble: #1d9bf0;
          --user-text: #ffffff;

          width: 420px;
          max-width: 92vw;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--bg);
          color: var(--text);
          border-left: 1px solid var(--border);
          box-shadow: -8px 0 28px rgba(0, 0, 0, 0.35);
          transform: translateX(100%);
          transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          box-sizing: border-box;
        }
        .drawer.light {
          --bg: #ffffff;
          --bg-elev: #f7f9f9;
          --bg-subtle: #eff3f4;
          --border: #e1e8ed;
          --text: #0f1419;
          --text-muted: #536471;
          --accent: #1d9bf0;
          --accent-soft: rgba(29, 155, 240, 0.1);
          --user-bubble: #1d9bf0;
          --user-text: #ffffff;
          box-shadow: -8px 0 28px rgba(15, 20, 25, 0.12);
        }
        .drawer.open {
          transform: translateX(0);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 700;
          color: var(--text);
        }
        .header-title svg {
          color: var(--accent);
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 30px;
          padding: 0 9px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.15s, color 0.15s;
        }
        .icon-btn:hover {
          background: var(--bg-subtle);
          color: var(--text);
        }

        .context-card {
          padding: 10px 14px;
          background: var(--bg-elev);
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .context-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }
        .context-author {
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          flex-shrink: 0;
        }
        .badge {
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 999px;
          background: var(--accent-soft);
          color: var(--accent);
          font-weight: 500;
        }
        .context-text {
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--text-muted);
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .msg {
          font-size: 14px;
          line-height: 1.65;
          word-break: break-word;
        }
        .msg-user {
          align-self: flex-end;
          max-width: 85%;
          background: var(--user-bubble);
          color: var(--user-text);
          padding: 8px 12px;
          border-radius: 14px 14px 4px 14px;
          white-space: pre-wrap;
        }
        .msg-assistant {
          align-self: stretch;
          background: var(--bg-elev);
          border: 1px solid var(--border);
          padding: 12px 14px;
          border-radius: 12px;
          color: var(--text);
        }
        .msg-assistant h1, .msg-assistant h2, .msg-assistant h3, .msg-assistant h4 {
          margin: 12px 0 6px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--text);
        }
        .msg-assistant h1:first-child, .msg-assistant h2:first-child, .msg-assistant h3:first-child {
          margin-top: 0;
        }
        .msg-assistant h1 { font-size: 16px; }
        .msg-assistant h2 { font-size: 15px; }
        .msg-assistant h3 { font-size: 14px; }
        .msg-assistant p {
          margin: 0 0 8px;
        }
        .msg-assistant p:last-child {
          margin-bottom: 0;
        }
        .msg-assistant ul, .msg-assistant ol {
          margin: 4px 0 10px;
          padding-left: 20px;
        }
        .msg-assistant li {
          margin-bottom: 4px;
        }
        .msg-assistant blockquote {
          margin: 6px 0 10px;
          padding: 6px 10px;
          border-left: 3px solid var(--accent);
          background: var(--bg-subtle);
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
        }
        .msg-assistant code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12.5px;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--bg-subtle);
        }
        .msg-assistant pre {
          margin: 8px 0;
          padding: 10px;
          border-radius: 8px;
          background: var(--bg-subtle);
          overflow-x: auto;
        }
        .msg-assistant pre code {
          padding: 0;
          background: transparent;
        }
        .msg-assistant hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 10px 0;
        }
        .msg-assistant a {
          color: var(--accent);
          text-decoration: none;
        }
        .msg-assistant a:hover {
          text-decoration: underline;
        }

        .msg-error {
          background: rgba(244, 33, 46, 0.1);
          border: 1px solid rgba(244, 33, 46, 0.35);
          color: var(--danger);
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 13px;
          line-height: 1.5;
        }
        .config-cta {
          margin-top: 8px;
          display: inline-block;
          padding: 6px 12px;
          border: none;
          border-radius: 8px;
          background: var(--accent);
          color: #fff;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .loading-dots {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--text-muted);
          font-size: 13px;
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: pulse 1.2s infinite ease-in-out;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }

        .footer {
          padding: 10px 12px 12px;
          border-top: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .quick-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .chip {
          border: 1px solid var(--border);
          background: var(--bg-elev);
          color: var(--text-muted);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11.5px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .chip:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .input-row {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        .input-box {
          flex: 1;
          min-height: 38px;
          max-height: 110px;
          resize: none;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-elev);
          color: var(--text);
          font-family: inherit;
          font-size: 13.5px;
          line-height: 1.4;
          outline: none;
          box-sizing: border-box;
        }
        .input-box:focus {
          border-color: var(--accent);
        }
        .send-btn {
          height: 38px;
          padding: 0 14px;
          border: none;
          border-radius: 10px;
          background: var(--accent);
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          flex-shrink: 0;
        }
        .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .send-btn.stop {
          background: var(--danger);
        }
      </style>

      <div class="drawer" id="drawer">
        <div class="header">
          <div class="header-title">
            ${createSparkleSvg(17)}
            <span>X 推文俚语解析</span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="themeBtn" title="主题：跟随系统（点击切换）">◐</button>
            <button class="icon-btn" id="rerunBtn" title="重新解析当前推文">重跑</button>
            <button class="icon-btn" id="settingsBtn" title="打开 API 设置">设置</button>
            <button class="icon-btn" id="closeBtn" title="关闭 (Esc)">✕</button>
          </div>
        </div>

        <div class="context-card" id="contextCard">
          <div class="context-meta">
            <div class="context-author" id="contextAuthor"></div>
            <div class="badges" id="contextBadges"></div>
          </div>
          <div class="context-text" id="contextText"></div>
        </div>

        <div class="messages" id="messages"></div>

        <div class="footer">
          <div class="quick-chips">
            <button class="chip" data-prompt="请把原帖逐句翻译并逐词拆解一下。">逐句拆解</button>
            <button class="chip" data-prompt="这里面有没有文化背景、双关或圈内梗？展开讲讲。">深挖背景梗</button>
            <button class="chip" data-prompt="用更通俗接地气的大白话再总结一遍。">再通俗点</button>
          </div>
          <div class="input-row">
            <textarea class="input-box" id="chatInput" rows="1" placeholder="继续追问某个词或句子... (Enter 发送)"></textarea>
            <button class="send-btn" id="sendBtn">发送</button>
          </div>
        </div>
      </div>
    `;

    drawerRefs = {
      drawer: drawerRoot.getElementById('drawer'),
      themeBtn: drawerRoot.getElementById('themeBtn'),
      rerunBtn: drawerRoot.getElementById('rerunBtn'),
      settingsBtn: drawerRoot.getElementById('settingsBtn'),
      closeBtn: drawerRoot.getElementById('closeBtn'),
      contextAuthor: drawerRoot.getElementById('contextAuthor'),
      contextBadges: drawerRoot.getElementById('contextBadges'),
      contextText: drawerRoot.getElementById('contextText'),
      messages: drawerRoot.getElementById('messages'),
      chatInput: drawerRoot.getElementById('chatInput'),
      sendBtn: drawerRoot.getElementById('sendBtn')
    };

    drawerRefs.themeBtn.addEventListener('click', () => {
      const order = ['system', 'light', 'dark'];
      const next = order[(order.indexOf(themeMode) + 1) % order.length];
      themeMode = next;
      updateDrawerTheme();
      try {
        chrome.storage.local.set({ theme: next });
      } catch (_) {}
    });

    drawerRefs.messages.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY < 0) {
          shouldAutoScroll = false;
        } else if (e.deltaY > 0 && isNearBottom(drawerRefs.messages)) {
          shouldAutoScroll = true;
        }
      },
      { passive: true }
    );

    drawerRefs.messages.addEventListener(
      'scroll',
      () => {
        const el = drawerRefs.messages;
        const currentTop = el.scrollTop;
        if (currentTop < lastScrollTop - 1) {
          shouldAutoScroll = false;
        } else if (currentTop > lastScrollTop && isNearBottom(el)) {
          shouldAutoScroll = true;
        }
        lastScrollTop = currentTop;
      },
      { passive: true }
    );

    drawerRefs.closeBtn.addEventListener('click', closeDrawer);
    drawerRefs.settingsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-options' });
    });
    drawerRefs.rerunBtn.addEventListener('click', () => {
      if (!currentTweetId) return;
      const session = sessions.get(currentTweetId);
      if (!session) return;
      startFreshExplain(session.ctx);
    });

    drawerRefs.sendBtn.addEventListener('click', () => {
      if (isStreaming) {
        abortStream();
      } else {
        handleFollowUpSubmit();
      }
    });

    drawerRefs.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!isStreaming) handleFollowUpSubmit();
      }
    });

    drawerRefs.chatInput.addEventListener('input', () => {
      const el = drawerRefs.chatInput;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
    });

    drawerRoot.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (isStreaming || !currentTweetId) return;
        const prompt = chip.getAttribute('data-prompt');
        if (prompt) sendFollowUp(prompt);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerRefs?.drawer.classList.contains('open')) {
        closeDrawer();
      }
    });

    updateDrawerTheme();
  }

  function updateDrawerTheme() {
    if (!drawerRefs) return;
    const effective = resolveEffectiveTheme(themeMode);
    drawerRefs.drawer.classList.toggle('light', effective === 'light');
    if (drawerRefs.themeBtn) {
      const meta = getThemeMeta(themeMode);
      drawerRefs.themeBtn.textContent = meta.icon;
      drawerRefs.themeBtn.title = meta.title;
    }
  }

  function openDrawer() {
    ensureDrawer();
    requestAnimationFrame(() => {
      drawerRefs.drawer.classList.add('open');
    });
  }

  function closeDrawer() {
    abortStream();
    if (drawerRefs) {
      drawerRefs.drawer.classList.remove('open');
    }
  }

  function setStreamingState(streaming) {
    isStreaming = streaming;
    if (!drawerRefs) return;
    if (streaming) {
      drawerRefs.sendBtn.textContent = '停止';
      drawerRefs.sendBtn.classList.add('stop');
    } else {
      drawerRefs.sendBtn.textContent = '发送';
      drawerRefs.sendBtn.classList.remove('stop');
    }
  }

  function abortStream() {
    if (activePort) {
      try {
        activePort.postMessage({ type: 'abort' });
        activePort.disconnect();
      } catch (_) {}
      activePort = null;
    }
    setStreamingState(false);
  }

  function renderContextHeader(ctx) {
    drawerRefs.contextAuthor.textContent = ctx.main.author || 'X 推文';
    drawerRefs.contextText.textContent = ctx.main.text || (ctx.allImages.length ? '（纯图片推文）' : '（无文本内容）');

    const badges = [];
    if (ctx.parents?.length) badges.push(`父帖 ×${ctx.parents.length}`);
    if (ctx.quoted) badges.push('含引用帖');
    if (ctx.allImages?.length) badges.push(`配图 ×${ctx.allImages.length}`);

    drawerRefs.contextBadges.innerHTML = badges
      .map((b) => `<span class="badge">${window.XExplainerMarkdown.escapeHtml(b)}</span>`)
      .join('');
  }

  function renderSessionMessages(session) {
    drawerRefs.messages.innerHTML = '';
    for (const m of session.uiMessages) {
      appendMessageElement(m.role, m.content, m.isError, m.errorCode);
    }
    scrollMessagesToBottom(true);
  }

  function appendMessageElement(role, content, isError = false, errorCode = '') {
    const div = document.createElement('div');
    if (isError) {
      div.className = 'msg msg-error';
      div.innerHTML = `<div>${window.XExplainerMarkdown.escapeHtml(content)}</div>`;
      if (errorCode === 'NO_CONFIG') {
        const btn = document.createElement('button');
        btn.className = 'config-cta';
        btn.textContent = '去配置 API Key';
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'open-options' });
        });
        div.appendChild(btn);
      }
    } else if (role === 'user') {
      div.className = 'msg msg-user';
      div.textContent = content;
    } else {
      div.className = 'msg msg-assistant';
      if (content) {
        div.innerHTML = window.XExplainerMarkdown.renderMarkdown(content);
      } else {
        div.innerHTML = `<div class="loading-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>正在解析推文...</span></div>`;
      }
    }
    drawerRefs.messages.appendChild(div);
    return div;
  }

  function isNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_REATTACH_THRESHOLD;
  }

  function scrollMessagesToBottom(force = false) {
    if (!drawerRefs) return;
    if (force) shouldAutoScroll = true;
    if (!shouldAutoScroll) return;
    const el = drawerRefs.messages;
    el.scrollTop = el.scrollHeight;
    lastScrollTop = el.scrollTop;
  }

  async function handleExplainClick(article) {
    openDrawer();

    let includeContext = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'get-config' });
      if (resp?.config && typeof resp.config.includeContext === 'boolean') {
        includeContext = resp.config.includeContext;
      }
    } catch (_) {}

    const ctx = window.XExplainerExtractor.extractTweetContext(article, includeContext);
    currentTweetId = ctx.id;
    renderContextHeader(ctx);

    const existing = sessions.get(ctx.id);
    if (existing && existing.uiMessages.length > 0 && !existing.uiMessages[0].isError) {
      abortStream();
      renderSessionMessages(existing);
      return;
    }

    startFreshExplain(ctx);
  }

  function startFreshExplain(ctx) {
    abortStream();
    const initialPrompt = window.XExplainerExtractor.buildInitialPrompt(ctx);
    const session = {
      ctx,
      messages: [
        {
          role: 'user',
          content: initialPrompt,
          images: ctx.allImages
        }
      ],
      uiMessages: []
    };
    sessions.set(ctx.id, session);
    renderSessionMessages(session);
    streamAssistantReply(session);
  }

  function handleFollowUpSubmit() {
    const text = drawerRefs.chatInput.value.trim();
    if (!text || !currentTweetId) return;
    drawerRefs.chatInput.value = '';
    drawerRefs.chatInput.style.height = 'auto';
    sendFollowUp(text);
  }

  function sendFollowUp(text) {
    const session = sessions.get(currentTweetId);
    if (!session) return;

    session.messages.push({ role: 'user', content: text });
    session.uiMessages.push({ role: 'user', content: text });
    appendMessageElement('user', text);
    scrollMessagesToBottom(true);

    streamAssistantReply(session);
  }

  function streamAssistantReply(session) {
    abortStream();
    setStreamingState(true);

    const assistantEl = appendMessageElement('assistant', '');
    scrollMessagesToBottom(true);

    let fullText = '';
    let port;
    try {
      port = chrome.runtime.connect({ name: 'x-explainer-stream' });
      activePort = port;
    } catch (err) {
      assistantEl.remove();
      const errMsg = '插件已更新，请刷新当前 X 页面后再试。';
      session.uiMessages.push({ role: 'assistant', content: errMsg, isError: true });
      appendMessageElement('assistant', errMsg, true);
      setStreamingState(false);
      return;
    }

    port.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        fullText += msg.content;
        assistantEl.innerHTML = window.XExplainerMarkdown.renderMarkdown(fullText);
        scrollMessagesToBottom(false);
      } else if (msg.type === 'done' || msg.type === 'aborted') {
        if (fullText) {
          session.messages.push({ role: 'assistant', content: fullText });
          session.uiMessages.push({ role: 'assistant', content: fullText });
        } else if (msg.type === 'aborted') {
          assistantEl.remove();
        }
        setStreamingState(false);
        try { port.disconnect(); } catch (_) {}
        if (activePort === port) activePort = null;
      } else if (msg.type === 'error') {
        assistantEl.remove();
        session.uiMessages.push({
          role: 'assistant',
          content: msg.error,
          isError: true,
          errorCode: msg.code || ''
        });
        appendMessageElement('assistant', msg.error, true, msg.code || '');
        scrollMessagesToBottom(false);
        setStreamingState(false);
        try { port.disconnect(); } catch (_) {}
        if (activePort === port) activePort = null;
      }
    });

    port.onDisconnect.addListener(() => {
      if (activePort === port) {
        activePort = null;
        setStreamingState(false);
      }
    });

    port.postMessage({
      type: 'chat',
      messages: session.messages
    });
  }

  // Initialize
  loadInitialTheme();
  injectButtonStyle();
  scanTweets();

  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanTweets();
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
