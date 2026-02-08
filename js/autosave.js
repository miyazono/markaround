/**
 * Markaround - Autosave
 * Saves/restores content from localStorage.
 */

const PREFIX = 'markaround-autosave-';

let _timer = null;
let _dirty = false;
let _currentKey = null;
let _getSource = null;

export function startAutosave(fileName, getSource) {
  stopAutosave();
  _currentKey = PREFIX + (fileName || 'document.md');
  _getSource = getSource;
  _dirty = false;
  _timer = setInterval(() => {
    if (_dirty && _getSource) {
      const source = _getSource();
      if (source) {
        localStorage.setItem(_currentKey, JSON.stringify({
          source,
          timestamp: Date.now(),
        }));
      }
      _dirty = false;
    }
  }, 3000);
}

export function markDirty() {
  _dirty = true;
}

export function stopAutosave() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _dirty = false;
  _currentKey = null;
  _getSource = null;
}

export function checkAutosave(fileName) {
  const key = PREFIX + (fileName || 'document.md');
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && data.source && data.timestamp) {
      return data;
    }
  } catch (e) { /* ignore parse errors */ }
  return null;
}

export function clearAutosave(fileName) {
  const key = PREFIX + (fileName || 'document.md');
  localStorage.removeItem(key);
}
