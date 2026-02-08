/**
 * Markaround - Application Logic
 *
 * Classic script (not a module) — works on file:// and http://.
 * CodeMirror editor is loaded separately via editor-loader.js (ES module).
 * When that module loads, it sets window.CriticEditor and fires 'editor-ready'.
 * Until then (or if it fails), the app works as a preview-only viewer.
 */
(function () {
  'use strict';

  // --- Autosave (inlined to avoid module dependency) ---
  var Autosave = (function () {
    var PREFIX = 'markaround-autosave-';
    var timer = null;
    var dirty = false;
    var currentKey = null;
    var getSource = null;

    function start(fileName, sourceFn) {
      stop();
      currentKey = PREFIX + (fileName || 'document.md');
      getSource = sourceFn;
      dirty = false;
      timer = setInterval(function () {
        if (dirty && getSource) {
          var source = getSource();
          if (source) {
            try {
              localStorage.setItem(currentKey, JSON.stringify({ source: source, timestamp: Date.now() }));
            } catch (e) { /* quota exceeded, ignore */ }
          }
          dirty = false;
        }
      }, 3000);
    }

    function markDirty() { dirty = true; }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      dirty = false; currentKey = null; getSource = null;
    }

    function check(fileName) {
      var key = PREFIX + (fileName || 'document.md');
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        var data = JSON.parse(raw);
        if (data && data.source && data.timestamp) return data;
      } catch (e) { /* ignore */ }
      return null;
    }

    function clear(fileName) {
      localStorage.removeItem(PREFIX + (fileName || 'document.md'));
    }

    return { start: start, markDirty: markDirty, stop: stop, check: check, clear: clear };
  })();

  // --- State ---
  var state = {
    source: '',
    fileName: 'document.md',
  };

  // --- Editor (set when editor-loader.js fires 'editor-ready') ---
  var Editor = null; // window.CriticEditor
  var editorView = null;
  var suggestionModeActive = false;
  var lastFallbackSelection = { start: 0, end: 0 }; // persists across focus loss

  // --- Markdown-it Setup ---
  var md = window.markdownit({ html: false, linkify: true, typographer: true });
  md.use(window.criticmarkupPlugin);

  // --- DOM References ---
  var dropZone = document.getElementById('dropZone');
  var inputArea = document.getElementById('inputArea');
  var mainLayout = document.getElementById('mainLayout');
  var editorContainer = document.getElementById('editorContainer');
  var renderedView = document.getElementById('renderedView');
  var previewPane = document.getElementById('previewPane');
  var commentSidebar = document.getElementById('commentSidebar');
  var suggestionCount = document.getElementById('suggestionCount');
  var filePicker = document.getElementById('filePicker');
  var fileBar = document.getElementById('fileBar');
  var fileBarName = document.getElementById('fileBarName');
  var resizeHandle = document.getElementById('resizeHandle');

  var btnAcceptAll = document.getElementById('btnAcceptAll');
  var btnRejectAll = document.getElementById('btnRejectAll');
  var btnDownload = document.getElementById('btnDownload');
  var btnLoadFile = document.getElementById('btnLoadFile');
  var btnLoadSample = document.getElementById('btnLoadSample');
  var btnNewFile = document.getElementById('btnNewFile');
  var btnPasteNew = document.getElementById('btnPasteNew');
  var btnSuggestionMode = document.getElementById('btnSuggestionMode');
  var btnAddComment = document.getElementById('btnAddComment');

  var btnLayoutBoth = document.getElementById('btnLayoutBoth');
  var btnLayoutEditor = document.getElementById('btnLayoutEditor');
  var btnLayoutPreview = document.getElementById('btnLayoutPreview');

  var renderTimer = null;
  var currentLayout = 'both';

  // --- Sample Content ---
  var SAMPLE = '# CriticMarkup Demo\n\nThis is a sample document demonstrating {++all five types of++} CriticMarkup.\n\n## Tracked Changes\n\nHere is some text that has {--been carelessly--} written and needs editing.\n\nThe word {~~colour~>color~~} was changed to American English.\n\n{++This entire paragraph was added during review. It contains **bold** and *italic* text to show that markdown renders inside additions.++}\n\n## Comments and Highlights\n\nThis is {==an important claim==}{>>Do we have a source for this? Needs citation.<<} that reviewers flagged.\n\nAnother paragraph with a {>>Nice work on this section!<<} comment.\n\n## Multiple Changes Per Line\n\nNormal text {++with an addition++} and {--a deletion--} on the same line, plus a {~~typo~>correction~~}.\n\n## Edge Cases\n\n{++First++} word addition. Last word {--deletion--}.\n\nA paragraph with {++multiple++} additions of the {++same word++} to test offset tracking.\n';

  // --- Render Pipeline ---
  function render() {
    var html = md.render(state.source);
    renderedView.innerHTML = html;
    updateSuggestionCount();
    updateToolbar();
    positionComments();
  }

  function debouncedRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  function updateSuggestionCount() {
    var RE_ALL = /\{\+\+[\s\S]+?\+\+\}|\{--[\s\S]+?--\}|\{~~[\s\S]+?~>[\s\S]+?~~\}|\{>>[\s\S]+?<<\}|\{==[\s\S]+?==\}/g;
    var matches = state.source.match(RE_ALL);
    var count = matches ? matches.length : 0;
    if (count > 0) {
      suggestionCount.textContent = count + ' suggestion' + (count !== 1 ? 's' : '');
      suggestionCount.classList.add('visible');
    } else {
      suggestionCount.classList.remove('visible');
    }
  }

  function updateToolbar() {
    var hasContent = state.source.length > 0;
    var hasSuggestions = suggestionCount.classList.contains('visible');
    btnAcceptAll.disabled = !hasSuggestions;
    btnRejectAll.disabled = !hasSuggestions;
    btnDownload.disabled = !hasContent;
    // Suggest/Comment work with CM6 or fallback textarea
    var editorAvailable = hasContent && (editorView || fallbackTextarea);
    btnSuggestionMode.disabled = !editorAvailable || currentLayout === 'preview-only';
    // Comment needs a selection in either CM6 or fallback
    var hasSel = false;
    if (editorView && Editor) {
      hasSel = Editor.hasSelection(editorView);
    } else if (fallbackTextarea) {
      hasSel = fallbackTextarea.selectionStart !== fallbackTextarea.selectionEnd;
    }
    btnAddComment.disabled = !(editorAvailable && hasSel);
  }

  // --- Comment Sidebar ---
  function positionComments() {
    commentSidebar.innerHTML = '';
    var markers = renderedView.querySelectorAll('.critic-comment-marker');

    if (markers.length === 0) return;

    var sidebarRect = commentSidebar.getBoundingClientRect();
    var lastBottom = 0;

    markers.forEach(function (marker, i) {
      var id = 'comment-' + i;
      marker.setAttribute('data-comment-id', id);

      var card = document.createElement('div');
      card.className = 'comment-card';
      card.setAttribute('data-comment-id', id);

      var text = marker.getAttribute('data-comment-text') || '';
      card.innerHTML = '<div class="comment-text">' + md.utils.escapeHtml(text) + '</div>'
        + '<div class="comment-actions">'
        + '<button class="comment-resolve" data-comment-id="' + id + '" title="Remove comment">Remove</button>'
        + '</div>';

      commentSidebar.appendChild(card);

      var markerRect = marker.getBoundingClientRect();
      var targetTop = markerRect.top - sidebarRect.top + commentSidebar.scrollTop;
      targetTop = Math.max(targetTop, lastBottom + 8);
      card.style.top = targetTop + 'px';
      lastBottom = targetTop + card.offsetHeight;

      marker.addEventListener('mouseenter', function () { card.classList.add('highlight'); });
      marker.addEventListener('mouseleave', function () { card.classList.remove('highlight'); });
      card.addEventListener('mouseenter', function () { marker.style.transform = 'scale(1.5)'; });
      card.addEventListener('mouseleave', function () { marker.style.transform = ''; });
    });
  }

  // --- Accept / Reject ---
  function acceptMarkup(originalMarkup) {
    var match;
    if ((match = originalMarkup.match(/^\{\+\+([\s\S]+?)\+\+\}$/))) return match[1];
    if ((match = originalMarkup.match(/^\{--([\s\S]+?)--\}$/))) return '';
    if ((match = originalMarkup.match(/^\{~~[\s\S]+?~>([\s\S]+?)~~\}$/))) return match[1];
    if ((match = originalMarkup.match(/^\{>>([\s\S]+?)<<\}$/))) return '';
    if ((match = originalMarkup.match(/^\{==([\s\S]+?)==\}$/))) return match[1];
    return originalMarkup;
  }

  function rejectMarkup(originalMarkup) {
    var match;
    if ((match = originalMarkup.match(/^\{\+\+([\s\S]+?)\+\+\}$/))) return '';
    if ((match = originalMarkup.match(/^\{--([\s\S]+?)--\}$/))) return match[1];
    if ((match = originalMarkup.match(/^\{~~([\s\S]+?)~>[\s\S]+?~~\}$/))) return match[1];
    if ((match = originalMarkup.match(/^\{>>([\s\S]+?)<<\}$/))) return '';
    if ((match = originalMarkup.match(/^\{==([\s\S]+?)==\}$/))) return match[1];
    return originalMarkup;
  }

  function acceptAll() {
    state.source = state.source
      .replace(/\{\+\+([\s\S]+?)\+\+\}/g, '$1')
      .replace(/\{--([\s\S]+?)--\}/g, '')
      .replace(/\{~~[\s\S]+?~>([\s\S]+?)~~\}/g, '$1')
      .replace(/\{>>([\s\S]+?)<<\}/g, '')
      .replace(/\{==([\s\S]+?)==\}/g, '$1');
    render();
    syncEditorIfNeeded();
  }

  function rejectAll() {
    state.source = state.source
      .replace(/\{\+\+([\s\S]+?)\+\+\}/g, '')
      .replace(/\{--([\s\S]+?)--\}/g, '$1')
      .replace(/\{~~([\s\S]+?)~>[\s\S]+?~~\}/g, '$1')
      .replace(/\{>>([\s\S]+?)<<\}/g, '')
      .replace(/\{==([\s\S]+?)==\}/g, '$1');
    render();
    syncEditorIfNeeded();
  }

  function handleAcceptReject(button, accept) {
    var el = button.closest('[data-markup]');
    if (!el) return;

    var markup = el.getAttribute('data-markup')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    var offset = parseInt(el.getAttribute('data-offset'), 10);
    var replacement = accept ? acceptMarkup(markup) : rejectMarkup(markup);

    if (state.source.substr(offset, markup.length) === markup) {
      state.source = state.source.slice(0, offset) + replacement + state.source.slice(offset + markup.length);
    } else {
      var idx = state.source.indexOf(markup);
      if (idx !== -1) {
        state.source = state.source.slice(0, idx) + replacement + state.source.slice(idx + markup.length);
      }
    }

    render();
    syncEditorIfNeeded();
    Autosave.markDirty();
  }

  function syncEditorIfNeeded() {
    if (editorView && Editor) {
      Editor.syncEditorFromState(editorView, state.source);
    } else {
      syncFallbackTextarea();
    }
  }

  // --- Editor Callback ---
  function onEditorUpdate(newDoc) {
    state.source = newDoc;
    Autosave.markDirty();
    debouncedRender();
  }

  // --- Inside-Markup Detection (for suggestion mode) ---
  function isInsideMarkup(text, pos) {
    var chunk = text.substring(Math.max(0, pos - 500), pos);
    var lo, lc;
    lo = chunk.lastIndexOf('{++'); lc = chunk.lastIndexOf('++}');
    if (lo !== -1 && (lc === -1 || lo > lc)) return true;
    lo = chunk.lastIndexOf('{--'); lc = chunk.lastIndexOf('--}');
    if (lo !== -1 && (lc === -1 || lo > lc)) return true;
    lo = chunk.lastIndexOf('{~~'); lc = chunk.lastIndexOf('~~}');
    if (lo !== -1 && (lc === -1 || lo > lc)) return true;
    lo = chunk.lastIndexOf('{>>'); lc = chunk.lastIndexOf('<<}');
    if (lo !== -1 && (lc === -1 || lo > lc)) return true;
    return false;
  }

  // --- Fallback Textarea (used when CodeMirror can't load) ---
  var fallbackTextarea = null;
  var suggestionApplying = false; // guard against re-entrant beforeinput from execCommand

  // Use execCommand to insert text so the browser's native undo stack tracks it.
  // Select the range to replace, then execCommand('insertText') replaces it.
  function suggestionExec(replaceStart, replaceEnd, text, cursorPos) {
    suggestionApplying = true;
    fallbackTextarea.focus();
    fallbackTextarea.selectionStart = replaceStart;
    fallbackTextarea.selectionEnd = replaceEnd;
    document.execCommand('insertText', false, text);
    fallbackTextarea.selectionStart = fallbackTextarea.selectionEnd = cursorPos;
    suggestionApplying = false;
    // execCommand fires 'input', which syncs state.source via the input handler
  }

  function createFallbackTextarea() {
    if (fallbackTextarea) return;
    fallbackTextarea = document.createElement('textarea');
    fallbackTextarea.className = 'fallback-editor';
    fallbackTextarea.value = state.source;

    // Sync state on any input (normal edits + execCommand-driven suggestion edits)
    fallbackTextarea.addEventListener('input', function () {
      state.source = fallbackTextarea.value;
      Autosave.markDirty();
      debouncedRender();
    });

    // Suggestion mode: intercept edits via beforeinput
    fallbackTextarea.addEventListener('beforeinput', function (e) {
      if (!suggestionModeActive || suggestionApplying) return;

      var val = fallbackTextarea.value;
      var selStart = fallbackTextarea.selectionStart;
      var selEnd = fallbackTextarea.selectionEnd;
      var selected = val.substring(selStart, selEnd);

      // Don't wrap if inside existing markup
      if (isInsideMarkup(val, selStart)) return;

      var type = e.inputType;
      var data = e.data || '';

      if (type === 'insertText' || type === 'insertFromPaste' || type === 'insertFromDrop') {
        e.preventDefault();
        if (selected) {
          // Replace selection -> substitution
          var wrapped = '{~~' + selected + '~>' + data + '~~}';
          suggestionExec(selStart, selEnd, wrapped, selStart + wrapped.length);
        } else {
          // Pure insertion -> addition, cursor inside before ++}
          var wrapped = '{++' + data + '++}';
          suggestionExec(selStart, selEnd, wrapped, selStart + 3 + data.length);
        }
      } else if (type === 'deleteContentBackward') {
        e.preventDefault();
        if (selected) {
          var wrapped = '{--' + selected + '--}';
          suggestionExec(selStart, selEnd, wrapped, selStart + wrapped.length);
        } else if (selStart > 0) {
          // Wrap the one character before cursor as deletion
          var ch = val.charAt(selStart - 1);
          var wrapped = '{--' + ch + '--}';
          suggestionExec(selStart - 1, selStart, wrapped, selStart - 1 + wrapped.length);
        }
      } else if (type === 'deleteContentForward') {
        e.preventDefault();
        if (selected) {
          var wrapped = '{--' + selected + '--}';
          suggestionExec(selStart, selEnd, wrapped, selStart + wrapped.length);
        } else if (selStart < val.length) {
          var ch = val.charAt(selStart);
          var wrapped = '{--' + ch + '--}';
          suggestionExec(selStart, selStart + 1, wrapped, selStart + wrapped.length);
        }
      }
      // Other input types fall through to normal handling
    });

    // Track selection so it survives focus loss (e.g. clicking Comment button)
    function trackSelection() {
      lastFallbackSelection.start = fallbackTextarea.selectionStart;
      lastFallbackSelection.end = fallbackTextarea.selectionEnd;
    }
    fallbackTextarea.addEventListener('select', trackSelection);
    fallbackTextarea.addEventListener('keyup', trackSelection);
    fallbackTextarea.addEventListener('mouseup', trackSelection);

    editorContainer.appendChild(fallbackTextarea);
  }

  function syncFallbackTextarea() {
    if (fallbackTextarea) {
      fallbackTextarea.value = state.source;
    }
  }

  function removeFallbackTextarea() {
    if (fallbackTextarea) {
      fallbackTextarea.remove();
      fallbackTextarea = null;
    }
  }

  // --- Setup editor pane (CM6 if available, textarea fallback otherwise) ---
  function setupEditorPane() {
    if (Editor) {
      removeFallbackTextarea();
      if (!editorView) {
        editorView = Editor.createEditor(editorContainer, state.source, onEditorUpdate);
      } else {
        Editor.syncEditorFromState(editorView, state.source);
      }
    } else {
      // Fallback: plain textarea
      if (!fallbackTextarea) {
        createFallbackTextarea();
      } else {
        syncFallbackTextarea();
      }
    }
  }

  // --- Input Handling ---
  function loadContent(text, fileName) {
    state.source = text;
    state.fileName = fileName || 'document.md';
    dropZone.hidden = true;
    mainLayout.hidden = false;
    fileBar.hidden = false;
    fileBarName.textContent = state.fileName;

    // Check for autosave
    var saved = Autosave.check(state.fileName);
    if (saved && saved.source !== text) {
      var date = new Date(saved.timestamp);
      var when = date.toLocaleString();
      if (confirm('Autosaved version from ' + when + ' found. Restore it?')) {
        state.source = saved.source;
      }
    }

    setupEditorPane();
    render();
    Autosave.start(state.fileName, function () { return state.source; });
    updateToolbar();
  }

  function showDropZone() {
    dropZone.hidden = false;
    mainLayout.hidden = true;
    fileBar.hidden = true;
    inputArea.value = '';
    inputArea.focus();
    Autosave.stop();

    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
    removeFallbackTextarea();
  }

  // --- Layout Modes ---
  function setLayout(mode) {
    currentLayout = mode;
    mainLayout.className = 'main-layout layout-' + mode;

    btnLayoutBoth.classList.toggle('active', mode === 'both');
    btnLayoutEditor.classList.toggle('active', mode === 'editor-only');
    btnLayoutPreview.classList.toggle('active', mode === 'preview-only');

    // Auto-disable suggestion mode in preview-only
    if (mode === 'preview-only' && suggestionModeActive) {
      suggestionModeActive = false;
      if (editorView && Editor) Editor.setSuggestionMode(editorView, false);
      btnSuggestionMode.classList.remove('active');
    }

    if (mode !== 'editor-only') {
      render();
    }
  }

  btnLayoutBoth.addEventListener('click', function () { setLayout('both'); });
  btnLayoutEditor.addEventListener('click', function () { setLayout('editor-only'); });
  btnLayoutPreview.addEventListener('click', function () { setLayout('preview-only'); });

  // --- Suggestion Mode Toggle ---
  btnSuggestionMode.addEventListener('click', function () {
    if (currentLayout === 'preview-only') return;

    if (editorView && Editor) {
      // CM6 mode
      var current = Editor.isSuggestionMode(editorView);
      Editor.setSuggestionMode(editorView, !current);
      suggestionModeActive = !current;
    } else if (fallbackTextarea) {
      // Fallback textarea mode
      suggestionModeActive = !suggestionModeActive;
    } else {
      return;
    }
    btnSuggestionMode.classList.toggle('active', suggestionModeActive);
  });

  // --- Comment Button ---
  btnAddComment.addEventListener('click', function () {
    if (editorView && Editor) {
      Editor.addComment(editorView);
    } else if (fallbackTextarea) {
      // Fallback: insert comment after selection (use saved selection since click stole focus)
      var selStart = lastFallbackSelection.start;
      var selEnd = lastFallbackSelection.end;
      if (selStart === selEnd) return;
      var commentText = prompt('Enter comment:');
      if (commentText === null) return;
      var val = fallbackTextarea.value;
      var insertion = '{>>' + commentText + '<<}';
      fallbackTextarea.value = val.substring(0, selEnd) + insertion + val.substring(selEnd);
      fallbackTextarea.selectionStart = fallbackTextarea.selectionEnd = selEnd + insertion.length;
      state.source = fallbackTextarea.value;
      Autosave.markDirty();
      fallbackTextarea.focus();
      render();
    }
  });

  // Update comment button enabled state
  function pollCommentButton() {
    var hasSel = false;
    if (editorView && Editor) {
      hasSel = Editor.hasSelection(editorView);
    } else if (fallbackTextarea) {
      hasSel = lastFallbackSelection.start !== lastFallbackSelection.end;
    }
    btnAddComment.disabled = !hasSel;
    requestAnimationFrame(pollCommentButton);
  }
  requestAnimationFrame(pollCommentButton);

  // --- Drag and Drop ---
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', function (e) {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('dragover');
    }
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    var file = e.dataTransfer.files[0];
    if (file) {
      var reader = new FileReader();
      reader.onload = function () { loadContent(reader.result, file.name); };
      reader.readAsText(file);
    }
  });

  // Drop on main layout when content is loaded
  mainLayout.addEventListener('dragover', function (e) { e.preventDefault(); });
  mainLayout.addEventListener('drop', function (e) {
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    if (file) {
      var reader = new FileReader();
      reader.onload = function () { loadContent(reader.result, file.name); };
      reader.readAsText(file);
    }
  });

  // --- Textarea Input ---
  inputArea.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (inputArea.value.trim()) {
        loadContent(inputArea.value);
      }
    }
  });

  inputArea.addEventListener('paste', function () {
    setTimeout(function () {
      var text = inputArea.value.trim();
      if (text && /\{\+\+|\{--|\{~~|\{>>|\{==/.test(text)) {
        loadContent(text);
      }
    }, 50);
  });

  // --- File Picker ---
  function openFilePicker() { filePicker.click(); }
  function handleFileSelect() {
    var file = filePicker.files[0];
    if (file) {
      var reader = new FileReader();
      reader.onload = function () { loadContent(reader.result, file.name); };
      reader.readAsText(file);
      filePicker.value = '';
    }
  }

  btnLoadFile.addEventListener('click', openFilePicker);
  btnNewFile.addEventListener('click', openFilePicker);
  filePicker.addEventListener('change', handleFileSelect);

  btnLoadSample.addEventListener('click', function () {
    loadContent(SAMPLE, 'sample.md');
  });

  btnPasteNew.addEventListener('click', showDropZone);

  // --- Toolbar ---
  btnAcceptAll.addEventListener('click', acceptAll);
  btnRejectAll.addEventListener('click', rejectAll);

  btnDownload.addEventListener('click', function () {
    Autosave.clear(state.fileName);
    var blob = new Blob([state.source], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = state.fileName;
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- Event Delegation for Accept/Reject ---
  renderedView.addEventListener('click', function (e) {
    var acceptBtn = e.target.closest('.critic-accept');
    var rejectBtn = e.target.closest('.critic-reject');
    if (acceptBtn) {
      e.preventDefault();
      handleAcceptReject(acceptBtn, true);
    } else if (rejectBtn) {
      e.preventDefault();
      handleAcceptReject(rejectBtn, false);
    }
  });

  // --- Comment Sidebar Resolve ---
  commentSidebar.addEventListener('click', function (e) {
    var resolveBtn = e.target.closest('.comment-resolve');
    if (resolveBtn) {
      var commentId = resolveBtn.getAttribute('data-comment-id');
      var marker = renderedView.querySelector('[data-comment-id="' + commentId + '"]');
      if (marker) {
        handleAcceptReject(marker.querySelector('.critic-accept') || marker, true);
      }
    }
  });

  // --- Reposition Comments on Resize/Scroll ---
  var repositionTimer;
  function debouncedReposition() {
    clearTimeout(repositionTimer);
    repositionTimer = setTimeout(repositionExistingComments, 16);
  }

  window.addEventListener('resize', debouncedReposition);
  previewPane.addEventListener('scroll', debouncedReposition);

  function repositionExistingComments() {
    var markers = renderedView.querySelectorAll('.critic-comment-marker[data-comment-id]');
    if (markers.length === 0) return;

    var sidebarRect = commentSidebar.getBoundingClientRect();
    var lastBottom = 0;

    markers.forEach(function (marker) {
      var id = marker.getAttribute('data-comment-id');
      var card = commentSidebar.querySelector('[data-comment-id="' + id + '"]');
      if (!card) return;

      var markerRect = marker.getBoundingClientRect();
      var targetTop = markerRect.top - sidebarRect.top + commentSidebar.scrollTop;
      targetTop = Math.max(targetTop, lastBottom + 8);
      card.style.top = targetTop + 'px';
      lastBottom = targetTop + card.offsetHeight;
    });
  }

  // --- Resizable Pane Handle ---
  (function initResize() {
    var startX, startEditorWidth, startPreviewWidth;

    resizeHandle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      resizeHandle.classList.add('dragging');
      startX = e.clientX;
      var editorPane = document.getElementById('editorPane');
      var previewPaneEl = document.getElementById('previewPane');
      startEditorWidth = editorPane.offsetWidth;
      startPreviewWidth = previewPaneEl.offsetWidth;

      function onMouseMove(e) {
        var dx = e.clientX - startX;
        var totalWidth = startEditorWidth + startPreviewWidth;
        var newEditorWidth = Math.max(200, Math.min(totalWidth - 200, startEditorWidth + dx));
        var newPreviewWidth = totalWidth - newEditorWidth;
        editorPane.style.flex = 'none';
        editorPane.style.width = newEditorWidth + 'px';
        previewPaneEl.style.flex = 'none';
        previewPaneEl.style.width = newPreviewWidth + 'px';
      }

      function onMouseUp() {
        resizeHandle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  })();

  // --- Editor Ready Event ---
  // Fired by editor-loader.js (ES module) after CodeMirror loads.
  // On file:// this never fires and the app works as a viewer.
  window.addEventListener('editor-ready', function () {
    Editor = window.CriticEditor;
    console.log('CodeMirror editor loaded');

    // If content is already loaded, replace fallback textarea with CM6
    if (!mainLayout.hidden && !editorView) {
      removeFallbackTextarea();
      editorView = Editor.createEditor(editorContainer, state.source, onEditorUpdate);
    }
    updateToolbar();
  });

})();
