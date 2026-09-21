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
const TIME_TOKENS = new Set(['HH', 'H', 'hh', 'h', 'mm', 'm', 'a']);

/** 時刻を持たない入力用に、書式から時刻部分とその周辺の区切りを除く。 */
function withoutTimePattern(pattern) {
  const source = String(pattern);
  const timeMatches = [...source.matchAll(TOKEN_RE)].filter(
    (match) => match[1] === undefined && TIME_TOKENS.has(match[0])
  );
  if (timeMatches.length === 0) return source;

  let start = timeMatches[0].index;
  const last = timeMatches[timeMatches.length - 1];
  let end = last.index + last[0].length;

  // 「M月d日 H:mm」「M/d (H:mm)」「H時 M/d」のような書式で、
  // 時刻だけ消した後に空白・括弧・時分の区切りが残らないようにする。
  while (start > 0 && /[\s([{（・,，|]/.test(source[start - 1])) start -= 1;
  while (end < source.length && /[\s)\]}）・,，|:：時分]/.test(source[end])) end += 1;

  return source.slice(0, start) + source.slice(end);
}

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
  const effectivePattern = value.hasTime === false ? withoutTimePattern(pattern) : String(pattern);
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

  return effectivePattern.replace(TOKEN_RE, (match, literal) =>
    literal !== undefined ? literal : (table[match] ?? match)
  );
}

/* ------------------------------------------------------------------ *
 * 入力パース
 * ------------------------------------------------------------------ */

/**
 * 時刻部分（任意）。名前付きグループ ampm / H / m を持つ。
 * 入力ルールの末尾に連結して使う。
 *
 * `14:30` `14時30分` のような区切りつきに加えて、`2200`（22:00）のような
 * 区切りなしの詰めた書き方も拾う。ただし詰めた書き方は直前に空白が必須
 * （日付の桁を時刻と誤読しないようにするため）。
 */
export const TIME_PATTERN =
  String.raw`(?<time>` +
  // 14:30 / 14時30分 / 午後2:05
  String.raw`\s*(?:(?<ampm>午前|午後)\s*)?(?<H>[\d０-９]{1,2})\s*[:：時](?:\s*(?<m>[\d０-９]{1,2})(?:\s*分)?)?` +
  // 2200 / 900 のような区切りなしの詰めた書き方。
  // 「9/212200」のような地続きの数字を拾わないよう、直前の空白を必須にする。
  String.raw`|\s+(?<H2>[\d０-９]{1,2})(?<m2>[\d０-９]{2})(?![\d０-９])` +
  String.raw`)?`;

/** 「(月)」「（月曜日）」のように既に付いている曜日。二重に付かないよう食べる。 */
const WEEKDAY_SUFFIX = String.raw`(?:\s*[（(][日月火水木金土](?:曜日?)?[）)])?`;

/** 数字や小数点の途中で拾わないための境界。「v1.2.3」「03-1234-5678」対策。 */
const LEFT = String.raw`(?<![\d０-９.．])`;
const RIGHT = String.raw`(?![\d０-９.．])`;

/**
 * 既定の入力ルール。ユーザーは設定画面でこの正規表現を編集・追加できる。
 * 使える名前付きグループ: y / M / d / H / m / ampm / rel
 */
export const DEFAULT_INPUT_RULES = [
  {
    id: 'ymd',
    label: '年月日表記（4桁年＋月＋日。区切り：-、/、.、年・月、／、．、－。半角・全角数字に対応、末尾の「日」は任意）',
    pattern:
      LEFT +
      String.raw`(?<y>[\d０-９]{4})\s*[-/.年／．－]\s*(?<M>[\d０-９]{1,2})\s*[-/.月／．－]\s*(?<d>[\d０-９]{1,2})(?:\s*日)?` +
      RIGHT + WEEKDAY_SUFFIX + TIME_PATTERN,
    enabled: true,
  },
  {
    id: 'md',
    label: '月日表記（月＋日。区切り：-、/、月、／、－。半角・全角数字に対応、末尾の「日」は任意）',
    pattern:
      LEFT +
      String.raw`(?<M>[\d０-９]{1,2})\s*[-/月／－]\s*(?<d>[\d０-９]{1,2})(?:\s*日)?` +
      RIGHT + WEEKDAY_SUFFIX + TIME_PATTERN,
    enabled: true,
  },
  {
    id: 'rel',
    label: '相対表現（一昨日、おととい、昨日、きのう、今日、本日、きょう、明日、あした、あす、明後日、あさって、明々後日、しあさって）',
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

/** 全角数字を半角に直してから数値にする。 */
const num = (v) => {
  if (v == null || v === '') return null;
  const half = String(v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const n = Number(half);
  return Number.isNaN(n) ? null : n;
};

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

  let H = num(groups.H ?? groups.H2);
  let m = num(groups.m ?? groups.m2);
  if (H != null) {
    if (groups.ampm === '午後' && H < 12) H += 12;
    if (groups.ampm === '午前' && H === 12) H = 0;
    if (H > 23) return null;
    if (m != null && m > 59) return null;
  }

  return { y, M, d, H: H ?? 0, m: m ?? 0, hasTime: H != null };
}

/**
 * テキストに含まれる日付を、前から順に **すべて** 拾う。
 *
 * 複数行の選択にも、1行に複数の日付がある場合（「6/5〜6/12」など）にも効く。
 * 同じ場所に複数のルールが当たったときは、左にあるもの・ルールの並び順が先のものを優先し、
 * 重なった候補は捨てる。「2026/9/21」を「9/21」と誤読しないのはこの仕組みによる。
 *
 * @param {string} text
 * @param {{now?: Date, rules?: Array}} [options]
 * @returns {Array<{start: number, end: number, value: object}>}
 */
export function findDates(text, options = {}) {
  const now = options.now ?? new Date();
  const rules = options.rules ?? DEFAULT_INPUT_RULES;
  const input = String(text ?? '');
  if (!input) return [];

  const candidates = [];
  rules.forEach((rule, priority) => {
    if (rule.enabled === false) return;
    let re;
    try {
      re = new RegExp(rule.pattern, 'gud'); // d = マッチ位置を group ごとに取る
    } catch {
      return; // 壊れた正規表現は黙って飛ばす（設定画面側で警告を出す）
    }
    for (const match of input.matchAll(re)) {
      if (!match[0]) continue;
      const value = toValue(match.groups ?? {}, now);
      if (!value) continue;
      const end = match.index + match[0].length;
      // 時刻部分がどこから始まるか。出力書式に時刻トークンが無いときは、
      // ここから後ろを書き換えずに原文のまま残す（時刻を消さないため）。
      const timeAt = match.indices?.groups?.time?.[0];
      candidates.push({
        start: match.index,
        end,
        dateEnd: typeof timeAt === 'number' ? timeAt : end,
        priority,
        value: { ...value, rule: rule.id, matched: match[0] },
      });
    }
  });

  // 左から / ルール順が先 / 長いものを優先
  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      a.priority - b.priority ||
      (b.end - b.start) - (a.end - a.start)
  );

  const picked = [];
  let cursor = 0;
  for (const c of candidates) {
    if (c.start < cursor) continue; // 先に採ったものと重なる
    picked.push({ start: c.start, end: c.end, dateEnd: c.dateEnd, value: c.value });
    cursor = c.end;
  }
  return picked;
}

/**
 * テキストから最初の日付を1つ拾う。見つからなければ null。
 * @param {string} text
 * @param {{now?: Date, rules?: Array}} [options]
 */
export function parseDate(text, options = {}) {
  return findDates(text, options)[0]?.value ?? null;
}

/** parse → format をまとめた便利関数。日付そのものだけを返す。失敗したら null。 */
export function convert(text, pattern, options = {}) {
  const value = parseDate(text, options);
  return value ? formatDate(value, pattern) : null;
}

/**
 * テキスト中の日付を **その場で** 書き換える。前後の文章と改行はそのまま残る。
 * 拡張機能が実際に使うのはこちら。
 *
 * @returns {{text: string, count: number}} 置き換えた件数つき
 */
export function formatIn(text, pattern, options = {}) {
  const input = String(text ?? '');
  const found = findDates(input, options);
  const keepsTime = hasTimeToken(pattern);

  let out = '';
  let cursor = 0;
  for (const f of found) {
    // 書式が時刻を出さないなら、拾った時刻はそのまま原文を残す。
    // 「6/5 14:30」を「M月d日」で整えても 14:30 が消えない。
    const cut = keepsTime ? f.end : f.dateEnd;
    const formatted = formatDate(f.value, pattern);
    // 時刻トークンだけの書式を、時刻なしの日付へ適用した場合は原文を維持する。
    const replacement = formatted || input.slice(f.start, f.dateEnd);
    out += input.slice(cursor, f.start) + replacement + input.slice(cut, f.end);
    cursor = f.end;
  }
  out += input.slice(cursor);

  return { text: out, count: found.length };
}

/** 書式に時刻トークン（H h m a）が含まれるか。[ ] の中は除く。 */
export function hasTimeToken(pattern) {
  for (const match of String(pattern).matchAll(TOKEN_RE)) {
    if (match[1] !== undefined) continue; // [ ] の中身
    if (TIME_TOKENS.has(match[0])) return true;
  }
  return false;
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
