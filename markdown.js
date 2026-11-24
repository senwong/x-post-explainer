(function () {
  'use strict';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    let out = escapeHtml(text);

    // Inline code
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold + italic
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Links [text](https://...)
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    return out;
  }

  function renderMarkdown(md) {
    if (!md) return '';

    const codeBlocks = [];
    const text = String(md).replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      codeBlocks.push(`<pre><code${langClass}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return `\n@@CODEBLOCK_${idx}@@\n`;
    });

    const lines = text.split(/\r?\n/);
    const html = [];
    let inUl = false;
    let inOl = false;
    let inBlockquote = false;

    const closeLists = () => {
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
      if (inBlockquote) {
        html.push('</blockquote>');
        inBlockquote = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        closeLists();
        continue;
      }

      const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
      if (codeMatch) {
        closeLists();
        html.push(codeBlocks[Number(codeMatch[1])]);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeLists();
        html.push('<hr>');
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        closeLists();
        const level = headingMatch[1].length;
        html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
        continue;
      }

      const bqMatch = trimmed.match(/^>\s?(.*)$/);
      if (bqMatch) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inBlockquote) {
          html.push('<blockquote>');
          inBlockquote = true;
        }
        html.push(`<p>${renderInline(bqMatch[1])}</p>`);
        continue;
      }

      const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
      if (ulMatch) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false; }
        if (!inUl) {
          html.push('<ul>');
          inUl = true;
        }
        html.push(`<li>${renderInline(ulMatch[1])}</li>`);
        continue;
      }

      const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (olMatch) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false; }
        if (!inOl) {
          html.push('<ol>');
          inOl = true;
        }
        html.push(`<li>${renderInline(olMatch[1])}</li>`);
        continue;
      }

      closeLists();
      html.push(`<p>${renderInline(trimmed)}</p>`);
    }

    closeLists();
    return html.join('\n');
  }

  window.XExplainerMarkdown = { renderMarkdown, escapeHtml };
})();
