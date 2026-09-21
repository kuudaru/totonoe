import { DEFAULT_FORMATS, DEFAULT_INPUT_RULES } from './core/date.js';

const KEY = 'settings';

/** 保存済みの設定を、欠けている項目を既定値で埋めて返す。 */
export async function loadSettings() {
  const stored = await chrome.storage.sync.get(KEY);
  const s = stored?.[KEY] ?? {};
  return {
    formats: Array.isArray(s.formats) && s.formats.length ? s.formats : DEFAULT_FORMATS,
    rules: Array.isArray(s.rules) && s.rules.length ? s.rules : DEFAULT_INPUT_RULES,
  };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [KEY]: settings });
}
