/**
 * totonoe / core
 *
 * ここはブラウザ API に一切依存しない純粋関数だけを置く。
 * Node からそのまま import できるので、単体テストが速く書ける。
 * 将来 CLI や VS Code 拡張に転用するときも、このファイルだけ持っていけばいい。
 */

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
export const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n, len = 2) => String(n).padStart(len, '0');

/* ------------------------------------------------------------------ *
 * 出力フォーマット
 * ------------------------------------------------------------------ */

// 長いトークンを先に置くこと（dddd → ddd → dd → d の順）。
const TOKEN_RE = /\[([^\]]*)\]|yyyy|yy|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|a|E/g;

/** 曜日番号（0=日）。ローカルタイムゾーンの影響を受けないよう UTC で計算する。 */
export function weekdayIndex({ y, M, d }) {
  return new Date(Date.UTC(y, M - 1, d)).getUTCDay();
}

/**
 * 日付値を書式文字列に流し込む。
 * ラテン文字だけがトークンなので、「月」「日」などはそのまま書ける。
 * トークンとして解釈させたくないラテン文字は [ ] で囲む（例: `yyyy[年]` → 2026年）。
 */
export function formatDate(value, pattern) {
  const { y, M, d, H = 0, m = 0 } = value;
  const w = weekdayIndex(value);
  const h12 = H % 12 === 0 ? 12 : H % 12;

  const table = {
    yyyy: String(y),
    yy: pad(y % 100),
    MM: pad(M),
    M: String(M),
    dd: pad(d),
    d: String(d),
    dddd: WEEKDAYS_JA[w] + '曜日',
    ddd: WEEKDAYS_JA[w],
    E: WEEKDAYS_EN[w],
    HH: pad(H),
    H: String(H),
    hh: pad(h12),
    h: String(h12),
    mm: pad(m),
    m: String(m),
    a: H < 12 ? '午前' : '午後',
  };

  return String(pattern).replace(TOKEN_RE, (match, literal) =>
    literal !== undefined ? literal : (table[match] ?? match)
  );
}

/* ------------------------------------------------------------------ *
 * 入力パース
 * ------------------------------------------------------------------ */

/**
 * 時刻部分（任意）。名前付きグループ ampm / H / m を持つ。
 * 入力ルールの末尾に連結して使う。
 */
export const TIME_PATTERN =
  String.raw`(?:\s*(?:(?<ampm>午前|午後)\s*)?(?<H>\d{1,2})\s*[:：時]\s*(?:(?<m>\d{1,2})\s*分?)?)?`;

/**
 * 既定の入力ルール。ユーザーは設定画面でこの正規表現を編集・追加できる。
 * 使える名前付きグループ: y / M / d / H / m / ampm / rel
 */
export const DEFAULT_INPUT_RULES = [
  {
    id: 'ymd',
    label: '年つき（2026-09-21, 2026/9/21, 2026年9月21日）',
    pattern:
      String.raw`(?<y>\d{4})\s*[-/.年]\s*(?<M>\d{1,2})\s*[-/.月]\s*(?<d>\d{1,2})\s*日?` +
      TIME_PATTERN,
    enabled: true,
  },
  {
    id: 'md',
    label: '年なし（6/5, 9-21, 9月21日）',
    pattern:
      String.raw`(?<M>\d{1,2})\s*[-/.月]\s*(?<d>\d{1,2})\s*日?` + TIME_PATTERN,
    enabled: true,
  },
  {
    id: 'rel',
    label: '相対表現（今日, 明日, 明後日, 昨日）',
    pattern:
      String.raw`(?<rel>一昨日|おととい|昨日|きのう|今日|本日|きょう|明日|あした|あす|明後日|あさって|明々後日|しあさって)` +
      TIME_PATTERN,
    enabled: true,
  },
];

const REL_OFFSET = {
  一昨日: -2, おととい: -2,
  昨日: -1, きのう: -1,
  今日: 0, 本日: 0, きょう: 0,
  明日: 1, あした: 1, あす: 1,
  明後日: 2, あさって: 2,
  明々後日: 3, しあさって: 3,
};

const num = (v) => (v == null || v === '' ? null : Number(v));

function isRealDate(y, M, d) {
  if (!(M >= 1 && M <= 12) || !(d >= 1 && d <= 31)) return false;
  const probe = new Date(Date.UTC(y, M - 1, d));
  return probe.getUTCMonth() === M - 1 && probe.getUTCDate() === d;
}

function toValue(groups, now) {
  let y, M, d;

  if (groups.rel != null) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() + (REL_OFFSET[groups.rel] ?? 0));
    y = base.getFullYear();
    M = base.getMonth() + 1;
    d = base.getDate();
  } else {
    M = num(groups.M);
    d = num(groups.d);
    y = groups.y != null ? num(groups.y) : now.getFullYear();
    if (y == null || M == null || d == null) return null;
    if (!isRealDate(y, M, d)) return null;
  }

  let H = num(groups.H);
  let m = num(groups.m);
  if (H != null) {
    if (groups.ampm === '午後' && H < 12) H += 12;
    if (groups.ampm === '午前' && H === 12) H = 0;
    if (H > 23) return null;
    if (m != null && m > 59) return null;
  }

  return { y, M, d, H: H ?? 0, m: m ?? 0, hasTime: H != null };
}

/**
 * テキストから日付を1つ拾う。見つからなければ null。
 * @param {string} text
 * @param {{now?: Date, rules?: Array}} [options]
 */
export function parseDate(text, options = {}) {
  const now = options.now ?? new Date();
  const rules = options.rules ?? DEFAULT_INPUT_RULES;
  const input = String(text ?? '').trim();
  if (!input) return null;

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    let re;
    try {
      re = new RegExp(rule.pattern, 'u');
    } catch {
      continue; // 壊れた正規表現は黙って飛ばす（設定画面側で警告を出す）
    }
    const match = re.exec(input);
    if (!match) continue;
    const value = toValue(match.groups ?? {}, now);
    if (value) return { ...value, rule: rule.id, matched: match[0] };
  }
  return null;
}

/** parse → format をまとめた便利関数。失敗したら null。 */
export function convert(text, pattern, options = {}) {
  const value = parseDate(text, options);
  return value ? formatDate(value, pattern) : null;
}

/* ------------------------------------------------------------------ *
 * 設定のデフォルト
 * ------------------------------------------------------------------ */

export const DEFAULT_FORMATS = [
  { pattern: 'M月d日(ddd)' },
  { pattern: 'M月d日(ddd) H:mm' },
  { pattern: 'yyyy年M月d日(ddd)' },
  { pattern: 'yyyy-MM-dd' },
];

export const DEFAULT_SETTINGS = {
  formats: DEFAULT_FORMATS,
  rules: DEFAULT_INPUT_RULES,
};

/** 設定画面やメニューのプレビューに使うサンプル値。 */
export const SAMPLE_VALUE = { y: 2026, M: 9, d: 21, H: 14, m: 30, hasTime: true };
