/**
 * totonoe / content script
 *
 * ページ上で選択されたテキストの変更を検知し、
 * コンテキストメニューのプレビューを動的に更新するために background へ通知する。
 */

function getSelectedText() {
  const el = document.activeElement;
  if (
    el &&
    (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|search|url|tel|email|)$/i.test(el.type || '')))
  ) {
    if (el.selectionStart != null && el.selectionEnd != null && el.selectionStart !== el.selectionEnd) {
      return el.value.substring(el.selectionStart, el.selectionEnd);
    }
  }
  const sel = window.getSelection();
  return sel ? sel.toString() : '';
}

let lastSent = '';
let debounceTimer = null;

function notifySelection(immediate = false) {
  clearTimeout(debounceTimer);

  const run = () => {
    const text = getSelectedText();
    // 右クリック時は同じ選択文字列でも再送する。設定変更によって
    // メニューが作り直された直後でも、サンプル表示のまま残さないため。
    if (!immediate && text === lastSent) return;
    lastSent = text;

    try {
      chrome.runtime.sendMessage({
        type: 'SELECTION_CHANGED',
        selectionText: text,
      }).catch(() => {
        // 拡張機能のコンテキスト無効化時などのエラーを無視
      });
    } catch {
      // エクステンション再読み込み時などを無視
    }
  };

  if (immediate) {
    run();
  } else {
    debounceTimer = setTimeout(run, 80);
  }
}

document.addEventListener('selectionchange', () => notifySelection(false));
// Chrome には contextMenus.onShown がないため、右ボタンを押した時点で
// contextmenu イベントより先に通知し、メニューが開くまでの更新時間を確保する。
window.addEventListener('pointerdown', (event) => {
  if (event.button === 2) notifySelection(true);
}, true);
window.addEventListener('contextmenu', () => notifySelection(true), true);
