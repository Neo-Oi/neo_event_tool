/* 区分「手動」「自動」のうち、機械で撮れる47項目の撮影手順。
   撮れないのは 3-4-1〜3-4-4（カメラ＋2台目の実機）と 5-2-3（対象外）だけ。
   異常系は F12 でやることを Playwright 側で同じように起こしている
   （リクエスト遮断＝Block request URL、回線＝Slow 3G、権限拒否＝カメラのブロック）。 */
import fs from 'node:fs';
import path from 'node:path';
import { settle, open, BASE, blockUrl, throttle } from './lib.mjs';

const RO = { fresh: false, mutates: false };
const OUT = process.env.EVIDENCE_DIR || '/home/neo-oi/neo_event_tool/evidence';
const DATE = process.env.EVIDENCE_DATE || '20260731';

async function fillApply(page, { name, kana, email }) {
  await page.fill('#fName', name);
  await page.fill('#fKana', kana);
  await page.fill('#fEmail', email);
  for (const sel of await page.$$('#content select[data-q]')) {
    const opts = await sel.$$eval('option', os => os.map(o => o.value));
    if (opts.length > 1) await sel.selectOption(opts[1]);
  }
  for (const ta of await page.$$('#content textarea[data-q]')) await ta.fill('特にありません');
  for (const tx of await page.$$('#content input[data-q]')) {
    const t = (await tx.getAttribute('type')) || 'text';
    if (t === 'checkbox' || t === 'radio') await tx.check().catch(() => {});
    else await tx.fill('回答');
  }
  if (await page.locator('#fConsent').count()) await page.check('#fConsent');
  await page.click('#toConfirm');
  await settle(page);
}

/** 編集ウィザードを開いて指定ステップまで進む */
async function edit(p, H, id, step) {
  await H.openEvent(p, id);
  await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
  await p.click('#editBtn'); await settle(p);
  for (let i = 0; i < step; i++) { await p.click('#next'); await settle(p); }
}

const tmpFile = (name, size) => {
  const f = path.join('/tmp', name);
  fs.writeFileSync(f, size ? Buffer.alloc(size, 0x41) : `結合試験用のダミー：${name}\n`);
  return f;
};

export const RECIPES2 = [
  // ============ 1. ダッシュボード ============
  { no: '1-1-1', ...RO, title: '指標カード／4つの数字',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot({ sel: '#content' }); } },

  { no: '1-2-1', ...RO, title: '要対応リスト／一覧',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot(); } },

  { no: '1-2-2', ...RO, title: '要対応リスト／残作業の表示',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot(); } },

  { no: '1-2-3', ...RO, title: '要対応リスト／項目のクリック',
    run: async (p, c, H) => {
      await H.orgTab(p, 'dashboard'); await c.shot();
      await p.locator('#content [data-ev]').first().click(); await settle(p); await c.shot();
    } },

  { no: '1-3-2', ...RO, title: '申込ヒートマップ／中止イベントを数えない',
    run: async (p, c, H) => {
      await H.orgTab(p, 'dashboard'); await c.shot({ sel: '.card.pad.hm' });
      await H.openEvent(p, 'ev_cancel'); await c.shot();   // 中止イベントにも申込がある
    } },

  { no: '1-4-3', ...RO, title: '開催カレンダー／帯のクリック',
    run: async (p, c, H) => {
      await H.orgTab(p, 'dashboard'); await c.shot({ sel: '.card.cal' });
      await p.locator('.cal-chip[data-cal-ev]').first().click(); await settle(p); await c.shot();
    } },

  // ============ 2. イベント一覧・作成 ============
  { no: '2-1-3', ...RO, title: 'カード表示／カードのクリック',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_public"]' });
      await p.click('.evcard[data-ev="ev_public"]'); await settle(p); await c.shot();
    } },

  { no: '2-2-1', ...RO, title: '時期トグル／3つのボタン',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await c.shot();                                    // 初期（未定＋これから）
      await p.click('[data-k="past"]'); await settle(p); await c.shot();              // 終了・中止をON
      await p.click('[data-k="upcoming"]'); await settle(p); await c.shot();          // これからをOFF
    } },

  { no: '2-6-1', title: '公開範囲／公開済みは限定公開へ戻せない',
    run: async (p, c, H) => {
      await edit(p, H, 'ev_public', 4);
      await c.shot();                                                                  // 変更前
      await p.selectOption('[data-f="visibility"]', 'limited');
      // 公開済みは下書きへ戻せないので、最終ステップのボタンは「変更を保存」だけ（F-37）
      await p.click('#saveOnly');
      await settle(p); await c.shot({ wait: 500 });
    } },

  { no: '2-6-2', title: '公開範囲／下書きは自由に変えられる',
    run: async (p, c, H) => {
      await edit(p, H, 'ev_draft', 4);
      await p.selectOption('[data-f="visibility"]', 'limited');
      await p.click('#saveDraft'); await settle(p); await c.shot({ wait: 400 });
      await edit(p, H, 'ev_draft', 4);
      await p.selectOption('[data-f="visibility"]', 'public');
      await p.click('#saveDraft'); await settle(p); await c.shot({ wait: 400 });
    } },

  // ============ 3. イベント詳細 ============
  { no: '3-2-4', ...RO, title: '申込一覧／行の展開',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await c.shot();
      await p.locator('#content tbody tr').first().click(); await settle(p); await c.shot();
    } },

  { no: '3-3-3', title: 'チェックイン／キャンセル済みの行',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-cancel]').first().click(); await p.waitForTimeout(400);
      await p.click('#mOk'); await settle(p);
      await c.shot({ wait: 400 });                                                     // 受付ボタンが無い
    } },

  { no: '3-4-5', isolate: true, ...RO, title: 'QRで受付／カメラを起動できない',
    run: async (p, c, H) => {
      await p.context().clearPermissions();
      await H.openEvent(p, 'ev_public');
      await p.click('#qrBtn'); await p.waitForTimeout(2500);
      await c.shot({ full: false });
    } },

  { no: '3-4-6', isolate: true, ...RO, title: 'QRで受付／部品（jsQR）が取れない',
    run: async (p, c, H) => {
      await blockUrl(p, '**/jsqr*');
      await blockUrl(p, '**/jsQR*');
      await H.openEvent(p, 'ev_public');
      await p.click('#qrBtn'); await p.waitForTimeout(4000);
      await c.shot({ full: false });                                                   // QRだけエラー
      await p.click('#mCancel').catch(() => {}); await settle(p);
      await p.fill('#searchBox', '佐藤'); await settle(p);
      await c.shot();                                                                  // 氏名検索は使える
    } },

  { no: '3-4-7', isolate: true, ...RO, title: 'QRで受付／回線が遅い',
    run: async (p, c, H) => {
      await throttle(p);
      await H.openEvent(p, 'ev_public');
      await p.click('#qrBtn'); await p.waitForTimeout(1200);
      await c.shot({ full: false });                                                   // 読み込み中
      await p.waitForTimeout(8000);
      await c.shot({ full: false });                                                   // 完了後
    } },

  { no: '3-11-2', title: 'マニュアル／分割表示の入力',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="split"]'); await settle(p);
      const ta = p.locator('#content textarea').first();
      await ta.fill(''); await ta.click();
      await ta.type('# 分割表示の確認\n\n打つそばから右が更新される');
      await c.shot();
      const pos = await ta.evaluate(el => el.selectionStart);
      console.log(`\n      → 入力後のカーソル位置: ${pos}（0 なら先頭へ飛んでいる）`);
    } },

  { no: '3-11-6', title: 'マニュアル／空の項目でリストを抜ける',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="edit"]'); await settle(p);
      const ta = p.locator('#content textarea').first();
      await ta.fill(''); await ta.click();
      await ta.type('- 名札を用意する');
      await p.keyboard.press('Enter');
      await c.shot();                                                                  // 記号が継続している
      await p.keyboard.press('Enter');
      await c.shot();                                                                  // 「- 」だけの行で抜ける
      console.log(`\n      → 本文: ${JSON.stringify(await ta.inputValue())}`);
    } },

  { no: '3-12-2', title: 'ファイル／複数選択',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      await p.setInputFiles('#flInput', [tmpFile('進行台本.txt'), tmpFile('座席表.txt'), tmpFile('備品リスト.txt')]);
      await settle(p); await c.shot({ wait: 900 });
    } },

  { no: '3-12-3', title: 'ファイル／20MBの上限',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      await p.setInputFiles('#flInput', tmpFile('20MB超.bin', 21 * 1024 * 1024));
      await settle(p); await c.shot({ wait: 800 });                                    // 拒否される
      await p.setInputFiles('#flInput', tmpFile('20MBちょうど.bin', 20 * 1024 * 1024));
      await settle(p); await c.shot({ wait: 2500 });                                   // ちょうどは入る
    } },

  { no: '3-12-4', title: 'ファイル／ダウンロード',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      const [dl] = await Promise.all([
        p.waitForEvent('download', { timeout: 15000 }),
        p.locator('[data-dl]').first().click(),
      ]);
      const dest = path.join(OUT, `3-12-4_${DATE}_${dl.suggestedFilename()}`);
      await dl.saveAs(dest);
      console.log(`\n      → ${dl.suggestedFilename()} を保存（${fs.statSync(dest).size} bytes）`);
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-13-2', title: 'お知らせ／取り下げ',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'notice');
      await c.shot();                                                                  // 取り下げ前
      await p.locator('[data-ntdel]').first().click(); await p.waitForTimeout(400);
      await c.shot({ full: false });                                                   // 確認画面
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 350 });
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                                  // 参加者からも消える
    } },

  { no: '3-14-1', isolate: true, ...RO, title: '告知／URL・投稿文のコピー',
    run: async (p, c, H) => {
      await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'promo');
      await p.click('#copyUrl'); await settle(p); await c.shot({ wait: 350 });
      const url = await p.evaluate(() => navigator.clipboard.readText());
      await p.click('#copyPost'); await settle(p); await c.shot({ wait: 350 });
      const post = await p.evaluate(() => navigator.clipboard.readText());
      console.log(`\n      → URL: ${url}\n      → 投稿文の先頭: ${JSON.stringify(post.slice(0, 40))}`);
    } },

  { no: '3-14-2', isolate: true, ...RO, title: '告知／コピーの失敗',
    run: async (p, c, H) => {
      // クリップボードAPIを失敗させて注入する（仕様書の「コピー失敗を注入して」に対応）
      await p.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: () => Promise.reject(new Error('injected failure')) }, configurable: true });
        document.execCommand = () => false;
      });
      await open(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'promo');
      await p.click('#copyUrl'); await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '3-15-4', ...RO, title: '概要・編集／公開済みに削除ボタンが無い',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'edit'); await c.shot();       // 公開済み＝削除なし
      await H.openEvent(p, 'ev_draft'); await H.sub(p, 'edit'); await c.shot();        // 下書き＝削除あり
      const pub = await p.evaluate(() => [...document.querySelectorAll('#content button')].map(b => b.textContent.trim()));
      console.log(`\n      → 下書きのボタン: ${JSON.stringify(pub)}`);
    } },

  // ============ 4. 参加者ビュー ============
  { no: '4-1-2', ...RO, title: 'イベントを探す／残席の表示',
    run: async (p, c, H) => { await H.part(p); await c.shot(); } },

  { no: '4-1-4', title: 'イベントを探す／カバーが無くても高さが揃う',
    run: async (p, c, H) => {
      // 下書き（カバー無し）を公開して、カバー有り・無しを並べる
      await edit(p, H, 'ev_draft', 0);
      await p.fill('[data-f="startAt"]', '2026-09-18T13:00');
      await p.fill('[data-f="endAt"]', '2026-09-18T15:00');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="venueName"]', '本社 大会議室'); await p.click('#next'); await settle(p);
      await p.fill('[data-f="description"]', 'カバー画像を設定していないイベントです。'); await p.click('#next'); await settle(p);
      await p.fill('[data-f="capacity"]', '20'); await p.fill('[data-f="applyDeadline"]', '2026-09-15');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="contactInfo"]', '事務局 test@example.com');
      await p.click('#publish'); await p.waitForTimeout(500); await p.click('#mOk'); await settle(p);
      await H.part(p); await c.shot();
    } },

  { no: '4-2-1', ...RO, title: '公開ページ／並び順',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
    } },

  { no: '4-2-3', isolate: true, ...RO, title: '公開ページ／地図を新しいタブで開く',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      const link = p.locator('#content a', { hasText: '地図' }).first();
      if (!(await link.count())) {
        console.log('\n      → このイベントには住所が無いため地図リンクが出ない');
        await c.shot(); return;
      }
      await c.shot();
      const href = await link.getAttribute('href');
      // 外部サイトは実際には読み込まず、新しいタブが開くことと行き先だけを確かめる
      await p.context().route('**://www.google.com/**', r => r.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: `<h1>（外部サイトは読み込まない）</h1><p>開こうとしたURL:</p><pre>${href}</pre>` }));
      const [tab] = await Promise.all([p.context().waitForEvent('page'), link.click()]);
      await tab.waitForLoadState('domcontentloaded'); await tab.waitForTimeout(400);
      await tab.screenshot({ path: path.join(OUT, `4-2-3_${DATE}_02.png`) }); c.n = 2;
      console.log(`\n      → 新しいタブの行き先: ${href}`);
      await tab.close();
    } },

  { no: '4-3-1', ...RO, title: '申込フォーム／必須項目',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await p.click('#toConfirm'); await settle(p); await c.shot({ wait: 350 });
      const focused = await p.evaluate(() => document.activeElement && document.activeElement.id);
      console.log(`\n      → カーソルが移った欄: ${focused}`);
    } },

  { no: '4-3-2', ...RO, title: '申込フォーム／カナ欄に漢字',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await p.fill('#fName', '試験 太郎'); await p.fill('#fKana', '試験 太郎');
      await p.fill('#fEmail', 'kana-test@example.com');
      await p.click('#toConfirm'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '4-3-7', title: '申込フォーム／中止かつ満席',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_cancel`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
      const msg = await p.evaluate(() => document.querySelector('#content').innerText);
      console.log(`\n      → 断りの理由: ${JSON.stringify((msg.match(/中止|満席|受付終了/g) || []).join(','))}`);
    } },

  { no: '4-3-10', title: '申込フォーム／締切の瞬間',
    run: async (p, c, H) => {
      const setDeadline = async (date) => {
        // 公開ページを見た後は参加者ビューにいるので、主催者へ戻してから編集に入る
        if (!(await p.locator('#tabs button[data-page="events"]').count())) await H.org(p);
        await edit(p, H, 'ev_seminar', 3);
        await p.fill('[data-f="applyDeadline"]', date);
        await p.click('#next'); await settle(p);
        await p.click('#saveOnly'); await settle(p);   // 公開済みなので「変更を保存」
      };
      await setDeadline('2026-07-31');                 // 今日＝締切当日
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                                  // 締切当日は申込める
      await setDeadline('2026-07-30');                 // 昨日＝締切超過
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                                  // 翌日は受付終了
    } },

  // ============ 6. 共通 ============
  { no: '6-1-2', ...RO, title: 'URLから開く／確認用URLの改ざん',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?ticket=ffffffffffffffff`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot(); console.log(`\n      → 復帰後のURL: ${p.url()}`);
    } },

  { no: '6-1-3', title: 'URLから開く／キャンセル済みの確認URL',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      const id = await p.locator('[data-cancel]').first().getAttribute('data-cancel');
      await p.locator(`[data-cancel="${id}"]`).click(); await p.waitForTimeout(400);
      await p.click('#mOk'); await settle(p);
      const token = await p.evaluate(async (aid) => await new Promise(res => {
        const r = indexedDB.open('neo_event_tool');
        r.onsuccess = () => { const t = r.result.transaction('applications').objectStore('applications').get(aid);
          t.onsuccess = () => res(t.result && t.result.token); };
      }), id);
      await p.goto(`${BASE}?ticket=${token}`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
    } },

  { no: '6-1-5', ...RO, title: 'URLから開く／イベントURLの改ざん',
    run: async (p, c, H) => {
      for (const q of ['ev_draft', 'ev_nonexistent']) {
        await p.goto(`${BASE}?event=${q}`, { waitUntil: 'domcontentloaded' }); await settle(p);
        await c.shot();
      }
    } },

  { no: '6-1-6', ...RO, title: 'URLから開く／中止イベント',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_cancel`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
    } },

  { no: '6-1-8', ...RO, title: 'URLから開く／再読み込みで二重処理しない',
    run: async (p, c, H) => {
      const token = await p.evaluate(async () => await new Promise(res => {
        const r = indexedDB.open('neo_event_tool');
        r.onsuccess = () => { const t = r.result.transaction('applications').objectStore('applications').getAll();
          t.onsuccess = () => res((t.result.find(a => a.status === 'applied') || {}).token); };
      }));
      await p.goto(`${BASE}?ticket=${token}`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot(); console.log(`\n      → 再読み込み後のURL: ${p.url()}`);
    } },

  { no: '6-3-3', isolate: true, ...RO, title: '表示と保存／保存機能が使えない',
    run: async (p, c, H) => {
      // IndexedDB を開けない状態を注入する（シークレットモード等の再現）
      await p.addInitScript(() => {
        const orig = indexedDB.open.bind(indexedDB);
        indexedDB.open = function () {
          const req = orig.apply(this, arguments);
          setTimeout(() => {
            Object.defineProperty(req, 'error', { value: new DOMException('injected', 'InvalidStateError') });
            req.onerror && req.onerror(new Event('error'));
          }, 0);
          return req;
        };
      });
      await open(p); await p.waitForTimeout(2500);
      await c.shot();                                                                  // 真っ白にならず案内が出る
    } },

  { no: '6-3-4', isolate: true, ...RO, title: '表示と保存／書体が取れない',
    run: async (p, c, H) => {
      await blockUrl(p, '**fonts.gstatic.com/**');
      await open(p); await p.waitForTimeout(1500);
      await H.orgTab(p, 'dashboard'); await c.shot({ sel: 'header' }); await c.shot();
    } },

  { no: '6-3-5', isolate: true, title: '表示と保存／容量がいっぱい',
    run: async (p, c, H) => {
      await p.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (v, k) {
          if (this.name === 'files') throw new DOMException('injected', 'QuotaExceededError');
          return put.call(this, v, k);
        };
      });
      await open(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      await p.setInputFiles('#flInput', tmpFile('容量テスト.txt'));
      await settle(p); await c.shot({ wait: 900 });                                    // エラーだけ出る
      await H.sub(p, 'apply'); await c.shot();                                         // 既存データは無事
    } },

  { no: '6-3-7', title: '表示と保存／2画面から同時申込',
    run: async (p, c, H) => {
      await edit(p, H, 'ev_soon', 3);
      await p.fill('[data-f="capacity"]', '19');    // 申込18件 → 残席1にする
      await p.click('#next'); await settle(p);
      await p.click('#saveDraft').catch(() => {});
      const p2 = await p.context().newPage();
      const go = async (pg, name) => {
        await pg.goto(`${BASE}?event=ev_soon`, { waitUntil: 'domcontentloaded' }); await settle(pg);
        await pg.click('#apply'); await settle(pg);
        await fillApply(pg, { name, kana: 'ドウジ タロウ', email: `${name}@example.com` });
      };
      await go(p, 'douji-a'); await go(p2, 'douji-b');
      await c.shot();
      await Promise.all([
        p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click(),
        p2.locator('#content button', { hasText: /申込む|申し込む/ }).first().click(),
      ]);
      await settle(p); await settle(p2);
      await c.shot();
      await p2.screenshot({ path: path.join(OUT, `6-3-7_${DATE}_03.png`), fullPage: true }); c.n = 3;
      await p2.close();
      await H.org(p); await H.openEvent(p, 'ev_soon'); await c.shot();                 // 実際の申込数
    } },

  { no: '6-4-1', ...RO, title: 'メッセージ表示／入力エラーは欄の下',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await p.click('#toConfirm'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '6-4-2', title: 'メッセージ表示／完了は右下に数秒',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('button[data-checkin]', { hasText: 'チェックイン' }).first().click();
      await p.waitForTimeout(300); await c.shot({ full: false });                      // 出た直後
      await p.waitForTimeout(6000); await c.shot({ full: false });                     // 自然に消えた
    } },

  { no: '6-4-3', isolate: true, ...RO, title: 'メッセージ表示／システムエラーは上部バナー',
    run: async (p, c, H) => {
      await p.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (v, k) {
          if (this.name === 'messages') throw new DOMException('injected', 'InvalidStateError');
          return put.call(this, v, k);
        };
      });
      await open(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '運営A'); await p.fill('#opBody', 'システムエラーの確認');
      await p.click('#opSend'); await p.waitForTimeout(1200);
      await c.shot();                                                                  // 赤いバナーが残る
      await p.waitForTimeout(7000); await c.shot();                                    // 閉じるまで消えない
    } },

  { no: '6-3-8', ...RO, logOnly: true, title: '表示と保存／版上げの引き継ぎ（CIログ）',
    run: async () => { /* ログは撮影の外で保存する */ } },

  // ============ 7. 通しシナリオ ============
  { no: '7-2-1', title: '通し：当日受付（氏名検索のパターン）',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await c.shot();                                                                  // 未受付・受付済みが混在
      await p.locator('button[data-checkin]', { hasText: 'チェックイン' }).first().click();
      await settle(p); await c.shot({ wait: 350 });                                    // 未受付 → 受付できる
      await p.locator('button[data-checkin]', { hasText: '受付取消' }).first().click();
      await settle(p);
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-cancel]').first().click(); await p.waitForTimeout(400);
      await p.click('#mOk'); await settle(p);
      await c.shot({ wait: 400 });                                                     // キャンセル済み → 受付不可
      await p.fill('#searchBox', '佐藤'); await settle(p); await c.shot();             // 氏名検索
      console.log('\n      → QR側の3パターン（3-4-1〜3-4-4）はカメラと2台目の端末が要るため手動');
    } },

  { no: '7-11-1', isolate: true, title: '通し：通信が無くても主要業務が続く',
    run: async (p, c, H) => {
      // F12 の Offline は localhost も含めて全部落ちるので、**読み込んだ後に**切り替える
      // （実機でも、開いてある画面を Offline にしてから操作する手順になる）
      const cx = p.context();
      await open(p); await settle(p);
      await cx.setOffline(true);
      await H.orgTab(p, 'dashboard'); await c.shot();                                  // 表示は続く
      await H.orgTab(p, 'events'); await c.shot();
      await H.openEvent(p, 'ev_public');
      await p.fill('#searchBox', '佐藤'); await settle(p); await c.shot();             // 氏名検索
      await p.fill('#searchBox', ''); await settle(p);   // 絞り込みを戻す（佐藤さんは受付済み）
      await p.locator('button[data-checkin]', { hasText: 'チェックイン' }).first().click();
      await settle(p); await c.shot({ wait: 350 });                                    // 受付できる
      const dl = await Promise.all([
        p.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        p.click('#csvBtn'),
      ]);
      console.log(`\n      → オフラインでもCSVが出せた: ${!!dl[0]}`);
      await c.shot({ wait: 350 });
      await p.click('#qrBtn'); await p.waitForTimeout(4000);
      await c.shot({ full: false });                                                   // QRだけ止まる
      await cx.setOffline(false);
    } },
];
