(function () {
  'use strict';

  function extractTextWithEmoji(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    // Replace emoji <img> with their alt text
    clone.querySelectorAll('img[alt]').forEach((img) => {
      const alt = img.getAttribute('alt') || '';
      img.replaceWith(document.createTextNode(alt));
    });
    return (clone.innerText || clone.textContent || '').trim();
  }

  function extractAuthor(container) {
    if (!container) return '';
    const userEl = container.querySelector('[data-testid="User-Name"]');
    if (!userEl) return '';
    const raw = (userEl.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const name = raw[0] || '';
    const handle = raw.find((s) => s.startsWith('@')) || '';
    if (name && handle) return `${name} (${handle})`;
    return name || handle;
  }

  function normalizeImageUrl(src) {
    if (!src) return '';
    try {
      const u = new URL(src);
      if (u.hostname.includes('twimg.com') && u.pathname.includes('/media/')) {
        u.searchParams.set('name', 'medium');
        return u.toString();
      }
      return src;
    } catch (_) {
      return src;
    }
  }

  function extractImages(container, excludeContainer) {
    if (!container) return [];
    const urls = [];
    const seen = new Set();
    const imgs = container.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img');
    imgs.forEach((img) => {
      if (excludeContainer && excludeContainer.contains(img)) return;
      const src = img.getAttribute('src') || '';
      if (!src || src.includes('/emoji/') || src.includes('/profile_images/')) return;
      const normalized = normalizeImageUrl(src);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    });
    return urls;
  }

  function findQuoteContainer(article) {
    // X renders a quoted tweet inside a role="link" or tabindex="0" card within the article
    const allTexts = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    const allUsers = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));

    if (allUsers.length > 1) {
      const secondUser = allUsers[1];
      const quoteCard = secondUser.closest('[role="link"], div[tabindex="0"]');
      if (quoteCard && article.contains(quoteCard) && quoteCard !== article) {
        return quoteCard;
      }
      return secondUser.parentElement?.parentElement?.parentElement || null;
    }

    if (allTexts.length > 1) {
      const secondText = allTexts[1];
      const quoteCard = secondText.closest('[role="link"], div[tabindex="0"]');
      if (quoteCard && article.contains(quoteCard) && quoteCard !== article) {
        return quoteCard;
      }
    }

    return null;
  }

  function extractTweetId(article) {
    const timeEl = article.querySelector('time');
    const link = timeEl?.closest('a[href*="/status/"]') || article.querySelector('a[href*="/status/"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    const textSnippet = extractTextWithEmoji(article.querySelector('[data-testid="tweetText"]')).slice(0, 40);
    return `tweet-${Date.now()}-${textSnippet.length}`;
  }

  function extractSingleTweet(article) {
    const quoteContainer = findQuoteContainer(article);

    // Main author (first User-Name not inside quoteContainer)
    const userEls = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
    const mainUserEl = userEls.find((el) => !quoteContainer || !quoteContainer.contains(el));
    let author = '';
    if (mainUserEl) {
      const raw = (mainUserEl.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const name = raw[0] || '';
      const handle = raw.find((s) => s.startsWith('@')) || '';
      author = name && handle ? `${name} (${handle})` : (name || handle);
    }

    // Main text (first tweetText not inside quoteContainer)
    const textEls = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    const mainTextEl = textEls.find((el) => !quoteContainer || !quoteContainer.contains(el));
    const text = extractTextWithEmoji(mainTextEl);

    // Card preview text (links/articles)
    let cardText = '';
    const cardEl = article.querySelector('[data-testid="card.wrapper"]');
    if (cardEl && (!quoteContainer || !quoteContainer.contains(cardEl))) {
      cardText = (cardEl.innerText || '').trim().replace(/\n+/g, ' | ');
    }

    // Main images
    const images = extractImages(article, quoteContainer);

    // Quoted tweet
    let quoted = null;
    if (quoteContainer) {
      const qAuthor = extractAuthor(quoteContainer);
      const qTextEl = quoteContainer.querySelector('[data-testid="tweetText"]');
      const qText = extractTextWithEmoji(qTextEl);
      const qImages = extractImages(quoteContainer, null);
      if (qText || qImages.length > 0) {
        quoted = { author: qAuthor, text: qText, images: qImages };
      }
    }

    return {
      id: extractTweetId(article),
      author,
      text,
      cardText,
      images,
      quoted
    };
  }

  function extractParentTweets(article) {
    const isStatusPage = /\/status\/\d+/.test(location.pathname);
    const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const idx = allArticles.indexOf(article);
    if (idx <= 0) return [];

    const parents = [];

    if (isStatusPage) {
      // On a tweet detail page, tweets above the clicked reply are usually the parent thread / focal tweet.
      // Take up to 2 most relevant preceding tweets (always include the focal tweet or immediate parent).
      const start = Math.max(0, idx - 2);
      for (let i = start; i < idx; i++) {
        const p = extractSingleTweet(allArticles[i]);
        if (p.text || p.images.length > 0) {
          parents.push(p);
        }
      }
    } else {
      // On timeline, check if the immediately preceding tweet is visually connected by a thread line
      const prevArticle = allArticles[idx - 1];
      const prevCell = prevArticle.closest('[data-testid="cellInnerDiv"]');
      const currCell = article.closest('[data-testid="cellInnerDiv"]');
      if (prevCell && currCell && prevCell.nextElementSibling === currCell) {
        // Check if current tweet says "Replying to" or previous has a vertical connector line
        const hasReplyIndicator = (article.innerText || '').includes('Replying to') ||
          (article.innerText || '').includes('回复');
        if (hasReplyIndicator) {
          const p = extractSingleTweet(prevArticle);
          if (p.text || p.images.length > 0) {
            parents.push(p);
          }
        }
      }
    }

    return parents;
  }

  function extractTweetContext(article, includeContext = true) {
    const main = extractSingleTweet(article);
    const parents = includeContext ? extractParentTweets(article) : [];
    const quoted = includeContext ? main.quoted : null;

    const allImages = [
      ...main.images,
      ...(quoted ? quoted.images : []),
      ...parents.flatMap((p) => p.images)
    ];
    const uniqueImages = Array.from(new Set(allImages)).slice(0, 4);

    return {
      id: main.id,
      main: {
        author: main.author,
        text: main.text,
        cardText: main.cardText,
        images: main.images
      },
      quoted,
      parents,
      allImages: uniqueImages
    };
  }

  function buildInitialPrompt(ctx) {
    const sections = [];

    if (ctx.parents && ctx.parents.length > 0) {
      const parentStr = ctx.parents
        .map((p, i) => `【父帖 ${i + 1}】${p.author ? p.author + '：' : ''}\n${p.text || '（无文字，见配图）'}`)
        .join('\n\n');
      sections.push(`## 上下文（原帖 / 父帖）\n${parentStr}`);
    }

    let mainSection = `## 需要解析的目标帖子\n`;
    if (ctx.main.author) mainSection += `作者：${ctx.main.author}\n`;
    mainSection += ctx.main.text ? `内容：\n${ctx.main.text}` : `内容：（无文字，请结合配图解析）`;
    if (ctx.main.cardText) {
      mainSection += `\n附带链接卡片：${ctx.main.cardText}`;
    }
    sections.push(mainSection);

    if (ctx.quoted) {
      let qSection = `## 该帖子引用的推文（Quote Tweet）\n`;
      if (ctx.quoted.author) qSection += `原作者：${ctx.quoted.author}\n`;
      qSection += ctx.quoted.text ? `内容：\n${ctx.quoted.text}` : `内容：（无文字，见配图）`;
      sections.push(qSection);
    }

    sections.push('请帮我解析上面「需要解析的目标帖子」的意思、俚语、网络梗和语境。');
    return sections.join('\n\n');
  }

  window.XExplainerExtractor = {
    extractTweetContext,
    buildInitialPrompt
  };
})();
