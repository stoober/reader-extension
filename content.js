// Content script for highlighting functionality

(function() {
  // Avoid running multiple times
  if (window.__readerHighlighterLoaded) return;
  window.__readerHighlighterLoaded = true;

  let tooltip = null;
  let currentSelection = null;
  let isPageSaved = false;

  // Create highlight tooltip
  function createTooltip() {
    const div = document.createElement('div');
    div.className = 'reader-highlight-tooltip';
    div.innerHTML = '<button class="reader-highlight-btn">Highlight</button>';
    div.style.display = 'none';
    document.body.appendChild(div);

    div.querySelector('.reader-highlight-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveHighlight();
      hideTooltip();
    });

    return div;
  }

  function showTooltip(x, y) {
    if (!tooltip) {
      tooltip = createTooltip();
    }
    tooltip.style.display = 'block';
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.style.display = 'none';
    }
    currentSelection = null;
  }

  // Get surrounding context for more reliable matching
  function getTextContext(range, contextChars = 50) {
    const container = range.commonAncestorContainer;
    const element = container.nodeType === 3 ? container.parentElement : container;

    // Get the full text content of a reasonable ancestor
    let ancestor = element;
    for (let i = 0; i < 3 && ancestor.parentElement && ancestor.parentElement !== document.body; i++) {
      ancestor = ancestor.parentElement;
    }

    const fullText = ancestor.textContent;
    const selectedText = range.toString();

    // Find the position of selected text within ancestor
    const textBefore = range.startContainer.textContent.substring(0, range.startOffset);

    // Walk backwards to find context before selection
    let prefixContext = '';
    let node = range.startContainer;
    let accumulated = textBefore;

    const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    const startIndex = textNodes.indexOf(range.startContainer);
    if (startIndex > 0) {
      for (let i = startIndex - 1; i >= 0 && accumulated.length < contextChars; i--) {
        accumulated = textNodes[i].textContent + accumulated;
      }
    }
    prefixContext = accumulated.slice(-contextChars);

    // Get context after selection
    let suffixContext = '';
    accumulated = range.endContainer.textContent.substring(range.endOffset);
    const endIndex = textNodes.indexOf(range.endContainer);
    if (endIndex < textNodes.length - 1) {
      for (let i = endIndex + 1; i < textNodes.length && accumulated.length < contextChars; i++) {
        accumulated = accumulated + textNodes[i].textContent;
      }
    }
    suffixContext = accumulated.slice(0, contextChars);

    return {
      text: selectedText,
      prefix: prefixContext,
      suffix: suffixContext
    };
  }

  // Find text in document using context matching
  function findTextWithContext(highlight) {
    const { text, prefix, suffix } = highlight;

    // Create a tree walker to iterate through all text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    // Build full document text with node mapping
    let fullText = '';
    const nodeMap = []; // Maps character positions to {node, offset}

    for (const node of textNodes) {
      const startPos = fullText.length;
      fullText += node.textContent;
      for (let i = 0; i < node.textContent.length; i++) {
        nodeMap.push({ node, offset: i });
      }
    }

    // Search strategies in order of reliability
    const searchStrategies = [
      // 1. Exact match with both prefix and suffix
      () => {
        if (prefix && suffix) {
          const searchStr = prefix + text + suffix;
          const pos = fullText.indexOf(searchStr);
          if (pos !== -1) {
            return { start: pos + prefix.length, end: pos + prefix.length + text.length };
          }
        }
        return null;
      },
      // 2. Match with prefix only
      () => {
        if (prefix) {
          const searchStr = prefix + text;
          const pos = fullText.indexOf(searchStr);
          if (pos !== -1) {
            return { start: pos + prefix.length, end: pos + prefix.length + text.length };
          }
        }
        return null;
      },
      // 3. Match with suffix only
      () => {
        if (suffix) {
          const searchStr = text + suffix;
          const pos = fullText.indexOf(searchStr);
          if (pos !== -1) {
            return { start: pos, end: pos + text.length };
          }
        }
        return null;
      },
      // 4. Exact text match (first occurrence)
      () => {
        const pos = fullText.indexOf(text);
        if (pos !== -1) {
          return { start: pos, end: pos + text.length };
        }
        return null;
      },
      // 5. Normalized whitespace match
      () => {
        const normalizedText = text.replace(/\s+/g, ' ').trim();
        const normalizedFull = fullText.replace(/\s+/g, ' ');
        const pos = normalizedFull.indexOf(normalizedText);
        if (pos !== -1) {
          // Map back to original position (approximate)
          let origPos = 0;
          let normPos = 0;
          while (normPos < pos && origPos < fullText.length) {
            if (/\s/.test(fullText[origPos])) {
              while (origPos < fullText.length && /\s/.test(fullText[origPos])) origPos++;
              normPos++;
            } else {
              origPos++;
              normPos++;
            }
          }
          return { start: origPos, end: origPos + text.length };
        }
        return null;
      }
    ];

    for (const strategy of searchStrategies) {
      const result = strategy();
      if (result && nodeMap[result.start] && nodeMap[result.end - 1]) {
        const startInfo = nodeMap[result.start];
        const endInfo = nodeMap[result.end - 1];

        try {
          const range = document.createRange();
          range.setStart(startInfo.node, startInfo.offset);
          range.setEnd(endInfo.node, endInfo.offset + 1);

          // Verify the range contains roughly the right text
          const rangeText = range.toString();
          if (rangeText === text || rangeText.replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim()) {
            return range;
          }
        } catch (e) {
          // Continue to next strategy
        }
      }
    }

    return null;
  }

  // Save highlight to storage
  async function saveHighlight() {
    if (!currentSelection) return;

    const { text, range } = currentSelection;
    const context = getTextContext(range);

    // Save to storage via background script and get the ID back
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_HIGHLIGHT',
      url: window.location.href,
      text: context.text,
      prefix: context.prefix,
      suffix: context.suffix
    });

    // Apply highlight visually with the ID so delete works immediately
    const highlightId = response?.highlightId;
    applyHighlight(range, highlightId);

    // Clear selection
    window.getSelection().removeAllRanges();
  }

  // Apply highlight styling to a range using mark elements for each text node
  function applyHighlight(range, highlightId) {
    // Get all text nodes within the range
    const textNodes = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    let inRange = false;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) inRange = true;
      if (inRange) textNodes.push(node);
      if (node === range.endContainer) break;
    }

    // If no text nodes found, try direct approach
    if (textNodes.length === 0 && range.startContainer.nodeType === 3) {
      textNodes.push(range.startContainer);
    }

    const marks = [];

    for (const textNode of textNodes) {
      const isStart = textNode === range.startContainer;
      const isEnd = textNode === range.endContainer;

      let startOffset = isStart ? range.startOffset : 0;
      let endOffset = isEnd ? range.endOffset : textNode.textContent.length;

      // Skip if nothing to highlight in this node
      if (startOffset >= endOffset) continue;

      const text = textNode.textContent;
      const before = text.substring(0, startOffset);
      const highlighted = text.substring(startOffset, endOffset);
      const after = text.substring(endOffset);

      // Create mark element
      const mark = document.createElement('mark');
      mark.className = 'reader-highlight';
      if (highlightId) {
        mark.dataset.highlightId = highlightId;
      }
      mark.textContent = highlighted;

      // Replace the text node with before + mark + after
      const parent = textNode.parentNode;
      const fragment = document.createDocumentFragment();

      if (before) {
        fragment.appendChild(document.createTextNode(before));
      }
      fragment.appendChild(mark);
      if (after) {
        fragment.appendChild(document.createTextNode(after));
      }

      parent.replaceChild(fragment, textNode);
      marks.push(mark);

      // Add click handler to delete highlight
      if (highlightId) {
        mark.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showDeleteTooltip(mark, highlightId, e.clientX, e.clientY);
        });
      }
    }

    return marks;
  }

  // Delete tooltip for existing highlights
  let deleteTooltip = null;

  function showDeleteTooltip(highlightSpan, highlightId, x, y) {
    hideDeleteTooltip();

    deleteTooltip = document.createElement('div');
    deleteTooltip.className = 'reader-highlight-tooltip reader-delete-tooltip';
    deleteTooltip.innerHTML = '<button class="reader-highlight-btn reader-delete-btn">Remove</button>';
    deleteTooltip.style.left = `${x + window.scrollX - 35}px`;
    deleteTooltip.style.top = `${y + window.scrollY - 40}px`;
    document.body.appendChild(deleteTooltip);

    deleteTooltip.querySelector('.reader-delete-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      await chrome.runtime.sendMessage({
        type: 'DELETE_HIGHLIGHT',
        url: window.location.href,
        highlightId: highlightId
      });

      // Remove ALL mark elements with this highlightId (highlights can span multiple nodes)
      const allMarks = document.querySelectorAll(`mark.reader-highlight[data-highlight-id="${highlightId}"]`);
      allMarks.forEach(mark => {
        const text = mark.textContent;
        mark.replaceWith(text);
      });

      hideDeleteTooltip();
    });
  }

  function hideDeleteTooltip() {
    if (deleteTooltip) {
      deleteTooltip.remove();
      deleteTooltip = null;
    }
  }

  // Restore highlights from storage
  async function restoreHighlights() {
    // Wait a bit for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 500));

    const response = await chrome.runtime.sendMessage({
      type: 'GET_HIGHLIGHTS',
      url: window.location.href
    });

    const highlights = response.highlights || [];

    for (const highlight of highlights) {
      try {
        const range = findTextWithContext(highlight);
        if (range) {
          applyHighlight(range, highlight.id);
        }
      } catch (e) {
        console.log('Could not restore highlight:', e);
      }
    }
  }

  // Handle text selection - only show highlight option on saved pages
  document.addEventListener('mouseup', (e) => {
    // Ignore clicks on our tooltip
    if (e.target.closest('.reader-highlight-tooltip')) return;

    // Only allow highlighting on saved pages
    if (!isPageSaved) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 0) {
      const range = selection.getRangeAt(0);

      currentSelection = { text, range: range.cloneRange() };
      // Position tooltip near mouse cursor
      showTooltip(
        e.pageX - 40,
        e.pageY - 50
      );
    } else {
      hideTooltip();
    }
  });

  // Hide tooltip when clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.reader-highlight-tooltip')) {
      hideTooltip();
      hideDeleteTooltip();
    }
  });

  // Hide tooltip on scroll
  document.addEventListener('scroll', () => {
    hideTooltip();
    hideDeleteTooltip();
  }, true);

  // Check if page is saved and initialize
  async function init() {
    // Check if this page is saved
    const response = await chrome.runtime.sendMessage({
      type: 'IS_PAGE_SAVED',
      url: window.location.href
    });
    isPageSaved = response?.isSaved || false;

    // Restore any existing highlights
    await restoreHighlights();
  }

  // Listen for storage changes to update isPageSaved in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.articles) {
      const articles = changes.articles.newValue || [];
      isPageSaved = articles.some(a => a.url === window.location.href);
    }
  });

  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
