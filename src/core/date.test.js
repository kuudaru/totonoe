import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convert, formatDate, parseDate, weekdayIndex, DEFAULT_INPUT_RULES,
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
  assert.equal(convert('6/5', 'M月d日(ddd) H:mm', at), '6月5日(金) 0:00');
  assert.equal(convert('6/5 14:30', 'M月d日(ddd) H:mm', at), '6月5日(金) 14:30');
});

test('時刻のバリエーション', () => {
  assert.equal(convert('6/5 14時', 'HH:mm', at), '14:00');
  assert.equal(convert('6/5 14時30分', 'HH:mm', at), '14:30');
  assert.equal(convert('6/5 午後2:05', 'HH:mm', at), '14:05');
  assert.equal(convert('6/5 午前0:30', 'a h:mm', at), '午前 12:30');
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
