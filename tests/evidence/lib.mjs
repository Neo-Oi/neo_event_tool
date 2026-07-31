import { chromium } from 'playwright';

export const BASE = 'http://127.0.0.1:8010/';

export async function launch({ width = 1280, height = 900 } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('  [pageerror]', e.message));
  page.on('dialog', d => d.accept());
  return { browser, ctx, page };
}

export async function open(page, url = BASE) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page);
}

/** 描画は直列化されている（App.renderContent の世代番号）。「読み込み中…」が消えるまで待つ。 */
export async function settle(page, extra = 250) {
  await page.waitForFunction(() => {
    const c = document.getElementById('content');
    return c && !c.querySelector('.empty')?.textContent?.includes('読み込み中');
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

export async function tab(page, label) {
  await page.locator('#tabs button', { hasText: label }).first().click();
  await settle(page);
}

export async function setView(page, which) {
  const label = which === 'participant' ? '参加者ビュー' : '主催者ビュー';
  await page.locator('header button, #view button, [data-view]').filter({ hasText: label }).first().click();
  await settle(page);
}

export async function shot(page, file, { full = false, clip = null } = {}) {
  await page.screenshot({ path: file, fullPage: full, clip: clip || undefined });
}

export async function modalOk(page) {
  await page.locator('#mOk').click();
  await settle(page);
}

/** docs 1-3 の手順どおり「初期化 → 投入」の順で入れる。 */
export async function seed(page) {
  await tab(page, '設定');
  await page.click('#reset');
  await page.locator('#mOk').click();
  await page.waitForTimeout(1200);
  await page.click('#seed');
  await page.waitForFunction(() => !document.querySelector('#seed[disabled]'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await settle(page);
}

/** 画面の骨格だけを出す（操作できる要素と見出し）。セレクタ調査用。 */
export async function outline(page, root = '#content') {
  return page.$$eval(`${root} *`, els => els.filter(e =>
    /^(BUTTON|INPUT|SELECT|TEXTAREA|H2|H3|TH)$/.test(e.tagName)
  ).slice(0, 120).map(e => {
    const id = e.id ? '#' + e.id : '';
    const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '';
    const data = [...e.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${a.value}"]`).join('');
    const t = (e.tagName === 'INPUT' ? (e.placeholder || e.value || e.type) : (e.textContent || '')).trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${e.tagName}${id}${cls}${data} :: ${t}`;
  }));
}

export async function closeModal(page) {
  const host = page.locator('#modalHost');
  if (await host.count() && await host.isVisible().catch(() => false)) {
    const cancel = page.locator('#modalHost .modal-actions button').first();
    if (await cancel.count()) await cancel.click();
    await page.waitForTimeout(300);
  }
}

/** ページを持つコンテキスト（権限・オフライン・回線の細工に使う） */
export const ctxOf = (page) => page.context();

/** 指定URLへのリクエストを落とす（F12 の Block request URL 相当） */
export async function blockUrl(page, pattern) {
  await page.route(pattern, r => r.abort('failed'));
}

/** 回線を絞る（F12 の Slow 3G 相当） */
export async function throttle(page, { down = 400 * 1024 / 8, up = 400 * 1024 / 8, latency = 2000 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',
    { offline: false, downloadThroughput: down, uploadThroughput: up, latency });
  return cdp;
}
