document.addEventListener('DOMContentLoaded', init);

let currentTab = null;
let existingArticle = null;

async function init() {
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Display page info
  document.getElementById('favicon').src = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=64`;
  document.getElementById('title').textContent = tab.title || 'Untitled';

  // Check if already saved
  const response = await chrome.runtime.sendMessage({ type: 'GET_ARTICLES' });
  const articles = response.articles || [];
  existingArticle = articles.find(a => a.url === tab.url);

  if (existingArticle) {
    document.getElementById('actions').style.display = 'none';
    document.getElementById('already-saved').style.display = 'block';
    updateFavoriteButton();
    updateReadButton();
  }

  // Event listeners
  document.getElementById('read-later').addEventListener('click', () => saveArticle('later'));
  document.getElementById('save').addEventListener('click', () => saveArticle('read'));
  document.getElementById('remove').addEventListener('click', removeArticle);
  document.getElementById('toggle-favorite').addEventListener('click', toggleFavorite);
  document.getElementById('toggle-read').addEventListener('click', toggleRead);
}

function updateReadButton() {
  const btn = document.getElementById('toggle-read');
  const text = document.getElementById('toggle-read-text');
  const iconContainer = document.getElementById('toggle-read-icon');

  if (existingArticle?.isRead) {
    btn.classList.add('is-read');
    text.textContent = 'Move to Read Later';
    // Clock icon for "move to read later"
    iconContainer.outerHTML = '<svg id="toggle-read-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  } else {
    btn.classList.remove('is-read');
    text.textContent = 'Mark as Read';
    // Checkmark icon for "mark as read"
    iconContainer.outerHTML = '<svg id="toggle-read-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }
}

function updateFavoriteButton() {
  const btn = document.getElementById('toggle-favorite');
  const text = document.getElementById('favorite-text');
  const svg = btn.querySelector('svg');

  if (existingArticle?.isFavorite) {
    btn.classList.add('is-favorite');
    text.textContent = 'Remove from Favorites';
    svg.setAttribute('fill', 'currentColor');
  } else {
    btn.classList.remove('is-favorite');
    text.textContent = 'Add to Favorites';
    svg.setAttribute('fill', 'none');
  }
}

async function toggleFavorite() {
  if (!existingArticle) return;

  const response = await chrome.runtime.sendMessage({
    type: 'TOGGLE_FAVORITE',
    articleId: existingArticle.id
  });

  existingArticle.isFavorite = response.isFavorite;
  updateFavoriteButton();
}

async function toggleRead() {
  if (!existingArticle) return;

  const response = await chrome.runtime.sendMessage({
    type: 'TOGGLE_READ',
    articleId: existingArticle.id
  });

  existingArticle.isRead = response.isRead;
  updateReadButton();
}

async function saveArticle(type) {
  const actionsEl = document.getElementById('actions');
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('status-text');

  // Get excerpt from page
  let excerpt = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => {
        const content = document.body.innerText || '';
        return content.substring(0, 200).trim() + (content.length > 200 ? '...' : '');
      }
    });
    excerpt = result.result || '';
  } catch (e) {
    // Ignore errors
  }

  await chrome.runtime.sendMessage({
    type: 'SAVE_ARTICLE',
    article: {
      url: currentTab.url,
      title: currentTab.title || 'Untitled',
      favicon: currentTab.favIconUrl || '',
      excerpt: excerpt,
      isRead: type === 'read'
    }
  });

  // Show success
  actionsEl.style.display = 'none';
  statusEl.style.display = 'flex';
  statusTextEl.textContent = type === 'read' ? 'Saved!' : 'Added to Read Later!';

  // Close popup after a moment
  setTimeout(() => window.close(), 1000);
}

async function removeArticle() {
  if (!existingArticle) return;

  await chrome.runtime.sendMessage({
    type: 'DELETE_ARTICLE',
    articleId: existingArticle.id
  });

  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('status-text');
  document.getElementById('already-saved').style.display = 'none';
  statusEl.style.display = 'flex';
  statusEl.style.color = '#888';
  statusTextEl.textContent = 'Removed';

  setTimeout(() => window.close(), 800);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
