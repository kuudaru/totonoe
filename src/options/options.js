import {
  DEFAULT_INPUT_RULES, SAMPLE_VALUE, formatDate, parseDate,
} from '../core/date.js';
import { loadSettings, saveSettings } from '../settings.js';

const $ = (sel) => document.querySelector(sel);
let settings;

/* ---------------- 保存 ---------------- */

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    const status = $('#status');
    status.textContent = '保存しました';
    status.style.opacity = '1';
    setTimeout(() => { status.style.opacity = '0'; }, 1400);
  }, 250);
}

/* ---------------- 出力フォーマット ---------------- */

function renderFormats() {
  const list = $('#formats');
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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon';
    remove.textContent = '削除';
    remove.addEventListener('click', () => {
      settings.formats.splice(index, 1);
      if (!settings.formats.length) settings.formats.push({ pattern: 'yyyy-MM-dd' });
      save();
      renderAll();
    });

    line.append(input, remove);

    const preview = document.createElement('div');
    preview.className = 'preview';

    const update = () => {
      settings.formats[index] = { pattern: input.value };
      preview.textContent = `2026-09-21 14:30 → ${formatDate(SAMPLE_VALUE, input.value)}`;
      renderProbe();
    };
    input.addEventListener('input', () => { update(); save(); });
    update();

    li.append(line, preview);
    list.append(li);
  });
}

/* ---------------- 入力パターン ---------------- */

function renderRules() {
  const list = $('#rules');
  list.textContent = '';

  settings.rules.forEach((rule, index) => {
    const li = document.createElement('li');

    const line = document.createElement('div');
    line.className = 'line';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.setAttribute('aria-label', '有効');
    enabled.addEventListener('change', () => {
      settings.rules[index].enabled = enabled.checked;
      save();
      renderProbe();
    });

    const label = document.createElement('input');
    label.type = 'text';
    label.value = rule.label ?? '';
    label.placeholder = 'このパターンの説明';
    label.addEventListener('input', () => {
      settings.rules[index].label = label.value;
      save();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon';
    remove.textContent = '削除';
    remove.addEventListener('click', () => {
      settings.rules.splice(index, 1);
      save();
      renderAll();
    });

    line.append(enabled, label, remove);

    const pattern = document.createElement('textarea');
    pattern.value = rule.pattern;
    pattern.spellcheck = false;
    pattern.setAttribute('aria-label', '正規表現');

    const error = document.createElement('div');
    error.className = 'error';

    const validate = () => {
      try {
        new RegExp(pattern.value, 'u');
        pattern.classList.remove('invalid');
        error.textContent = '';
      } catch (e) {
        pattern.classList.add('invalid');
        error.textContent = `正規表現が不正です: ${e.message}`;
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

/* ---------------- 動作テスト ---------------- */

function renderProbe() {
  const text = $('#probe').value;
  const list = $('#probe-results');
  list.textContent = '';

  const value = parseDate(text, { rules: settings.rules });
  if (!value) {
    const li = document.createElement('li');
    li.className = 'preview empty';
    li.textContent = '日付として読めませんでした';
    list.append(li);
    return;
  }

  for (const format of settings.formats) {
    const li = document.createElement('li');
    li.className = 'preview';
    li.textContent = formatDate(value, format.pattern);
    list.append(li);
  }

  const note = document.createElement('li');
  note.className = 'label';
  note.textContent = `一致したパターン: ${value.rule} / 一致部分: ${value.matched}`;
  list.append(note);
}

/* ---------------- トークン早見表 ---------------- */

const TOKENS = [
  ['yyyy', '2026'], ['yy', '26'],
  ['M / MM', '9 / 09'],
  ['d / dd', '21 / 21'],
  ['ddd', '月'], ['dddd', '月曜日'], ['E', 'Mon'],
  ['H / HH', '14 / 14（24時間）'],
  ['h / hh', '2 / 02（12時間）'],
  ['m / mm', '30 / 30（分）'],
  ['a', '午前 / 午後'],
  ['[ ]', '中身をそのまま出力（例: yyyy[年] → 2026年）'],
];

function renderTokens() {
  const table = $('#tokens');
  table.textContent = '';
  for (const [token, meaning] of TOKENS) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = token;
    const b = document.createElement('td');
    b.textContent = meaning;
    tr.append(a, b);
    table.append(tr);
  }
}

/* ---------------- 初期化 ---------------- */

function renderAll() {
  renderFormats();
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
    label: '新しいパターン',
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
