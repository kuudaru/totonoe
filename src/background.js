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
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: showPaletteInPage,
      args: [{ items }],
    });
  } catch (e) {
    console.warn('totonoe: ショートカットメニューを表示できませんでした', e);
  }
});

/* ---------------- メッセージ処理（パレットからの変換要求） ---------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

function showPaletteInPage({ items }) {
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

  let selectedText = '';
  let targetInfo = null;

  if (isInputOrTextarea && el.selectionStart !== el.selectionEnd) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    selectedText = el.value.slice(start, end);
    targetInfo = { type: 'input', el, start, end };
  } else {
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

  const applyResult = ({ text, summary, error }) => {
    if (error) { toast(error, 'error'); return; }
    const label = (summary ?? text ?? '').replace(/\s+/g, ' ').slice(0, 60);

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
      background: rgba(25, 26, 23, 0.3);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
      animation: totonoe-fade-in .1s ease-out;
    }
    .palette {
      width: 560px;
      max-width: calc(100vw - 32px);
      background: #fbfaf7;
      color: #272824;
      border: 1px solid #d1cec5;
      border-radius: 7px;
      box-shadow: 0 18px 48px rgba(31, 32, 29, .2);
      font-family: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", sans-serif;
      overflow: hidden;
      user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      .backdrop { background: rgba(0, 0, 0, 0.5); }
      .palette {
        background: #252724;
        color: #eeece5;
        border-color: #454840;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
      }
    }
    @keyframes totonoe-fade-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 11px 16px;
      border-bottom: 1px solid #dedbd2;
      background: #f4f2ed;
    }
    @media (prefers-color-scheme: dark) {
      .header {
        border-color: #3d403a;
        background: #20221f;
      }
    }
    .title-wrap {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .title {
      font-weight: 700;
      font-size: 14px;
      color: #315344;
      letter-spacing: .04em;
    }
    @media (prefers-color-scheme: dark) {
      .title { color: #a4c5b3; }
    }
    .title-sub {
      font-size: 12px;
      color: #74766e;
    }
    @media (prefers-color-scheme: dark) {
      .title-sub { color: #a19f97; }
    }
    .close-hint {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      background: #e9e6df;
      color: #666860;
      border: 1px solid #d6d3ca;
    }
    @media (prefers-color-scheme: dark) {
      .close-hint {
        background: rgba(255, 255, 255, 0.08);
        color: #aaa89f;
        border-color: #454840;
      }
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 6px 8px;
      max-height: min(52vh, 480px);
      overflow-y: auto;
      display: grid;
      gap: 4px;
    }
    .item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: background .1s;
    }
    .item:hover {
      background: #e8eee9;
    }
    @media (prefers-color-scheme: dark) {
      .item:hover {
        background: rgba(111, 151, 130, .18);
      }
    }
    .key-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 3px;
      font-weight: 650;
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #fbfaf7;
      color: #3d6654;
      border: 1px solid #b9c9bf;
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      .key-badge {
        background: #2d302c;
        color: #a4c5b3;
        border-color: #61766a;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      }
    }
    .item-content {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .preview {
      font-weight: 600;
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .pattern {
      font-size: 11px;
      color: #6c6864;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      justify-self: end;
    }
    @media (prefers-color-scheme: dark) {
      .pattern { color: #9a9691; }
    }
    .footer {
      padding: 8px 16px;
      font-size: 11px;
      color: #6c6864;
      border-top: 1px solid #e3dfd9;
      background: #f4f2ed;
      display: grid;
      gap: 5px;
    }
    @media (prefers-color-scheme: dark) {
      .footer {
        border-color: #34373a;
        background: #1a1c1e;
        color: #9a9691;
      }
    }
    .selected-preview {
      max-height: 7em;
      white-space: pre-wrap;
      overflow: auto;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }
    .footer-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
  `;

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const palette = document.createElement('div');
  palette.className = 'palette';

  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <div class="title-wrap">
      <span class="title">ととのえ</span>
      <span class="title-sub">フォーマットを選ぶ</span>
    </div>
    <span class="close-hint">esc</span>
  `;

  const list = document.createElement('ul');
  list.className = 'list';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.index = String(item.index);
    const keyBadge = document.createElement('span');
    keyBadge.className = 'key-badge';
    keyBadge.textContent = item.key;
    const itemContent = document.createElement('div');
    itemContent.className = 'item-content';
    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = item.preview;
    const pattern = document.createElement('span');
    pattern.className = 'pattern';
    pattern.textContent = item.pattern;
    itemContent.append(preview, pattern);
    li.append(keyBadge, itemContent);
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      choose(item.index);
    });
    list.appendChild(li);
  });

  const footer = document.createElement('div');
  footer.className = 'footer';
  const selectedLabel = document.createElement('span');
  selectedLabel.textContent = '変換前';
  const selectedPreview = document.createElement('span');
  selectedPreview.className = 'selected-preview';
  selectedPreview.textContent = selectedText;
  const footerMeta = document.createElement('div');
  footerMeta.className = 'footer-meta';
  const afterLabel = document.createElement('span');
  afterLabel.textContent = '上の候補は変換後';
  const keyHint = document.createElement('span');
  keyHint.textContent = `1〜${items.length} キーで選択`;
  footerMeta.append(afterLabel, keyHint);
  footer.append(selectedLabel, selectedPreview, footerMeta);

  palette.appendChild(header);
  palette.appendChild(list);
  palette.appendChild(footer);
  backdrop.appendChild(palette);

  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  document.body.appendChild(host);

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
    }
  );

  let isClosed = false;
  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    window.removeEventListener('keydown', onKeyDown, true);
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
}
