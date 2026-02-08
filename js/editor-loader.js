/**
 * Editor Loader (ES Module)
 *
 * Imports CodeMirror 6 via import map, creates the editor API,
 * and exposes it on window.CriticEditor. Fires 'editor-ready' event
 * so the classic app.js can pick it up.
 *
 * On file:// protocol this module silently fails to load (CORS),
 * and the app works as a preview-only viewer.
 */

import {
  createEditor, syncEditorFromState, setSuggestionMode,
  isSuggestionMode, addComment, hasSelection,
} from './editor.js';

window.CriticEditor = {
  createEditor,
  syncEditorFromState,
  setSuggestionMode,
  isSuggestionMode,
  addComment,
  hasSelection,
};

window.dispatchEvent(new CustomEvent('editor-ready'));
