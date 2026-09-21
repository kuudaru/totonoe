/**
 * manifest.json と package.json の version をまとめて書き換える。
 *
 *   npm run bump 0.3.0
 *
 * 正は manifest.json。package.json は揃えているだけ。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('使い方: npm run bump 0.3.0');
  process.exit(1);
}

for (const file of ['manifest.json', 'package.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const before = json.version;
  json.version = next;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`${file}: ${before} → ${next}`);
}

console.log(`\n次はこうします:\n  git add -A && git commit -m "v${next}"\n  git tag v${next} && git push origin main && git push origin v${next}`);
