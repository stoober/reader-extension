// New tab page logic
document.addEventListener('DOMContentLoaded', init);

let allArticles = [];
let allHighlights = {};
let highlightCounts = {};
let currentSearchQuery = '';
let currentScope = 'all';
let currentSort = 'newest';

async function init() {
  await loadArticles();

  // Setup search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.toLowerCase();
    renderFilteredArticles();
  });

  // Setup scope buttons
  document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScope = btn.dataset.scope;
      renderFilteredArticles();
    });
  });

  // Setup sort select
  const sortSelect = document.getElementById('sort-select');
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderFilteredArticles();
  });

  // Listen for storage changes to update in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.articles || changes.highlights)) {
      loadArticles();
    }
  });

  // Setup export/import
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importData);

  // Load last export date
  loadLastExportDate();
}

async function loadLastExportDate() {
  const { lastExportDate } = await chrome.storage.local.get(['lastExportDate']);
  const el = document.getElementById('last-export');
  if (lastExportDate) {
    el.textContent = `Last backup: ${formatDate(lastExportDate)}`;
  } else {
    el.textContent = 'No backup yet';
  }
}

async function loadArticles() {
  const [articlesResponse, countsResponse, highlightsResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ARTICLES' }),
    chrome.runtime.sendMessage({ type: 'GET_HIGHLIGHT_COUNTS' }),
    chrome.runtime.sendMessage({ type: 'GET_ALL_HIGHLIGHTS' })
  ]);

  allArticles = articlesResponse.articles || [];
  highlightCounts = countsResponse.counts || {};
  allHighlights = highlightsResponse.highlights || {};

  renderFilteredArticles();
}

function renderFilteredArticles() {
  let filtered = allArticles;

  // Apply search filter
  if (currentSearchQuery) {
    filtered = filtered.filter(a => {
      const title = (a.title || '').toLowerCase();
      const excerpt = (a.excerpt || '').toLowerCase();
      const url = (a.url || '').toLowerCase();
      return title.includes(currentSearchQuery) ||
             excerpt.includes(currentSearchQuery) ||
             url.includes(currentSearchQuery);
    });
  }

  // Apply sort
  filtered = [...filtered].sort((a, b) => {
    const dateA = new Date(a.savedAt);
    const dateB = new Date(b.savedAt);
    return currentSort === 'newest' ? dateB - dateA : dateA - dateB;
  });

  // Apply scope filter
  let readLater, saved;
  if (currentScope === 'favorites') {
    // Favorites tab: show only favorites, split by read status
    readLater = filtered.filter(a => a.isFavorite && !a.isRead);
    saved = filtered.filter(a => a.isFavorite && a.isRead);
  } else if (currentScope === 'read-later') {
    readLater = filtered.filter(a => !a.isRead);
    saved = [];
  } else if (currentScope === 'saved') {
    readLater = [];
    saved = filtered.filter(a => a.isRead);
  } else {
    // All: show both sections
    readLater = filtered.filter(a => !a.isRead);
    saved = filtered.filter(a => a.isRead);
  }

  renderArticles('read-later-list', readLater, highlightCounts);
  renderArticles('saved-list', saved, highlightCounts);

  // Show/hide empty states
  const readLaterEmpty = document.getElementById('read-later-empty');
  const savedEmpty = document.getElementById('saved-empty');

  if (currentSearchQuery) {
    readLaterEmpty.textContent = 'No matching articles found.';
    savedEmpty.textContent = 'No matching articles found.';
  } else if (currentScope === 'favorites') {
    readLaterEmpty.textContent = 'No favorite articles in Read Later.';
    savedEmpty.textContent = 'No favorite articles in Saved.';
  } else {
    readLaterEmpty.textContent = 'No articles in your reading list. Click the extension icon on any page to add one.';
    savedEmpty.textContent = 'No saved articles yet.';
  }

  readLaterEmpty.classList.toggle('visible', readLater.length === 0 && currentScope !== 'saved');
  savedEmpty.classList.toggle('visible', saved.length === 0 && currentScope !== 'read-later');

  // Show/hide sections based on scope
  const isHighlightsScope = currentScope === 'highlights';

  document.getElementById('read-later-section').style.display =
    (currentScope === 'saved' || isHighlightsScope) ? 'none' : 'block';
  document.getElementById('saved-section').style.display =
    (currentScope === 'read-later' || isHighlightsScope) ? 'none' :
    (currentScope === 'all' && saved.length === 0 ? 'none' : 'block');

  // Handle highlights section
  if (isHighlightsScope) {
    renderHighlights();
    document.getElementById('highlights-section').style.display = 'block';
  } else {
    document.getElementById('highlights-section').style.display = 'none';
  }
}

function renderArticles(containerId, articles, highlightCounts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  articles.forEach(article => {
    const card = createArticleCard(article, highlightCounts[article.url] || 0);
    container.appendChild(card);
  });
}

function createArticleCard(article, highlightCount) {
  const card = document.createElement('div');
  card.className = 'article-card';

  const domain = getDomain(article.url);
  const date = formatDate(article.savedAt);

  card.innerHTML = `
    <img class="article-favicon" src="${article.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`}" alt="" onerror="this.style.display='none'">
    <div class="article-content">
      <div class="article-title">${escapeHtml(article.title)}</div>
      <div class="article-meta">
        <span class="article-domain">${domain}</span>
        <span class="article-date">${date}</span>
        ${highlightCount > 0 ? `<span class="highlight-count">${highlightCount}</span>` : ''}
      </div>
      ${article.excerpt ? `<div class="article-excerpt">${escapeHtml(article.excerpt)}</div>` : ''}
    </div>
    <div class="article-actions">
      <button class="action-btn favorite ${article.isFavorite ? 'is-favorite' : ''}" title="${article.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${article.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="action-btn toggle-read" title="${article.isRead ? 'Move to Read Later' : 'Mark as Read'}">
        ${article.isRead ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'}
      </button>
      <button class="action-btn delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `;

  // Click card to open article in new tab
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.article-actions')) {
      window.open(article.url, '_blank');
    }
  });

  // Toggle favorite
  card.querySelector('.favorite').addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_FAVORITE',
      articleId: article.id
    });
    loadArticles();
  });

  // Toggle read status
  card.querySelector('.toggle-read').addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_READ',
      articleId: article.id
    });
    loadArticles();
  });

  // Delete article
  card.querySelector('.delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Delete this article and its highlights?')) {
      await chrome.runtime.sendMessage({
        type: 'DELETE_ARTICLE',
        articleId: article.id
      });
      loadArticles();
    }
  });

  return card;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderHighlights() {
  const container = document.getElementById('highlights-list');
  const emptyState = document.getElementById('highlights-empty');
  container.innerHTML = '';

  // Group highlights by article URL
  let groupedHighlights = {};
  for (const url in allHighlights) {
    const article = allArticles.find(a => a.url === url);
    const highlights = allHighlights[url] || [];

    // Apply search filter to individual highlights
    let filteredHighlights = highlights;
    if (currentSearchQuery) {
      filteredHighlights = highlights.filter(h => {
        const text = (h.text || '').toLowerCase();
        const title = (article?.title || getDomain(url)).toLowerCase();
        return text.includes(currentSearchQuery) || title.includes(currentSearchQuery);
      });
    }

    if (filteredHighlights.length > 0) {
      // Sort highlights within group by date
      const sortedHighlights = [...filteredHighlights].sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return currentSort === 'newest' ? dateB - dateA : dateA - dateB;
      });

      // Get the most recent highlight date for group sorting
      const latestDate = currentSort === 'newest'
        ? sortedHighlights[0].createdAt
        : sortedHighlights[sortedHighlights.length - 1].createdAt;

      groupedHighlights[url] = {
        url,
        articleTitle: article?.title || getDomain(url),
        articleFavicon: article?.favicon || `https://www.google.com/s2/favicons?domain=${getDomain(url)}&sz=64`,
        highlights: sortedHighlights,
        latestDate
      };
    }
  }

  // Convert to array and sort groups by latest highlight date
  const groups = Object.values(groupedHighlights).sort((a, b) => {
    const dateA = new Date(a.latestDate);
    const dateB = new Date(b.latestDate);
    return currentSort === 'newest' ? dateB - dateA : dateA - dateB;
  });

  // Show empty state if no highlights
  emptyState.classList.toggle('visible', groups.length === 0);

  // Render grouped highlights
  groups.forEach(group => {
    const card = createGroupedHighlightCard(group);
    container.appendChild(card);
  });
}

function createGroupedHighlightCard(group) {
  const card = document.createElement('div');
  card.className = 'highlight-group-card';

  const domain = getDomain(group.url);

  // Build highlights HTML
  const highlightsHtml = group.highlights.map(h => `
    <div class="highlight-item" data-highlight-id="${h.id}">
      <div class="highlight-text">"${escapeHtml(h.text)}"</div>
      <div class="highlight-item-meta">
        <span class="highlight-item-date">${formatDate(h.createdAt)}</span>
        <button class="action-btn delete" title="Delete highlight">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="highlight-group-header">
      <img class="highlight-favicon" src="${group.articleFavicon}" alt="" onerror="this.style.display='none'">
      <span class="highlight-article-title">${escapeHtml(group.articleTitle)}</span>
      <span class="highlight-domain">${domain}</span>
      <span class="highlight-count">${group.highlights.length}</span>
      <button class="action-btn open" title="Open article">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
    <div class="highlight-group-items">
      ${highlightsHtml}
    </div>
  `;

  // Open article
  card.querySelector('.highlight-group-header .open').addEventListener('click', () => {
    window.open(group.url, '_blank');
  });

  // Delete individual highlights
  card.querySelectorAll('.highlight-item .delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const highlightId = e.target.closest('.highlight-item').dataset.highlightId;
      await chrome.runtime.sendMessage({
        type: 'DELETE_HIGHLIGHT',
        url: group.url,
        highlightId: highlightId
      });
      loadArticles();
    });
  });

  return card;
}

// Export data to JSON file
async function exportData() {
  const exportDate = new Date().toISOString();
  const data = {
    version: 1,
    exportedAt: exportDate,
    articles: allArticles,
    highlights: allHighlights
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `reader-backup-${exportDate.split('T')[0]}.json`;
  a.click();

  URL.revokeObjectURL(url);

  // Save last export date
  await chrome.storage.local.set({ lastExportDate: exportDate });
  loadLastExportDate();
}

// Import data from JSON file
async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.version || !data.articles) {
      alert('Invalid backup file format.');
      return;
    }

    // Confirm import
    const articleCount = data.articles?.length || 0;
    const highlightCount = Object.values(data.highlights || {}).reduce((sum, h) => sum + h.length, 0);

    if (!confirm(`Import ${articleCount} articles and ${highlightCount} highlights?\n\nThis will replace your current data.`)) {
      return;
    }

    // Save to storage
    await chrome.storage.local.set({
      articles: data.articles || [],
      highlights: data.highlights || {}
    });

    // Reload
    await loadArticles();
    alert('Import successful!');

  } catch (err) {
    alert('Failed to import: ' + err.message);
  }

  // Reset file input
  e.target.value = '';
}
