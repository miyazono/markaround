# Markaround

A browser-based [CriticMarkup](https://criticmarkup.com/) editor with live preview. Write, review, and resolve tracked changes in Markdown documents — no server or build step required.

## Features

- **Split-pane layout** — raw markup on the left, rendered preview on the right, with a draggable divider
- **Suggestion mode** — toggle on, then type normally. Insertions become `{++text++}`, deletions become `{--text--}`, and replacements become `{~~old~>new~~}`. Consecutive keystrokes merge into a single suggestion
- **Accept/reject** — hover any change in the preview to accept or reject it individually, or use Accept All / Reject All
- **Comments** — select text and click Comment to insert `{>>note<<}` markers, displayed in a sidebar
- **Autosave** — edits are saved to localStorage every 3 seconds, with a restore prompt on reload
- **Three layout modes** — Both, Editor only, or Preview only (suggestion mode auto-disables in preview-only)
- **File I/O** — drag-and-drop, file picker, paste, or load the built-in sample; download the result as `.md`

## Usage

### Hosted (easiest)

Open **[miyazono.github.io/markaround](https://miyazono.github.io/markaround/)** in your browser — nothing to install.

### Local

Clone and open `index.html` directly:

```bash
git clone https://github.com/miyazono/markaround.git
open markaround/index.html
```

This works from `file://` with a plain textarea editor. For the full CodeMirror 6 editor (syntax highlighting, better keybindings), serve over HTTP:

```bash
cd markaround
python3 -m http.server
# open http://localhost:8000
```

## CriticMarkup Syntax

| Syntax | Meaning | Rendered as |
|--------|---------|-------------|
| `{++text++}` | Addition | Green underlined text |
| `{--text--}` | Deletion | Red strikethrough text |
| `{~~old~>new~~}` | Substitution | Strikethrough old + underlined new |
| `{>>comment<<}` | Comment | Orange dot marker + sidebar card |
| `{==text==}` | Highlight | Yellow highlighted text |

## Architecture

```
index.html              # Import map for CM6, split-pane layout, toolbar
css/style.css           # Layout modes, CriticMarkup styles, responsive design
js/app.js               # Core app logic (IIFE, works on file://)
js/criticmarkup-plugin.js  # markdown-it plugin for CriticMarkup parsing
js/editor.js            # CodeMirror 6 integration + suggestion transactionFilter
js/editor-loader.js     # ES module bridge: loads CM6, exposes on window
js/autosave.js          # localStorage autosave (ES module, used by editor-loader)
```

The app is structured so that `app.js` (classic script) always works, even on `file://`. The CodeMirror editor loads separately as an ES module via `editor-loader.js` — if it can't load (CORS on `file://`, CDN down), the app falls back to a plain textarea with full suggestion mode support.

## License

MIT
