/* 結合試験のエビデンス撮影。
   区分が「自動＋手動」の97項目について、実物の画面を撮って evidence/ に置く。
   命名は結合試験仕様書 6-2 の規則:  evidence/<項目番号>_<YYYYMMDD>_<連番>.png  */
import fs from 'node:fs';
import path from 'node:path';
import { launch, open, tab, settle, seed, closeModal, BASE } from './lib.mjs';
import { RECIPES } from './recipes.mjs';
import { RECIPES2 } from './recipes2.mjs';

const OUT = process.env.EVIDENCE_DIR || '/home/neo-oi/neo_event_tool/evidence';
const DATE = process.env.EVIDENCE_DATE || '20260731';
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));

fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
const ctx = {
  page,
  n: 0,
  no: '',
  /** 1項目に複数枚あるときは連番が増える */
  async shot(opts = {}) {
    this.n += 1;
    const pg = this.page;
    const file = path.join(OUT, `${this.no}_${DATE}_${String(this.n).padStart(2, '0')}.png`);
    await pg.waitForTimeout(opts.wait ?? 200);
    if (opts.sel) {
      const loc = pg.locator(opts.sel).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.screenshot({ path: file });
    } else {
      await pg.screenshot({ path: file, fullPage: opts.full !== false });
    }
    return file;
  },
};

/** 遮断・低速・権限・注入を使う項目は、後続に影響しないよう別のコンテキストで走らせる。
    コンテキストごとに IndexedDB は別なので、その中でもう一度デモデータを入れる。 */
async function freshPage() {
  const c = await browser.newContext({
    viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
  });
  const pg = await c.newPage();
  pg.on('pageerror', e => console.error('  [pageerror]', e.message));
  pg.on('dialog', d => d.accept());
  return { c, pg };
}

// --- 小道具 ---------------------------------------------------------------
const H = {
  async org(page) { await page.click('[data-role="organizer"]'); await settle(page); },
  async part(page) { await page.click('[data-role="participant"]'); await settle(page); },
  async orgTab(page, k) { await page.click(`#tabs button[data-page="${k}"]`); await settle(page); },
  async openEvent(page, id) {
    await H.orgTab(page, 'events');
    const card = page.locator(`.evcard[data-ev="${id}"]`);
    if (!(await card.count())) await page.click('[data-k="past"]');   // 終了・中止は既定で隠れている
    await page.locator(`.evcard[data-ev="${id}"]`).click();
    await settle(page);
  },
  async sub(page, name) { await page.click(`#subtabs button[data-tab="${name}"]`); await settle(page); },
  async unlockRoster(page) {
    await H.orgTab(page, 'roster');
    if (await page.locator('#lkPw').count()) { await page.fill('#lkPw', 'admin'); await page.click('#lkGo'); await settle(page); }
  },
  async login(page, email = 'abc@example.com', pw = 'abc123') {
    await page.click('#tabs button[data-page="myticket"]'); await settle(page);
    if (await page.locator('#lgEmail').count()) {
      await page.fill('#lgEmail', email); await page.fill('#lgPw', pw);
      await page.click('#lgGo'); await settle(page);
    }
  },
  async modalOk(page) { await page.locator('#mOk').click(); await settle(page); },
};

// --- 実行 -----------------------------------------------------------------
const ALL = [...RECIPES, ...RECIPES2];
const list = ALL.filter(r => !only.length || only.includes(r.no) || only.some(o => r.no.startsWith(o)));
console.log(`撮影対象: ${list.length} 項目\n`);

let ok = 0; const failed = [];
let dirty = true;   // 最初は必ず投入する

try {
  await open(page);
  for (const r of list) {
    ctx.no = r.no; ctx.n = 0;
    let iso = null, target = page;
    if (r.isolate) {
      iso = await freshPage(); target = iso.pg; ctx.page = target;
      await open(target); await seed(target); await open(target);
    } else {
      ctx.page = page;
      if (r.fresh !== false || dirty) { await open(page); await seed(page); dirty = false; }
      // ログイン（F-107）と名簿のロック（F-101）はセッション内だけの状態なので、
      // 前の項目の続きから始めないよう毎回開き直す。IndexedDB のデータは残る。
      await open(page);
    }
    process.stdout.write(`${r.no.padEnd(8)} ${(r.title || '').slice(0, 34).padEnd(36)}`);
    try {
      await r.run(target, ctx, H);
      if (ctx.n === 0 && !r.logOnly) throw new Error('スクリーンショットが1枚も撮られていない');
      console.log(r.logOnly ? 'OK (ログ)' : `OK (${ctx.n}枚)`);
      ok++;
    } catch (e) {
      console.log(`NG  ${String(e.message).split('\n')[0].slice(0, 90)}`);
      failed.push([r.no, e.message.split('\n')[0]]);
    }
    if (iso) { await iso.c.close().catch(() => {}); ctx.page = page; }
    else if (r.mutates !== false) dirty = true;
    await closeModal(page).catch(() => {});
  }
} finally {
  await browser.close();
}

console.log(`\n=== ${ok}/${list.length} 項目を撮影 ===`);
if (failed.length) {
  console.log('撮れなかった項目:');
  for (const [no, msg] of failed) console.log(`  ${no}: ${msg.slice(0, 110)}`);
  process.exitCode = 1;
}
