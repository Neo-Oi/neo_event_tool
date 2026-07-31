/* エビデンスの画像を走査して、sticky ヘッダーの焼き込みずれを見つける。
   ヘッダーは #20272e の全幅・高さ56px の帯。これが先頭以外の位置にあれば、
   スクロールした状態で撮ってしまっている。
   画像の幅が撮影時のビューポート幅より狭いものは、要素クリップで左右が切れている疑い。 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const EV = '/home/neo-oi/neo_event_tool/evidence';
const BASE = 'http://127.0.0.1:8010/evidence/';
const files = fs.readdirSync(EV).filter(f => f.endsWith('.png')).sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8010/', { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async ({ base, files }) => {
  const NAVY = [0x20, 0x27, 0x2e];
  const near = (r, g, b) => Math.abs(r - NAVY[0]) < 10 && Math.abs(g - NAVY[1]) < 10 && Math.abs(b - NAVY[2]) < 10;
  const res = [];
  for (const f of files) {
    let bmp;
    try {
      const blob = await (await fetch(base + encodeURIComponent(f))).blob();
      bmp = await createImageBitmap(blob);
    } catch (e) { res.push({ f, error: String(e).slice(0, 60) }); continue; }
    const { width: W, height: H } = bmp;
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    // 行ごとに「ヘッダー色がその行の6割以上を占めるか」を見る（サンプリングは16px刻み）
    const rows = [];
    for (let y = 0; y < H; y++) {
      const d = cx.getImageData(0, y, W, 1).data;
      let hit = 0, n = 0;
      for (let x = 0; x < W; x += 8) { n++; if (near(d[x * 4], d[x * 4 + 1], d[x * 4 + 2])) hit++; }
      // ヘッダー中央はロゴとボタンで暗色の比率が下がる。閾値は低めにして、
      // あとで小さな隙間を埋める（高い閾値だと帯が分断されて見逃す）
      rows.push(hit / n >= 0.3);
    }
    // 6行までの隙間は埋めてから、連続した帯を拾う
    for (let y = 1; y < H - 1; y++) {
      if (rows[y]) continue;
      for (let k = 1; k <= 6 && y + k < H; k++) {
        if (rows[y + k]) { for (let j = 0; j < k; j++) rows[y + j] = rows[y - 1]; break; }
      }
    }
    const bands = [];
    let s = -1;
    for (let y = 0; y <= H; y++) {
      if (y < H && rows[y]) { if (s < 0) s = y; }
      else if (s >= 0) { if (y - s >= 20) bands.push([s, y - s]); s = -1; }
    }
    bmp.close();
    res.push({ f, W, H, bands });
  }
  return res;
}, { base: BASE, files });

await browser.close();

// 6-2-2 はスマホ幅（F-81b）を見る項目なので、狭いのは意図どおり
const NARROW_OK = new Set(['6-2-2']);

const bad = [];
for (const r of out) {
  if (r.error) { bad.push([r.f, `読めない: ${r.error}`]); continue; }
  const no = (r.f.match(/^(\d+-\d+-\d+)_/) || [])[1];
  const head = r.bands.find(b => b[1] >= 40 && b[1] <= 90);   // 高さ56px前後の帯
  if (head && head[0] > 4) bad.push([r.f, `ヘッダーが y=${head[0]} にある（本来は先頭）`, r.W]);
  else if (head && r.W < 1280 && !NARROW_OK.has(no))
    bad.push([r.f, `ヘッダー入りだが幅 ${r.W}px（左右が切れている）`, r.W]);
}
console.log(`走査: ${out.length} 枚 / 問題あり: ${bad.length} 枚\n`);
for (const b of bad) console.log(' ', b[0].padEnd(42), b[1]);
const items = [...new Set(bad.map(b => b[0].match(/^(\d+-\d+-\d+)_/)[1]))].sort();
console.log(`\n撮り直しが要る項目（${items.length}）:\n${items.join(' ')}`);
fs.writeFileSync('/tmp/audit_items.txt', items.join(' '));
