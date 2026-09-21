import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convert, findDates, formatDate, formatIn, parseDate, weekdayIndex, DEFAULT_INPUT_RULES,
} from './date.js';

// 2026-09-21 は月曜日
const NOW = new Date(2026, 8, 21, 10, 0, 0);
const at = { now: NOW };

test('年なしの入力は現在の年で補完する', () => {
  assert.equal(convert('6/5', 'yyyy-MM-dd', at), '2026-06-05');
  assert.equal(convert('6月5日', 'M月d日', at), '6月5日');
  assert.equal(convert('9-21', 'M/d', at), '9/21');
});

test('年つきの入力は区切り文字を問わない', () => {
  for (const s of ['2026-09-21', '2026/9/21', '2026.9.21', '2026年9月21日']) {
    assert.equal(convert(s, 'yyyy-MM-dd', at), '2026-09-21', s);
  }
});

test('曜日トークン', () => {
  assert.equal(convert('2026-09-21', 'ddd', at), '月');
  assert.equal(convert('2026-09-21', 'dddd', at), '月曜日');
  assert.equal(convert('2026-09-21', 'E', at), 'Mon');
  assert.equal(weekdayIndex({ y: 2026, M: 9, d: 21 }), 1);
});

test('ユーザーが書きそうな書式をそのまま通す', () => {
  assert.equal(convert('6/5', 'M月d日(ddd) H:mm', at), '6月5日(金)');
  assert.equal(convert('6/5 14:30', 'M月d日(ddd) H:mm', at), '6月5日(金) 14:30');
});

test('時刻つき書式でも、元のテキストに時刻がある場合だけ時刻を表示する', () => {
  assert.equal(formatIn('6/12', 'M月d日(ddd) H:mm', at).text, '6月12日(金)');
  assert.equal(formatIn('6/12 22:01', 'M月d日(ddd) H:mm', at).text, '6月12日(金) 22:01');
  assert.equal(
    formatIn('6/12\n6/19 22:01', 'M月d日(ddd) H:mm', at).text,
    '6月12日(金)\n6月19日(金) 22:01'
  );
  assert.equal(formatIn('6/12', 'HH:mm', at).text, '6/12');
});

test('時刻のバリエーション', () => {
  assert.equal(convert('6/5 14時', 'HH:mm', at), '14:00');
  assert.equal(convert('6/5 14時30分', 'HH:mm', at), '14:30');
  assert.equal(convert('6/5 午後2:05', 'HH:mm', at), '14:05');
  assert.equal(convert('6/5 午前0:30', 'a h:mm', at), '午前 12:30');
});

test('区切りなしの詰めた時刻（2200 → 22:00）', () => {
  assert.equal(convert('9/21 2200', 'HH:mm', at), '22:00');
  assert.equal(convert('9/21 900', 'HH:mm', at), '09:00');
  assert.equal(convert('9/21 130', 'HH:mm', at), '01:30');
  assert.equal(parseDate('9/21 2500', at), null); // 24時超えは無効
  // 直前に空白がなければ時刻として拾わない。数字が地続きなので日付としても読まない
  assert.equal(parseDate('9/212200', at), null);
});

test('相対表現', () => {
  assert.equal(convert('今日', 'yyyy-MM-dd', at), '2026-09-21');
  assert.equal(convert('明日', 'yyyy-MM-dd', at), '2026-09-22');
  assert.equal(convert('明後日', 'yyyy-MM-dd', at), '2026-09-23');
  assert.equal(convert('昨日', 'yyyy-MM-dd', at), '2026-09-20');
  assert.equal(convert('あさって 9:00', 'MM/dd HH:mm', at), '09/23 09:00');
});

test('角括弧でトークン化を抑止できる', () => {
  assert.equal(convert('2026-09-21', 'yyyy[年]MM[月]dd[日]', at), '2026年09月21日');
  assert.equal(formatDate({ y: 2026, M: 9, d: 21 }, '[dd]'), 'dd');
});

test('ありえない日付は受け取らない', () => {
  assert.equal(parseDate('2026-02-30', at), null);
  assert.equal(parseDate('13/45', at), null);
  assert.equal(parseDate('6/5 25:00', at), null);
  assert.equal(parseDate('とくに日付なし', at), null);
  assert.equal(parseDate('', at), null);
});

test('文中からでも拾える', () => {
  assert.equal(convert('締め切りは 6/5 まで', 'M月d日(ddd)', at), '6月5日(金)');
});

test('ルールは上から順に試され、年つきが優先される', () => {
  const v = parseDate('2026/9/21', at);
  assert.equal(v.rule, 'ymd');
  assert.equal(v.y, 2026);
});

test('壊れた正規表現は無視されて次のルールに進む', () => {
  const rules = [{ id: 'broken', pattern: '(?<d>', enabled: true }, ...DEFAULT_INPUT_RULES];
  assert.equal(convert('6/5', 'M/d', { ...at, rules }), '6/5');
});

test('無効化したルールは使われない', () => {
  const rules = DEFAULT_INPUT_RULES.map((r) => ({ ...r, enabled: r.id !== 'md' }));
  assert.equal(parseDate('6/5', { ...at, rules }), null);
});

test('カスタム正規表現ルールを足せる', () => {
  const rules = [
    { id: 'compact', pattern: String.raw`(?<y>\d{4})(?<M>\d{2})(?<d>\d{2})`, enabled: true },
    ...DEFAULT_INPUT_RULES,
  ];
  assert.equal(convert('20260921', 'yyyy/M/d(ddd)', { ...at, rules }), '2026/9/21(月)');
});

test('複数行の日付をすべて整える（改行は保たれる）', () => {
  const { text, count } = formatIn('6/5\n6/12\n6/19', 'M月d日(ddd)', at);
  assert.equal(text, '6月5日(金)\n6月12日(金)\n6月19日(金)');
  assert.equal(count, 3);
});

test('1行に複数の日付があっても両方整える', () => {
  const { text, count } = formatIn('会期は 6/5〜6/12 です', 'M月d日(ddd)', at);
  assert.equal(text, '会期は 6月5日(金)〜6月12日(金) です');
  assert.equal(count, 2);
});

test('日付以外の文字はそのまま残る', () => {
  const { text } = formatIn('・6/5 キックオフ\n・明日 締切', 'M/d(ddd)', at);
  assert.equal(text, '・6/5(金) キックオフ\n・9/22(火) 締切');
});

test('前後の空白や改行を食わない', () => {
  assert.equal(formatIn('  6/5  ', 'M/d', at).text, '  6/5  ');
  assert.equal(formatIn('6/5\n\n6/12', 'M/d', at).text, '6/5\n\n6/12');
  assert.equal(formatIn('9/21 14時 集合', 'M/d HH:mm', at).text, '9/21 14:00 集合');
});

test('重なった候補は左と優先順で解決する', () => {
  // 「2026/9/21」を「9/21」と読み違えない
  const found = findDates('2026/9/21', at);
  assert.equal(found.length, 1);
  assert.equal(found[0].value.y, 2026);
  assert.equal(found[0].value.rule, 'ymd');
});

test('日付がなければ原文のまま、件数は0', () => {
  const { text, count } = formatIn('とくに日付なし', 'M/d', at);
  assert.equal(text, 'とくに日付なし');
  assert.equal(count, 0);
});

test('ありえない日付は飛ばして、他の日付は拾う', () => {
  const { text, count } = formatIn('13/45 と 6/5', 'M月d日', at);
  assert.equal(count, 1);
  assert.ok(text.includes('6月5日'));
});

test('書式が時刻を出さないとき、拾った時刻は原文のまま残す', () => {
  // 「6/5 14:30」を「M月d日」で整えても 14:30 が消えない
  assert.equal(formatIn('6/5 14:30', 'M月d日(ddd)', at).text, '6月5日(金) 14:30');
  assert.equal(formatIn('6/5 14:30', 'M月d日 H:mm', at).text, '6月5日 14:30');
  assert.equal(formatIn('明日 9:00 集合', 'M/d', at).text, '9/22 9:00 集合');
});

test('すでに付いている曜日は二重にしない', () => {
  assert.equal(formatIn('9/21(月)', 'M月d日(ddd)', at).text, '9月21日(月)');
  assert.equal(formatIn('9月21日（月曜日）', 'M月d日(ddd)', at).text, '9月21日(月)');
});

test('全角数字も読む', () => {
  assert.equal(formatIn('６/５', 'M月d日', at).text, '6月5日');
  assert.equal(formatIn('２０２６年９月２１日', 'yyyy-MM-dd', at).text, '2026-09-21');
});

test('日付でない数字を拾わない', () => {
  for (const s of ['v1.2.3', '03-1234-5678', '1.5/2.0', '100/200', '16:9', '24/7', 'Chrome 138/139']) {
    assert.equal(formatIn(s, 'M月d日', at).count, 0, s);
  }
});
