import {
  DEFAULT_INPUT_RULES, SAMPLE_VALUE, formatDate, formatIn,
} from '../core/date.js';
import { loadSettings, saveSettings } from '../settings.js';

const $ = (sel) => document.querySelector(sel);
let settings;

/* ---------------- 共通ユーティリティ ---------------- */

function createRemoveButton(title = '削除', ariaLabel = '削除') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn remove-btn';
  btn.title = title;
  btn.setAttribute('aria-label', ariaLabel);
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="3" x2="11" y2="11"></line>
      <line x1="11" y1="3" x2="3" y2="11"></line>
    </svg>
  `;
  return btn;
}

/* ---------------- 保存 ---------------- */

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    const status = $('#status');
    status.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
      保存しました
    `;
    status.classList.add('visible');
    setTimeout(() => {
      status.classList.remove('visible');
    }, 1600);
  }, 250);
}

/* ---------------- 出力フォーマット：プリセット ---------------- */

const FORMAT_PRESETS = [
  'M月d日(ddd)',
  'M月d日(ddd) H:mm',
  'yyyy年M月d日(ddd)',
  'yyyy-MM-dd',
  'yyyy/M/d',
  'M/d(ddd) a h:mm',
];

let draggedIndex = null;

function renderFormatPresets() {
  const box = $('#format-presets');
  box.textContent = '';

  for (const pattern of FORMAT_PRESETS) {
    const selected = settings.formats.some((f) => f.pattern === pattern);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = selected ? 'chip selected' : 'chip';
    chip.textContent = formatDate(SAMPLE_VALUE, pattern);
    chip.setAttribute('aria-pressed', String(selected));
    chip.addEventListener('click', () => {
      if (selected) {
        settings.formats = settings.formats.filter((f) => f.pattern !== pattern);
      } else {
        settings.formats.push({ pattern });
      }
      save();
      renderAll();
    });
    box.append(chip);
  }
}

function renderFormatsSimple() {
  const list = $('#formats');
  list.textContent = '';

  if (!settings.formats.length) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'empty-format-row';
    emptyLi.innerHTML = `
      <div class="empty-state">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>変換タイプがありません。「よく使う形」から選ぶか、下の編集画面で追加してください。</span>
      </div>
    `;
    list.append(emptyLi);
    return;
  }

  settings.formats.forEach((format, index) => {
    const li = document.createElement('li');
    li.className = 'simple-row draggable-row';
    li.draggable = true;
    li.dataset.index = String(index);

    const left = document.createElement('div');
    left.className = 'format-info';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = 'ドラッグして並び替え';
    handle.setAttribute('aria-label', 'ドラッグして並び替え');
    handle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="2"></circle>
        <circle cx="15" cy="6" r="2"></circle>
        <circle cx="9" cy="12" r="2"></circle>
        <circle cx="15" cy="12" r="2"></circle>
        <circle cx="9" cy="18" r="2"></circle>
        <circle cx="15" cy="18" r="2"></circle>
      </svg>
    `;

    const order = document.createElement('span');
    order.className = 'format-index';
    order.textContent = `${index + 1}`;

    const preview = document.createElement('span');
    preview.className = 'preview simple-preview';
    preview.textContent = formatDate(SAMPLE_VALUE, format.pattern);

    const patternBadge = document.createElement('span');
    patternBadge.className = 'pattern-badge';
    patternBadge.textContent = format.pattern;

    left.append(handle, order, preview, patternBadge);

    const remove = createRemoveButton('フォーマットを削除', 'フォーマットを削除');
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.formats.splice(index, 1);
      save();
      renderAll();
    });

    li.append(left, remove);

    // ドラッグ＆ドロップ
    li.addEventListener('dragstart', (e) => {
      draggedIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      requestAnimationFrame(() => {
        li.classList.add('dragging');
      });
    });

    li.addEventListener('dragend', () => {
      draggedIndex = null;
      document.querySelectorAll('.draggable-row').forEach((row) => {
        row.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
      });
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedIndex === null || draggedIndex === index) return;

      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      li.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) {
        li.classList.add('drag-over-top');
      } else {
        li.classList.add('drag-over-bottom');
      }
    });

    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over-top', 'drag-over-bottom');
      if (draggedIndex === null || draggedIndex === index) return;

      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dropAfter = e.clientY >= midY;

      let targetIndex = index;
      if (dropAfter && draggedIndex < index) {
        targetIndex = index;
      } else if (!dropAfter && draggedIndex > index) {
        targetIndex = index;
      } else if (dropAfter && draggedIndex > index) {
        targetIndex = index + 1;
      } else if (!dropAfter && draggedIndex < index) {
        targetIndex = index - 1;
      }

      if (targetIndex < 0) targetIndex = 0;
      if (targetIndex >= settings.formats.length) targetIndex = settings.formats.length - 1;

      const [moved] = settings.formats.splice(draggedIndex, 1);
      settings.formats.splice(targetIndex, 0, moved);
      draggedIndex = null;

      save();
      renderAll();
    });

    list.append(li);
  });
}

/* ---------------- 出力フォーマット：詳細設定 ---------------- */

function renderFormatsAdvanced() {
  const list = $('#formats-advanced');
  list.textContent = '';

  settings.formats.forEach((format, index) => {
    const li = document.createElement('li');

    const line = document.createElement('div');
    line.className = 'line';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = format.pattern;
    input.setAttribute('aria-label', `書式 ${index + 1}`);
    input.spellcheck = false;

    const remove = createRemoveButton('フォーマットを削除', 'フォーマットを削除');
    remove.addEventListener('click', () => {
      settings.formats.splice(index, 1);
      save();
      renderAll();
    });

    line.append(input, remove);

    const preview = document.createElement('div');
    preview.className = 'preview-tag';

    const update = () => {
      settings.formats[index] = { pattern: input.value };
      preview.textContent = `表示例　${formatDate(SAMPLE_VALUE, input.value)}`;
      renderFormatPresets();
      renderFormatsSimple();
      renderProbe();
    };
    input.addEventListener('input', () => { update(); save(); });
    update();

    li.append(line, preview);
    list.append(li);
  });
}

function renderFormats() {
  renderFormatPresets();
  renderFormatsSimple();
  renderFormatsAdvanced();
}

/* ---------------- 検出パターン（解析ルール）：簡易設定 ---------------- */

function renderRulesSimple() {
  const list = $('#rules-simple');
  list.textContent = '';

  settings.rules.forEach((rule, index) => {
    const li = document.createElement('li');
    li.className = 'simple-row';

    const label = document.createElement('label');
    label.className = 'switch-toggle';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.addEventListener('change', () => {
      settings.rules[index].enabled = enabled.checked;
      save();
      renderAll();
    });

    const slider = document.createElement('span');
    slider.className = 'switch-slider';

    const text = document.createElement('span');
    text.className = 'switch-label';
    text.textContent = rule.label || '名称未設定';

    label.append(enabled, slider, text);
    li.append(label);
    list.append(li);
  });
}

/* ---------------- 検出パターン：詳細設定（正規表現） ---------------- */

function renderRules() {
  const list = $('#rules');
  list.textContent = '';

  settings.rules.forEach((rule, index) => {
    const li = document.createElement('li');

    const line = document.createElement('div');
    line.className = 'line';

    const labelWrap = document.createElement('label');
    labelWrap.className = 'switch-toggle';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.setAttribute('aria-label', '有効化');
    enabled.addEventListener('change', () => {
      settings.rules[index].enabled = enabled.checked;
      save();
      renderRulesSimple();
    });

    const slider = document.createElement('span');
    slider.className = 'switch-slider';
    labelWrap.append(enabled, slider);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = rule.label ?? '';
    labelInput.placeholder = 'パターンの説明・ラベル';
    labelInput.addEventListener('input', () => {
      settings.rules[index].label = labelInput.value;
      save();
      renderRulesSimple();
    });

    const remove = createRemoveButton('パターンを削除', 'パターンを削除');
    remove.addEventListener('click', () => {
      settings.rules.splice(index, 1);
      save();
      renderAll();
    });

    line.append(labelWrap, labelInput, remove);

    const pattern = document.createElement('textarea');
    pattern.value = rule.pattern;
    pattern.spellcheck = false;
    pattern.setAttribute('aria-label', '正規表現');

    const error = document.createElement('div');
    error.className = 'error';

    const validate = () => {
      try {
        new RegExp(pattern.value, 'gu');
        pattern.classList.remove('invalid');
        error.textContent = '';
      } catch (e) {
        pattern.classList.add('invalid');
        error.textContent = `正規表現エラー: ${e.message}`;
      }
    };
    pattern.addEventListener('input', () => {
      settings.rules[index].pattern = pattern.value;
      validate();
      save();
      renderProbe();
    });
    validate();

    li.append(line, pattern, error);
    list.append(li);
  });
}

/* ---------------- 変換プレビュー ---------------- */

function renderProbe() {
  const source = $('#probe').value;
  const list = $('#probe-results');
  list.textContent = '';

  for (const format of settings.formats) {
    const { text, count } = formatIn(source, format.pattern, { rules: settings.rules });

    const li = document.createElement('li');
    li.className = 'result-card';

    const head = document.createElement('div');
    head.className = 'result-header';

    const title = document.createElement('span');
    title.className = 'result-format';
    title.textContent = format.pattern;

    head.append(title);

    const body = document.createElement('div');
    body.className = count ? 'preview result-text' : 'preview empty result-text';
    body.textContent = count ? text : '読み取れる日付がありません';

    li.append(head, body);
    list.append(li);
  }
}

/* ---------------- 書式記号一覧 ---------------- */

const TOKENS = [
  ['yyyy', '2026（西暦4桁）'],
  ['yy', '26（西暦下2桁）'],
  ['M / MM', '9 / 09（月）'],
  ['d / dd', '21 / 21（日）'],
  ['ddd', '月（曜日・短縮）'],
  ['dddd', '月曜日（曜日・フル）'],
  ['E', 'Mon（英語曜日）'],
  ['H / HH', '14 / 14（24時間表記）'],
  ['h / hh', '2 / 02（12時間表記）'],
  ['m / mm', '30 / 30（分）'],
  ['a', '午前 / 午後'],
  ['[ ]', '囲んだ文字をそのまま出力（例: yyyy[年] → 2026年）'],
];

function renderTokens() {
  const table = $('#tokens');
  table.textContent = '';
  for (const [token, meaning] of TOKENS) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.innerHTML = `<code>${token}</code>`;
    const b = document.createElement('td');
    b.textContent = meaning;
    tr.append(a, b);
    table.append(tr);
  }
}

/* ---------------- 初期化 ---------------- */

function renderAll() {
  renderFormats();
  renderRulesSimple();
  renderRules();
  renderProbe();
}

$('#add-format').addEventListener('click', () => {
  settings.formats.push({ pattern: 'yyyy年M月d日(ddd)' });
  save();
  renderAll();
});

$('#add-rule').addEventListener('click', () => {
  settings.rules.push({
    id: `custom-${Date.now()}`,
    label: '新しいルール',
    pattern: String.raw`(?<y>\d{4})(?<M>\d{2})(?<d>\d{2})`,
    enabled: true,
  });
  save();
  renderAll();
});

$('#reset-rules').addEventListener('click', () => {
  settings.rules = structuredClone(DEFAULT_INPUT_RULES);
  save();
  renderAll();
});

$('#probe').addEventListener('input', renderProbe);

(async () => {
  settings = await loadSettings();
  renderTokens();
  renderAll();
})();
