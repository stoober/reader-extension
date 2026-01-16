// Generate unique IDs
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Update extension icon based on whether current tab's URL is saved
async function updateIconForTab(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  const data = await chrome.storage.local.get(['articles']);
  const articles = data.articles || [];
  const isSaved = articles.some(a => a.url === url);

  const iconPrefix = isSaved ? 'yellow' : 'grey';
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      16: `icons/icon16-${iconPrefix}.png`,
      48: `icons/icon48-${iconPrefix}.png`,
      128: `icons/icon128-${iconPrefix}.png`
    }
  });
}

// Listen for tab activation to update icon
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      updateIconForTab(activeInfo.tabId, tab.url);
    }
  } catch (e) {
    // Tab may not exist
  }
});

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    if (tab.url) {
      updateIconForTab(tabId, tab.url);
    }
  }
});

// Listen for storage changes to update icon when articles change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.articles) {
    // Update icon for current active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        updateIconForTab(tab.id, tab.url);
      }
    } catch (e) {
      // Ignore errors
    }
  }
});

// Listen for keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-page') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        return;
      }

      // Check if already saved
      const data = await chrome.storage.local.get(['articles']);
      const articles = data.articles || [];
      if (articles.some(a => a.url === tab.url)) {
        return; // Already saved
      }

      // Get excerpt from page
      let excerpt = '';
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const content = document.body.innerText || '';
            return content.substring(0, 200).trim() + (content.length > 200 ? '...' : '');
          }
        });
        excerpt = result.result || '';
      } catch (e) {
        // Ignore errors
      }

      // Save article
      const article = {
        id: generateId(),
        url: tab.url,
        title: tab.title || 'Untitled',
        favicon: tab.favIconUrl || '',
        excerpt: excerpt,
        savedAt: new Date().toISOString(),
        isRead: false
      };

      articles.unshift(article);
      await chrome.storage.local.set({ articles });
    } catch (e) {
      // Ignore errors
    }
  }
});

// Handle messages from content script, popup, and new tab page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_ARTICLE') {
    chrome.storage.local.get(['articles']).then(async data => {
      const articles = data.articles || [];
      const { url, title, favicon, excerpt, isRead } = message.article;

      // Check if already saved
      const existingIndex = articles.findIndex(a => a.url === url);
      if (existingIndex >= 0) {
        sendResponse({ success: false, reason: 'already_saved' });
        return;
      }

      const article = {
        id: generateId(),
        url,
        title,
        favicon,
        excerpt,
        savedAt: new Date().toISOString(),
        isRead: isRead || false
      };

      articles.unshift(article);
      await chrome.storage.local.set({ articles });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_ARTICLES') {
    chrome.storage.local.get(['articles']).then(data => {
      sendResponse({ articles: data.articles || [] });
    });
    return true;
  }

  if (message.type === 'DELETE_ARTICLE') {
    chrome.storage.local.get(['articles', 'highlights']).then(async data => {
      const articles = data.articles || [];
      const highlights = data.highlights || {};

      const article = articles.find(a => a.id === message.articleId);
      const newArticles = articles.filter(a => a.id !== message.articleId);

      // Also delete highlights for this article
      if (article && highlights[article.url]) {
        delete highlights[article.url];
      }

      await chrome.storage.local.set({ articles: newArticles, highlights });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'TOGGLE_READ') {
    chrome.storage.local.get(['articles']).then(async data => {
      const articles = data.articles || [];
      const article = articles.find(a => a.id === message.articleId);
      if (article) {
        article.isRead = !article.isRead;
        await chrome.storage.local.set({ articles });
      }
      sendResponse({ success: true, isRead: article?.isRead });
    });
    return true;
  }

  if (message.type === 'TOGGLE_FAVORITE') {
    chrome.storage.local.get(['articles']).then(async data => {
      const articles = data.articles || [];
      const article = articles.find(a => a.id === message.articleId);
      if (article) {
        article.isFavorite = !article.isFavorite;
        await chrome.storage.local.set({ articles });
      }
      sendResponse({ success: true, isFavorite: article?.isFavorite });
    });
    return true;
  }

  if (message.type === 'SAVE_HIGHLIGHT') {
    chrome.storage.local.get(['highlights']).then(async data => {
      const highlights = data.highlights || {};
      const url = message.url;

      if (!highlights[url]) {
        highlights[url] = [];
      }

      const highlightId = generateId();
      highlights[url].push({
        id: highlightId,
        text: message.text,
        prefix: message.prefix || '',
        suffix: message.suffix || '',
        createdAt: new Date().toISOString()
      });

      await chrome.storage.local.set({ highlights });
      sendResponse({ success: true, highlightId: highlightId });
    });
    return true;
  }

  if (message.type === 'GET_HIGHLIGHTS') {
    chrome.storage.local.get(['highlights']).then(data => {
      const highlights = data.highlights || {};
      sendResponse({ highlights: highlights[message.url] || [] });
    });
    return true;
  }

  if (message.type === 'DELETE_HIGHLIGHT') {
    chrome.storage.local.get(['highlights']).then(async data => {
      const highlights = data.highlights || {};
      const url = message.url;

      if (highlights[url]) {
        highlights[url] = highlights[url].filter(h => h.id !== message.highlightId);
        if (highlights[url].length === 0) {
          delete highlights[url];
        }
        await chrome.storage.local.set({ highlights });
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_HIGHLIGHT_COUNTS') {
    chrome.storage.local.get(['highlights']).then(data => {
      const highlights = data.highlights || {};
      const counts = {};
      for (const url in highlights) {
        counts[url] = highlights[url].length;
      }
      sendResponse({ counts });
    });
    return true;
  }

  if (message.type === 'GET_ALL_HIGHLIGHTS') {
    chrome.storage.local.get(['highlights']).then(data => {
      sendResponse({ highlights: data.highlights || {} });
    });
    return true;
  }

  if (message.type === 'IS_PAGE_SAVED') {
    chrome.storage.local.get(['articles']).then(data => {
      const articles = data.articles || [];
      const isSaved = articles.some(a => a.url === message.url);
      sendResponse({ isSaved });
    });
    return true;
  }

});
