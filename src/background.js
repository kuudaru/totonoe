import { formatDate, parseDate, SAMPLE_VALUE } from './core/date.js';
import { loadSettings } from './settings.js';

const ROOT = 'totonoe-root';
const OPEN_OPTIONS = 'totonoe-options';
const FMT_PREFIX = 'totonoe-fmt:';

/* ---------------- コンテキストメニュー ---------------- */

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const { formats } = await loadSettings();

  chrome.contextMenus.create({ id: ROOT, title: '日付を整形', contexts: ['selection'] });

  formats.forEach((f, i) => {
    // メニュー項目にはサンプル日付での結果を出す。書式を暗記しなくても選べる。
    const preview = formatDate(SAMPLE_VALUE, f.pattern);
    chrome.contextMenus.create({
      id: FMT_PREFIX + i,
      parentId: ROOT,
      contexts: ['selection'],
      // "&" はメニューでニーモニック扱いになるのでエスケープする
      title: `${preview}   ( ${f.pattern} )`.replace(/&/g, '&&'),
    });
  });

  chrome.contextMenus.create({ id: 'sep', parentId: ROOT, type: 'separator', contexts: ['selection'] });
  chrome.contextMenus.create({ id: OPEN_OPTIONS, parentId: ROOT, title: '書式を編集…', contexts: ['selection'] });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) buildMenus();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/* ---------------- クリック時の処理 ---------------- */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith(FMT_PREFIX)) return;
  if (!tab?.id) return;

  const index = Number(info.menuItemId.slice(FMT_PREFIX.length));
  const { formats, rules } = await loadSettings();
  const pattern = formats[index]?.pattern;
  if (!pattern) return;

  const value = parseDate(info.selectionText ?? '', { rules });
  const payload = value
    ? { text: formatDate(value, pattern) }
    : { error: '日付として読めませんでした' };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: info.frameId != null ? [info.frameId] : undefined },
      func: applyToPage,
      args: [payload],
    });
  } catch (e) {
    // chrome:// や Web ストアなど、スクリプトを挿せないページ
    console.warn('totonoe: ページに適用できませんでした', e);
  }
});

/* ---------------- ページ側で走る処理 ---------------- */
/* この関数は文字列化して注入されるので、外の変数を参照しないこと。 */

function applyToPage({ text, error }) {
  const toast = (message, tone) => {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:min(360px,80vw)', 'padding:10px 14px', 'border-radius:10px',
      'font:500 13px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif',
      'color:#fff', `background:${tone === 'error' ? '#b4433a' : '#2f6f4e'}`,
      'box-shadow:0 6px 20px rgba(0,0,0,.25)', 'opacity:0',
      'transition:opacity .15s ease', 'pointer-events:none',
      'white-space:pre-wrap', 'overflow-wrap:anywhere',
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 2200);
  };

  if (error) { toast(error, 'error'); return; }

  const el = document.activeElement;
  const editableInput =
    el && el.tagName === 'INPUT' &&
    /^(text|search|url|tel|email|)$/i.test(el.getAttribute('type') ?? '');

  // 1) input / textarea → その場で置換
  if (el && (el.tagName === 'TEXTAREA' || editableInput) && el.selectionStart != null) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      toast(`置き換えました: ${text}`);
      return;
    }
  }

  // 2) contenteditable → その場で置換
  if (el && el.isContentEditable) {
    const ok = document.execCommand('insertText', false, text);
    toast(ok ? `置き換えました: ${text}` : `コピーしました: ${text}`);
    if (ok) return;
  }

  // 3) それ以外（読むだけのページ）→ クリップボードへ
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  ta.remove();
  toast(copied ? `コピーしました: ${text}` : `コピーできませんでした: ${text}`, copied ? '' : 'error');
}
