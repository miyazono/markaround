/**
 * Markaround - CodeMirror 6 Integration
 * Handles editor creation, suggestion mode, and comment commands.
 */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateField, StateEffect, Annotation } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';

// --- Suggestion Mode State ---
export const toggleSuggestionMode = StateEffect.define();

export const suggestionModeField = StateField.define({
  create() { return false; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleSuggestionMode)) value = e.value;
    }
    return value;
  },
});

// Annotation to mark transactions we've already processed (prevent recursion)
const suggestionProcessed = Annotation.define();

// --- Inside-Markup Detection ---
function isInsideMarkup(doc, pos) {
  // Scan backward from pos looking for unclosed CriticMarkup delimiters
  const text = doc.sliceString(Math.max(0, pos - 500), pos);
  // Check for unclosed {++ (addition)
  const lastAddOpen = text.lastIndexOf('{++');
  const lastAddClose = text.lastIndexOf('++}');
  if (lastAddOpen !== -1 && (lastAddClose === -1 || lastAddOpen > lastAddClose)) return 'addition';

  // Check for unclosed {-- (deletion)
  const lastDelOpen = text.lastIndexOf('{--');
  const lastDelClose = text.lastIndexOf('--}');
  if (lastDelOpen !== -1 && (lastDelClose === -1 || lastDelOpen > lastDelClose)) return 'deletion';

  // Check for unclosed {~~ (substitution) - check both halves
  const lastSubOpen = text.lastIndexOf('{~~');
  const lastSubClose = text.lastIndexOf('~~}');
  if (lastSubOpen !== -1 && (lastSubClose === -1 || lastSubOpen > lastSubClose)) return 'substitution';

  // Check for unclosed {>> (comment)
  const lastComOpen = text.lastIndexOf('{>>');
  const lastComClose = text.lastIndexOf('<<}');
  if (lastComOpen !== -1 && (lastComClose === -1 || lastComOpen > lastComClose)) return 'comment';

  return null;
}

// --- Suggestion Mode Transaction Filter ---
function suggestionFilter(tr) {
  // If this transaction was already processed by us, pass through
  if (tr.annotation(suggestionProcessed)) return tr;

  // If suggestion mode is off, pass through
  if (!tr.startState.field(suggestionModeField)) return tr;

  // Only intercept document changes
  if (!tr.docChanged) return tr;

  const changes = [];
  let hasWrapping = false;

  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const deletedText = tr.startState.doc.sliceString(fromA, toA);
    const insertedText = inserted.toString();

    // If cursor is inside existing markup, don't wrap
    if (isInsideMarkup(tr.startState.doc, fromA)) {
      // Pass through as-is
      changes.push({ from: fromA, to: toA, insert: insertedText });
      return;
    }

    if (deletedText && insertedText) {
      // Replacement -> substitution
      changes.push({ from: fromA, to: toA, insert: `{~~${deletedText}~>${insertedText}~~}` });
      hasWrapping = true;
    } else if (insertedText && !deletedText) {
      // Pure insertion -> addition
      changes.push({ from: fromA, to: toA, insert: `{++${insertedText}++}` });
      hasWrapping = true;
    } else if (deletedText && !insertedText) {
      // Pure deletion -> deletion markup (keep the text, wrap it)
      changes.push({ from: fromA, to: toA, insert: `{--${deletedText}--}` });
      hasWrapping = true;
    }
  });

  if (!hasWrapping) return tr;

  // Build new transaction with wrapped changes
  const newChanges = [];
  for (const c of changes) {
    newChanges.push({ from: c.from, to: c.to, insert: c.insert });
  }

  return {
    changes: newChanges,
    annotations: suggestionProcessed.of(true),
  };
}

// --- Comment Command ---
function addCommentCommand(view) {
  const { from, to } = view.state.selection.main;
  if (from === to) return false; // No selection

  const commentText = prompt('Enter comment:');
  if (commentText === null) return false; // Cancelled

  // Insert comment after the selection
  view.dispatch({
    changes: { from: to, insert: `{>>${commentText}<<}` },
    annotations: suggestionProcessed.of(true),
  });
  return true;
}

// --- Create Editor ---
export function createEditor(container, initialDoc, onUpdate) {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      basicSetup,
      markdown(),
      suggestionModeField,
      EditorState.transactionFilter.of(suggestionFilter),
      keymap.of([
        { key: 'Mod-Shift-m', run: addCommentCommand },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onUpdate(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace' },
        '.cm-content': { padding: '20px 16px', minHeight: '100%' },
        '.cm-gutters': { background: '#f8f9fa', borderRight: '1px solid #dadce0' },
      }),
    ],
  });

  const view = new EditorView({ state, parent: container });
  return view;
}

// --- Sync State Into Editor ---
export function syncEditorFromState(view, newDoc) {
  const currentDoc = view.state.doc.toString();
  if (currentDoc === newDoc) return;
  view.dispatch({
    changes: { from: 0, to: currentDoc.length, insert: newDoc },
    annotations: suggestionProcessed.of(true),
  });
}

// --- Toggle Suggestion Mode ---
export function setSuggestionMode(view, enabled) {
  view.dispatch({
    effects: toggleSuggestionMode.of(enabled),
  });
}

// --- Get Suggestion Mode State ---
export function isSuggestionMode(view) {
  return view.state.field(suggestionModeField);
}

// --- Add Comment (for toolbar button) ---
export function addComment(view) {
  return addCommentCommand(view);
}

// --- Check if editor has selection ---
export function hasSelection(view) {
  const { from, to } = view.state.selection.main;
  return from !== to;
}
