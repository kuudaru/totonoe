import { DEFAULT_FORMATS, DEFAULT_INPUT_RULES } from './core/date.js';

const KEY = 'settings';

// 既定ラベルだけを変更した既存ユーザーには、新しい完全な説明を表示する。
// ユーザーが自分で編集したラベルはそのまま保持する。
const LEGACY_RULE_LABELS = new Map([
  ['年月日表記（2026-09-21, 2026/9/21, 2026年9月21日など）', DEFAULT_INPUT_RULES[0].label],
  ['月日表記（6/5, 9-21, 6月21日など）', DEFAULT_INPUT_RULES[1].label],
  ['相対表現（今日, 明日, 明後日, 昨日など）', DEFAULT_INPUT_RULES[2].label],
]);

/** 保存済みの設定を、欠けている項目を既定値で埋めて返す。 */
export async function loadSettings() {
  const stored = await chrome.storage.sync.get(KEY);
  const s = stored?.[KEY] ?? {};
  const storedRules = Array.isArray(s.rules) ? s.rules : DEFAULT_INPUT_RULES;
  return {
    formats: Array.isArray(s.formats) ? s.formats : DEFAULT_FORMATS,
    rules: storedRules.map((rule) => ({
      ...rule,
      label: LEGACY_RULE_LABELS.get(rule.label) ?? rule.label,
    })),
  };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [KEY]: settings });
}
