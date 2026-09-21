import { formatDate, formatIn, SAMPLE_VALUE } from './core/date.js';
import { loadSettings } from './settings.js';

const ROOT = 'totonoe-root';
const OPEN_OPTIONS = 'totonoe-options';
const FMT_PREFIX = 'totonoe-fmt:';

/* ---------------- コンテキストメニュー ---------------- */

async function updateMenuTitles(selectionText) {
  try {
    const { formats, rules } = await loadSettings();
    const firstLine = (selectionText || '').split(/\r?\n/)[0]?.trim();

    await Promise.all(formats.map((f, i) => {
      let preview = '';
      if (firstLine) {
        const { text, count } = formatIn(firstLine, f.pattern, { rules });
        if (count > 0) {
          preview = text.replace(/\s+/g, ' ').trim();
          if (preview.length > 36) {
            preview = preview.slice(0, 34) + '…';
          }
        }
      }
      if (!preview) {
        preview = formatDate(SAMPLE_VALUE, f.pattern);
      }

      return chrome.contextMenus.update(FMT_PREFIX + i, {
        title: preview.replace(/&/g, '&&'),
      }).catch(() => {});
    }));
  } catch (e) {
    console.warn('totonoe: updateMenuTitles failed', e);
  }
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const { formats } = await loadSettings();

  chrome.contextMenus.create({ id: ROOT, title: 'ととのえる', contexts: ['selection'] });

  formats.forEach((f, i) => {
    // メニュー項目にはプレビュー結果を出す。
    const preview = formatDate(SAMPLE_VALUE, f.pattern);
    chrome.contextMenus.create({
      id: FMT_PREFIX + i,
      parentId: ROOT,
      contexts: ['selection'],
      // "&" はメニューでニーモニック扱いになるのでエスケープする
      title: preview.replace(/&/g, '&&'),
    });
  });

  chrome.contextMenus.create({ id: 'totonoe-sep', parentId: ROOT, type: 'separator', contexts: ['selection'] });
  chrome.contextMenus.create({ id: OPEN_OPTIONS, parentId: ROOT, title: '設定…', contexts: ['selection'] });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) buildMenus();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/* ---------------- クリック時の処理 ---------------- */

const handleContextMenuClick = async (info, tab) => {
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

  // 選択範囲に含まれる日付を「すべて」その場で置き換える。
  // 複数行でも、1行に複数あっても、前後の文章と改行はそのまま残る。
  const { text, count } = formatIn(info.selectionText ?? '', pattern, { rules });

  const payload = count
    ? { text, summary: count > 1 ? `${count}件の日付をととのえました` : text }
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
};

// 一部のChromium互換ブラウザでは権限があってもイベントが公開されない。
// Service Worker全体の登録を失敗させず、対応環境でだけ購読する。
if (chrome.contextMenus?.onClicked?.addListener) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
} else {
  console.warn('totonoe: contextMenus.onClicked is not available');
}

/* ---------------- ショートカットキー（commands）の処理 ---------------- */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'totonoe-palette') return;

  // tab が渡されない場合はアクティブなタブを取得
  let targetTab = tab;
  if (!targetTab?.id) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = activeTab;
  }
  if (!targetTab?.id) return;

  const { formats } = await loadSettings();
  const items = formats.slice(0, 9).map((f, i) => ({
    index: i,
    key: String(i + 1),
    pattern: f.pattern,
    preview: formatDate(SAMPLE_VALUE, f.pattern),
  }));

  try {
    let initialText = '';
    let sourceFrameId = null;
    const isGoogleDocs = /^https:\/\/docs\.google\.com\/document\//.test(targetTab.url ?? '');

    // Google ドキュメントの編集面はトップページではなく内部フレームにある。
    // 選択中のフレーム自身でコピーを実行し、パレット表示前に文字列を回収する。
    if (isGoogleDocs) {
      const captures = await chrome.scripting.executeScript({
        target: { tabId: targetTab.id, allFrames: true },
        func: captureSelectionInFrame,
      });
      const textCapture = captures.find(({ result }) => (result?.text ?? '').trim());
      const focusedEditor = captures.find(({ frameId, result }) => frameId !== 0 && result?.focused);
      initialText = textCapture?.result?.text ?? '';
      // 文字列はトップフレームの copy から得られる場合があるが、フォーカスを
      // 戻す先は実際に選択操作を受けていた内部編集フレームを優先する。
      sourceFrameId = focusedEditor?.frameId ?? textCapture?.frameId ?? null;
    }

    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: showPaletteInPage,
      args: [{ items, initialText, clipboardOnly: isGoogleDocs, sourceFrameId }],
    });
  } catch (e) {
    console.warn('totonoe: ショートカットメニューを表示できませんでした', e);
  }
});

// この関数は各フレームへ文字列化して注入されるので、外の変数を参照しないこと。
async function captureSelectionInFrame() {
  const el = document.activeElement;
  const focused = document.hasFocus();
  const editableInput =
    el && el.tagName === 'INPUT' && /^(text|search|url|tel|email|)$/i.test(el.getAttribute('type') ?? '');

  if (el && (el.tagName === 'TEXTAREA' || editableInput) && el.selectionStart != null) {
    const text = el.value.slice(el.selectionStart, el.selectionEnd);
    if (text.trim()) return { text, focused };
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString() ?? '';
  if (selectedText.trim()) return { text: selectedText, focused };

  // Docs のキャンバスエディタは DOM selection を公開しない。フォーカスを持つ
  // 内部フレームで Docs 自身のコピー処理を呼び、クリップボードから読み取る。
  if (!focused) return { text: '', focused: false };
  try {
    if (!document.execCommand('copy')) return { text: '', focused };
    return { text: await navigator.clipboard.readText(), focused };
  } catch {
    return { text: '', focused };
  }
}

/* ---------------- メッセージ処理（パレットからの変換要求） ---------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TOTONOE_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (message?.type === 'SELECTION_CHANGED') {
    updateMenuTitles(message.selectionText);
    return;
  }
  if (message?.type === 'TOTONOE_FORMAT_SELECTION') {
    (async () => {
      const { formats, rules } = await loadSettings();
      const pattern = formats[message.index]?.pattern;
      if (!pattern) {
        sendResponse({ error: '書式が見つかりませんでした' });
        return;
      }

      const { text, count } = formatIn(message.text ?? '', pattern, { rules });
      const payload = count
        ? { text, summary: count > 1 ? `${count}件の日付をととのえました` : text }
        : { error: '日付として読めませんでした' };

      sendResponse(payload);
    })();
    return true; // 非同期レスポンス
  }
  if (message?.type === 'TOTONOE_FOCUS_GOOGLE_DOCS') {
    (async () => {
      if (!sender.tab?.id) {
        sendResponse({ focused: false });
        return;
      }
      try {
        const [{ result = false } = {}] = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id, frameIds: [0] },
          func: focusGoogleDocsEditor,
        });
        sendResponse({ focused: result });
      } catch {
        sendResponse({ focused: false });
      }
    })();
    return true;
  }
  if (message?.type === 'TOTONOE_PREVIEW_SELECTION') {
    (async () => {
      const { formats, rules } = await loadSettings();
      const previews = formats.slice(0, 9).map((format, index) => {
        const { text, count } = formatIn(message.text ?? '', format.pattern, { rules });
        return { index, text, count };
      });
      sendResponse({ previews });
    })();
    return true; // 非同期レスポンス
  }
});

// Docs のトップページから、実際のキー入力を受け取る内部 iframe へ
// フォーカスを戻す。選択範囲は Docs 自身が保持しているため再選択は不要。
function focusGoogleDocsEditor() {
  try {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (!(iframe instanceof HTMLIFrameElement)) return false;
    iframe.focus({ preventScroll: true });
    iframe.contentWindow?.focus();
    const editor = iframe.contentDocument?.querySelector('[contenteditable="true"]')
      ?? iframe.contentDocument?.body;
    if (editor instanceof HTMLElement) editor.focus({ preventScroll: true });
    return document.activeElement === iframe;
  } catch {
    return false;
  }
}

/* ---------------- ページ側で走る処理 ---------------- */
/* この関数は文字列化して注入されるので、外の変数を参照しないこと。 */

function applyToPage({ text, summary, error }) {
  const label = (summary ?? text ?? '').replace(/\s+/g, ' ').slice(0, 60);

  const toast = (message, tone) => {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:min(380px,80vw)', 'padding:9px 13px', 'border-radius:5px',
      'font:500 13px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif',
      'color:#fff', `background:${tone === 'error' ? '#9d443d' : '#30332f'}`,
      'box-shadow:0 6px 18px rgba(0,0,0,.18)', 'opacity:0',
      'transition:opacity .15s ease, transform .15s ease', 'pointer-events:none',
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
      toast(`置き換えました: ${label}`);
      return;
    }
  }

  // 2) contenteditable → その場で置換
  // insertText に改行付きの文字列をそのまま渡すと、white-space: normal な
  // エディタでは改行が空白扱いになって1行にまとまって見えてしまう。
  // <br> に変換した HTML として挿入することで改行を確実に反映させる。
  if (el && el.isContentEditable) {
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = text.split('\n').map(escapeHtml).join('<br>');
    const ok = document.execCommand('insertHTML', false, html);
    toast(ok ? `置き換えました: ${label}` : `コピーしました: ${label}`);
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
  toast(copied ? `コピーしました: ${label}` : `コピーできませんでした: ${label}`, copied ? '' : 'error');
}

/* ---------------- ページ側でパレットを表示する処理 ---------------- */

async function showPaletteInPage({ items, initialText = '', clipboardOnly = false, sourceFrameId = null }) {
  const HOST_ID = 'totonoe-palette-host';
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const toast = (message, tone) => {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:min(360px,80vw)', 'padding:9px 13px', 'border-radius:5px',
      'font:500 13px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif',
      'color:#fff', `background:${tone === 'error' ? '#9d443d' : '#30332f'}`,
      'box-shadow:0 6px 18px rgba(0,0,0,.2)', 'opacity:0',
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

  const el = document.activeElement;
  const editableInput =
    el && el.tagName === 'INPUT' &&
    /^(text|search|url|tel|email|)$/i.test(el.getAttribute('type') ?? '');
  const isInputOrTextarea = el && (el.tagName === 'TEXTAREA' || editableInput) && el.selectionStart != null;

  let selectedText = initialText;
  let targetInfo = clipboardOnly && initialText.trim()
    ? { type: 'google-docs', frameId: sourceFrameId }
    : null;

  if (!selectedText && isInputOrTextarea && el.selectionStart !== el.selectionEnd) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    selectedText = el.value.slice(start, end);
    targetInfo = { type: 'input', el, start, end };
  } else if (!selectedText) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      selectedText = sel.toString();
      targetInfo = {
        type: 'range',
        range: sel.getRangeAt(0).cloneRange(),
        isContentEditable: Boolean(el && el.isContentEditable),
      };
    }
  }

  if (!selectedText || !selectedText.trim()) {
    toast('日付を選択してからショートカットを押してください');
    return;
  }

  // パレットの挿入前に、選択範囲のビューポート座標を保存する。
  // input / textarea は Range を取得できないため、同じスタイルの
  // 不可視要素で選択末尾までの文字レイアウトを再現する。
  const getInputSelectionRect = (inputEl, selectionEnd) => {
    const rect = inputEl.getBoundingClientRect();
    const computed = getComputedStyle(inputEl);
    const mirror = document.createElement('div');
    const properties = [
      'boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom',
      'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
      'borderLeftWidth', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight',
      'fontVariant', 'letterSpacing', 'lineHeight', 'textAlign', 'textIndent',
      'textTransform', 'wordSpacing', 'tabSize',
    ];

    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.overflow = 'hidden';
    properties.forEach((property) => { mirror.style[property] = computed[property]; });

    if (inputEl.tagName === 'INPUT') {
      mirror.style.whiteSpace = 'pre';
    } else {
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.overflowWrap = 'break-word';
    }

    mirror.textContent = inputEl.value.slice(0, selectionEnd);
    const marker = document.createElement('span');
    // 空の span でも行の高さと位置を安定して取得する。
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    mirror.remove();
    const x = markerRect.left - inputEl.scrollLeft;
    const y = markerRect.top - inputEl.scrollTop;
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 20;

    return {
      left: Math.max(rect.left, Math.min(x, rect.right)),
      right: Math.max(rect.left, Math.min(x + 1, rect.right)),
      top: Math.max(rect.top, Math.min(y, rect.bottom)),
      bottom: Math.max(rect.top, Math.min(y + lineHeight, rect.bottom)),
      width: 1,
      height: lineHeight,
    };
  };

  let anchorRect = null;
  if (targetInfo?.type === 'input') {
    anchorRect = getInputSelectionRect(targetInfo.el, targetInfo.end);
  } else if (targetInfo?.type === 'range') {
    const rect = targetInfo.range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) anchorRect = rect;
  }

  const applyResult = async ({ text, summary, error }) => {
    if (error) { toast(error, 'error'); return; }
    const label = (summary ?? text ?? '').replace(/\s+/g, ' ').slice(0, 60);

    // Google ドキュメントは execCommand('insertText') が実際には編集していなくても
    // true を返すため、成功判定には使えない。必ずコピーして実入力用 iframe へ
    // フォーカスを戻し、続く貼り付けだけで選択範囲を置換できる状態にする。
    if (targetInfo?.type === 'google-docs') {
      try {
        await navigator.clipboard.writeText(text);
        const response = await chrome.runtime.sendMessage({ type: 'TOTONOE_FOCUS_GOOGLE_DOCS' });
        toast(response?.focused
          ? `コピーしました。⌘Vで置き換えられます: ${label}`
          : `コピーしました: ${label}`);
      } catch {
        toast('変換結果をコピーできませんでした', 'error');
      }
      return;
    }

    // 1) input / textarea
    if (targetInfo?.type === 'input') {
      const { el: inputEl, start, end } = targetInfo;
      inputEl.focus();
      inputEl.setRangeText(text, start, end, 'end');
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      toast(`置き換えました: ${label}`);
      return;
    }

    // 2) contenteditable
    if (targetInfo?.type === 'range' && targetInfo.isContentEditable) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(targetInfo.range);
      const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = text.split('\n').map(escapeHtml).join('<br>');
      const ok = document.execCommand('insertHTML', false, html);
      toast(ok ? `置き換えました: ${label}` : `コピーしました: ${label}`);
      if (ok) return;
    }

    // 3) それ以外（クリップボード）
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    ta.remove();
    toast(copied ? `コピーしました: ${label}` : `コピーできませんでした: ${label}`, copied ? '' : 'error');
  };

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: transparent;
      animation: totonoe-fade-in .1s ease-out;
    }
    .palette {
      position: fixed;
      width: 344px;
      max-width: calc(100vw - 24px);
      background: #fff;
      color: #171a1d;
      border: 1px solid rgba(32, 42, 50, .12);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(28, 38, 46, .18), 0 2px 8px rgba(28, 38, 46, .08);
      font-family: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", sans-serif;
      overflow: hidden;
      user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      .palette {
        background: #25282b;
        color: #f3f5f4;
        border-color: rgba(255, 255, 255, .12);
        box-shadow: 0 16px 42px rgba(0, 0, 0, .55);
      }
    }
    @keyframes totonoe-fade-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 8px 10px 2px;
    }
    .settings-button {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #7c858b;
      cursor: pointer;
    }
    .settings-button svg {
      width: 18px;
      height: 18px;
    }
    .settings-button:hover, .settings-button:focus-visible {
      background: rgba(26, 35, 42, .06);
      color: inherit;
      outline: none;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0 10px 10px;
      max-height: min(52vh, 480px);
      overflow-y: auto;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 11px 12px;
      border-top: 1px solid #e3e7e9;
      border-radius: 9px;
      cursor: pointer;
      transition: background .12s ease;
    }
    .item:first-child { border-top-color: transparent; }
    .item:hover, .item:focus-visible {
      background: #e9f7f5;
      outline: none;
    }
    @media (prefers-color-scheme: dark) {
      .item { border-top-color: rgba(255, 255, 255, .08); }
      .item:first-child { border-top-color: transparent; }
      .item:hover, .item:focus-visible { background: rgba(55, 184, 170, .16); }
      .settings-button:hover, .settings-button:focus-visible { background: rgba(255, 255, 255, .08); }
    }
    .preview {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 600;
      font-size: 15px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .shortcut-key {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border: 1px solid #d7dddf;
      border-radius: 6px;
      color: #778087;
      background: #f8f9f9;
      font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    @media (prefers-color-scheme: dark) {
      .shortcut-key {
        border-color: rgba(255, 255, 255, .16);
        background: rgba(255, 255, 255, .05);
        color: #aeb5b8;
      }
    }
    .select-mark {
      flex: 0 0 auto;
      color: #25aa9d;
      font-size: 20px;
      font-weight: 700;
      opacity: 0;
      transform: translateX(-3px);
      transition: opacity .12s ease, transform .12s ease;
    }
    .item:hover .select-mark, .item:focus-visible .select-mark {
      opacity: 1;
      transform: translateX(0);
    }
  `;

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const palette = document.createElement('div');
  palette.className = 'palette';

  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <button class="settings-button" type="button" aria-label="ととのえの設定を開く" title="設定">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"></path>
      </svg>
    </button>
  `;
  const settingsButton = header.querySelector('.settings-button');

  const list = document.createElement('ul');
  list.className = 'list';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.index = String(item.index);
    li.tabIndex = 0;
    li.title = `${item.key}キーで選択`;
    const shortcutKey = document.createElement('span');
    shortcutKey.className = 'shortcut-key';
    shortcutKey.setAttribute('aria-hidden', 'true');
    shortcutKey.textContent = item.key;
    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = item.preview;
    const selectMark = document.createElement('span');
    selectMark.className = 'select-mark';
    selectMark.setAttribute('aria-hidden', 'true');
    selectMark.textContent = '✓';
    li.append(shortcutKey, preview, selectMark);
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      choose(item.index);
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(item.index);
      }
    });
    list.appendChild(li);
  });

  palette.appendChild(header);
  palette.appendChild(list);
  backdrop.appendChild(palette);

  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  document.body.appendChild(host);

  // 基本は選択範囲の下に表示し、画面下に収まらなければ上へ逃がす。
  // Google Docs など座標を取得できない画面では中央表示に戻す。
  const positionPalette = () => {
    const margin = 12;
    const gap = 8;
    const paletteRect = palette.getBoundingClientRect();
    let left;
    let top;

    if (anchorRect) {
      left = anchorRect.left;
      top = anchorRect.bottom + gap;
      if (top + paletteRect.height > window.innerHeight - margin) {
        top = anchorRect.top - paletteRect.height - gap;
      }
    } else {
      left = (window.innerWidth - paletteRect.width) / 2;
      top = Math.max(margin, window.innerHeight * 0.12);
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - paletteRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - paletteRect.height - margin));
    palette.style.left = `${Math.round(left)}px`;
    palette.style.top = `${Math.round(top)}px`;
  };
  positionPalette();
  list.querySelector('.item')?.focus({ preventScroll: true });

  // 選択内容を実際に各書式へ変換し、複数行のまま候補に表示する。
  chrome.runtime.sendMessage(
    { type: 'TOTONOE_PREVIEW_SELECTION', text: selectedText },
    (response) => {
      if (chrome.runtime.lastError || !response?.previews) return;
      response.previews.forEach(({ index, text, count }) => {
        const preview = list.querySelector(`[data-index="${index}"] .preview`);
        if (!preview) return;
        preview.textContent = count > 0 ? text : '日付として読めません';
      });
      requestAnimationFrame(positionPalette);
    }
  );

  let isClosed = false;
  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', positionPalette);
    host.remove();
  };

  const choose = (index) => {
    cleanup();
    chrome.runtime.sendMessage(
      { type: 'TOTONOE_FORMAT_SELECTION', index, text: selectedText },
      (response) => {
        if (chrome.runtime.lastError) {
          toast('変換に失敗しました', 'error');
          return;
        }
        if (response) {
          applyResult(response);
        }
      }
    );
  };

  settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'TOTONOE_OPEN_OPTIONS' });
    cleanup();
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      cleanup();
    }
  });

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      return;
    }

    let num = null;
    if (e.key >= '1' && e.key <= '9') {
      num = parseInt(e.key, 10);
    } else if (e.code && e.code.startsWith('Digit') && e.code.length === 6) {
      const d = parseInt(e.code.slice(5), 10);
      if (d >= 1 && d <= 9) num = d;
    } else if (e.code && e.code.startsWith('Numpad') && e.code.length === 7) {
      const d = parseInt(e.code.slice(6), 10);
      if (d >= 1 && d <= 9) num = d;
    }

    if (num !== null) {
      const targetItem = items.find((it) => it.key === String(num));
      if (targetItem) {
        e.preventDefault();
        e.stopPropagation();
        choose(targetItem.index);
        return;
      }
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', positionPalette);
}
