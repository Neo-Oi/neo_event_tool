/* 区分「自動＋手動」97項目の撮影手順。
   仕様書の「手順」欄をそのまま操作に落としている。read-only の項目は
   fresh:false / mutates:false を付けて、デモデータの再投入を省く。 */
import fs from 'node:fs';
import path from 'node:path';
import { settle, open, BASE } from './lib.mjs';

const RO = { fresh: false, mutates: false };
const OUT = process.env.EVIDENCE_DIR || '/home/neo-oi/neo_event_tool/evidence';
const DATE = process.env.EVIDENCE_DATE || '20260731';

/** ダウンロード物そのものを残す（仕様書 6-2「出力ファイル」）。 */
async function saveDownload(page, no, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), trigger()]);
  const name = dl.suggestedFilename();
  const dest = path.join(OUT, `${no}_${DATE}_${name}`);
  await dl.saveAs(dest);
  return { dest, name };
}

/** 申込フォームを埋めて確認画面まで進む */
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
    const type = (await tx.getAttribute('type')) || 'text';
    if (type === 'checkbox' || type === 'radio') await tx.check().catch(() => {});
    else await tx.fill('回答');
  }
  // 質問がラジオ／チェックのグループで包まれている場合（input に data-q が付かない形）
  for (const g of await page.$$('#content [data-q] input[type="radio"], #content [data-q] input[type="checkbox"]')) {
    const nm = await g.getAttribute('name');
    if (!nm || !(await page.locator(`#content input[name="${nm}"]:checked`).count())) await g.check().catch(() => {});
  }
  if (await page.locator('#fConsent').count()) await page.check('#fConsent');
  await page.click('#toConfirm');
  await settle(page);
}

export const RECIPES = [
  // ===================== 1. ダッシュボード =====================
  { no: '1-3-1', ...RO, title: '申込ヒートマップ／マス目',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot({ sel: '.card.pad.hm' }); } },

  { no: '1-4-1', ...RO, title: '開催カレンダー／イベントの帯',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot({ sel: '.card.cal' }); } },

  { no: '1-4-2', ...RO, title: '開催カレンダー／月の移動',
    run: async (p, c, H) => {
      await H.orgTab(p, 'dashboard');
      await c.shot({ sel: '.card.cal' });                      // 今月
      await p.click('#calNext'); await settle(p); await c.shot({ sel: '.card.cal' });   // 次の月
      await p.click('#calPrev'); await p.click('#calPrev'); await settle(p); await c.shot({ sel: '.card.cal' }); // 前の月
      await p.click('#calToday'); await settle(p); await c.shot({ sel: '.card.cal' });  // 今月へ戻る
    } },

  { no: '1-4-4', ...RO, title: '開催カレンダー／日程未定',
    run: async (p, c, H) => { await H.orgTab(p, 'dashboard'); await c.shot({ sel: '.card.cal' }); } },

  // ===================== 2. イベント一覧・作成 =====================
  { no: '2-1-1', ...RO, title: 'カード表示／カードの内容',
    run: async (p, c, H) => { await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_public"]' }); } },

  { no: '2-1-2', ...RO, title: 'カード表示／要対応の見出し',
    run: async (p, c, H) => { await H.orgTab(p, 'events'); await c.shot(); } },

  { no: '2-3-1', title: 'ステップ操作／イベント名が空',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await p.click('#newEvent'); await settle(p);
      await p.click('#next'); await settle(p); await c.shot();
    } },

  { no: '2-3-2', title: 'ステップ操作／保存して次へ',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await p.click('#newEvent'); await settle(p);
      await p.fill('[data-f="title"]', '結合試験用イベント');
      await p.click('#next'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '2-3-3', title: 'ステップ操作／途中離脱',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await p.click('#newEvent'); await settle(p);
      await p.fill('[data-f="title"]', '途中離脱の確認イベント');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="venueName"]', '本社 大会議室');
      await p.click('#next'); await settle(p);
      await p.click('#back'); await settle(p); await c.shot();          // 一覧に下書きが残る
      await p.locator('.evcard', { hasText: '途中離脱の確認イベント' }).first().click(); await settle(p);
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p); await c.shot();       // 続きから再開できる
    } },

  { no: '2-4-1', title: '公開前チェック／締切が開催日より後',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_draft');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      await p.fill('[data-f="startAt"]', '2026-09-01T13:00');
      await p.fill('[data-f="endAt"]', '2026-09-01T15:00');
      for (let i = 0; i < 3; i++) { await p.click('#next'); await settle(p); }
      await p.fill('[data-f="applyDeadline"]', '2026-09-30');
      await p.click('#next'); await settle(p);
      await p.click('#check'); await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '2-4-2', title: '公開前チェック／問い合わせ先が空',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_draft');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      await p.fill('[data-f="startAt"]', '2026-09-01T13:00');
      for (let i = 0; i < 4; i++) { await p.click('#next'); await settle(p); }
      await p.click('#publish'); await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '2-4-3', title: '公開前チェック／公開する',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_draft');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      await p.fill('[data-f="startAt"]', '2026-09-01T13:00');
      await p.fill('[data-f="endAt"]', '2026-09-01T15:00');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="venueName"]', '本社 大会議室');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="description"]', '結合試験 2-4-3 で公開まで通すためのイベントです。');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="capacity"]', '30');
      await p.fill('[data-f="applyDeadline"]', '2026-08-25');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="contactInfo"]', '結合試験事務局 test@example.com');
      await p.click('#check'); await settle(p); await c.shot({ wait: 400 });  // 不備なし
      await p.click('#publish'); await p.waitForTimeout(500);
      await c.shot({ full: false });                                  // 確認画面
      await p.click('#mOk'); await settle(p);
      await H.orgTab(p, 'events'); await c.shot();                    // バッジが「公開中」
    } },

  { no: '2-5-1', title: '定員／申込数を下回る値',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      for (let i = 0; i < 3; i++) { await p.click('#next'); await settle(p); }
      await p.fill('[data-f="capacity"]', '4');
      await p.click('#next'); await settle(p); await c.shot({ wait: 400 });
    } },

  // ===================== 3. イベント詳細 =====================
  { no: '3-1-1', ...RO, title: '固定表示／上部の状況',
    run: async (p, c, H) => { await H.openEvent(p, 'ev_public'); await c.shot({ full: false }); } },

  { no: '3-1-2', title: '固定表示／数字の連動',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await c.shot({ full: false });                                  // チェックイン前
      await p.locator('[data-checkin]').first().click(); await settle(p);
      await c.shot({ full: false, wait: 400 });                       // 受付数・残席が動く
    } },

  { no: '3-2-1', ...RO, title: '申込タブ／一覧の列',
    run: async (p, c, H) => { await H.openEvent(p, 'ev_public'); await c.shot(); } },

  { no: '3-2-2', ...RO, title: '申込タブ／検索',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.fill('#searchBox', '佐藤'); await settle(p); await c.shot();
    } },

  { no: '3-2-3', ...RO, title: '申込タブ／表記ゆれ',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.fill('#searchBox', 'さとう'); await settle(p); await c.shot();
    } },

  { no: '3-3-1', title: '申込タブ／チェックイン',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('button[data-checkin]', { hasText: 'チェックイン' }).first().click();
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-3-2', title: '申込タブ／受付取消',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('button[data-checkin]', { hasText: '受付取消' }).first().click();
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-5-1', title: '申込タブ／内容の修正',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-edit]').first().click(); await p.waitForTimeout(400);
      await c.shot({ full: false });                                   // 修正モーダル
      const nm = p.locator('#modalHost input').first();
      await nm.fill('佐藤 次郎（修正後）');
      await p.locator('#modalHost .modal-actions button').last().click();
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-5-2', title: '申込タブ／メールの重複',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-edit]').first().click(); await p.waitForTimeout(400);
      const mail = p.locator('#modalHost input[type="email"], #modalHost input').nth(2);
      await mail.fill('abc@example.com');
      await p.locator('#modalHost .modal-actions button').last().click();
      await p.waitForTimeout(600); await c.shot({ full: false });
    } },

  { no: '3-5-3', title: '申込タブ／キャンセル',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-cancel]').first().click(); await p.waitForTimeout(400);
      await c.shot({ full: false });                                   // 確認画面
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-6-1', title: '申込タブ／CSV出力',
    run: async (p, c, H, ) => {
      await H.openEvent(p, 'ev_public');
      const { name } = await saveDownload(p, '3-6-1', () => p.click('#csvBtn'));
      console.log(`\n      → CSVを保存: ${name}`);
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-6-2', title: 'CSV／数式の無害化',
    run: async (p, c, H) => {
      // 氏名が「=1+1」の申込を作ってから出力する
      await H.openEvent(p, 'ev_public');
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-edit]').first().click(); await p.waitForTimeout(400);
      await p.locator('#modalHost input').first().fill('=1+1');
      await p.locator('#modalHost .modal-actions button').last().click(); await settle(p);
      await c.shot({ wait: 300 });
      const { dest } = await saveDownload(p, '3-6-2', () => p.click('#csvBtn'));
      const head = fs.readFileSync(dest, 'utf8').split('\n').slice(0, 3).join('\n');
      console.log(`\n      → CSV先頭: ${JSON.stringify(head.slice(0, 120))}`);
    } },

  { no: '3-7-1', ...RO, title: '申込タブ／申込の推移',
    run: async (p, c, H) => { await H.openEvent(p, 'ev_public'); await c.shot(); } },

  { no: '3-8-1', title: '運営スレッド／投稿',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '運営A');
      await p.fill('#opBody', '結合試験の確認です。会場の鍵は前日に受け取ります。');
      await p.click('#opSend'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-8-2', ...RO, title: '運営スレッド／未読バッジ',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await c.shot({ sel: '#subtabs' });
      await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_public"]' });
    } },

  { no: '3-8-3', title: '運営スレッド／既読化',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await c.shot({ sel: '#subtabs' });   // 未読あり
      await H.sub(p, 'thread'); await settle(p);
      await H.orgTab(p, 'events'); await H.openEvent(p, 'ev_public');
      await c.shot({ sel: '#subtabs' });                                       // 未読が消える
    } },

  { no: '3-9-1', title: '運営Q&A／登録',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'qa');
      await p.fill('#qaBody', '受付の机は何台必要ですか？');
      await p.fill('#qaAuthor', '運営C');
      await p.click('#qaAdd'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-9-2', title: '運営Q&A／解決にする',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'qa');
      const open = p.locator('button[data-toggle]', { hasText: '解決にする' }).first();
      const id = await open.getAttribute('data-toggle');
      await p.locator(`textarea[data-ansbody="${id}"]`).fill('2台で足ります。');
      await p.locator(`button[data-ans="${id}"]`).click(); await settle(p);
      await p.locator(`button[data-toggle="${id}"]`).click(); await settle(p);
      await c.shot({ wait: 350 });
      await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_public"]' });
    } },

  { no: '3-10-1', title: '運営タスク／追加',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await p.click('#tkAdd'); await p.waitForTimeout(400);
      await p.fill('#tkTitle', '結合試験：受付の動線を確認する');
      await c.shot({ full: false });
      await p.click('#tkSave'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-10-2', title: '運営タスク／ドラッグで状態変更',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await c.shot();
      const card = p.locator('.tcard[draggable="true"]').first();
      const cols = p.locator('#content [class*=col], #content [data-status]');
      await card.dragTo(cols.nth(1)).catch(async () => {
        // HTML5 DnD が мouse 経由で動かない場合は、ブラウザ側で drag イベントを合成する
        await p.evaluate(() => {
          const src = document.querySelector('.tcard[draggable="true"]');
          const cols = [...document.querySelectorAll('[data-status]')];
          const dst = cols.find(c => c.dataset.status && !c.contains(src));
          if (!src || !dst) return;
          const dt = new DataTransfer();
          src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
          dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
          src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        });
      });
      await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '3-10-3', title: '運営タスク／再読み込みで保たれる',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await p.evaluate(() => {
        const src = document.querySelector('.tcard[draggable="true"]');
        const cols = [...document.querySelectorAll('[data-status]')];
        const dst = cols.find(x => !x.contains(src));
        if (!src || !dst) return;
        const dt = new DataTransfer();
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      });
      await settle(p); await c.shot();
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await c.shot();
    } },

  { no: '3-10-4', ...RO, title: '運営タスク／タイムライン',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await p.click('[data-view="timeline"]'); await settle(p); await c.shot();
    } },

  { no: '3-10-5', ...RO, title: '運営タスク／期限超過',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_soon'); await H.sub(p, 'tasks'); await c.shot();
      await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_soon"]' });
    } },

  { no: '3-11-1', ...RO, title: 'マニュアル／表示切替',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await c.shot();                                                        // 既定＝プレビュー
      await p.click('[data-mode="edit"]'); await settle(p); await c.shot();
      await p.click('[data-mode="split"]'); await settle(p); await c.shot();
    } },

  { no: '3-11-3', title: 'マニュアル／Markdown の整形',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="edit"]'); await settle(p);
      const ta = p.locator('#content textarea').first();
      await ta.fill('# 当日の流れ\n\n## 受付\n\n- 名札を用意する\n- 参加者名簿を印刷する\n\n| 時刻 | 内容 |\n|---|---|\n| 13:00 | 開場 |\n| 13:30 | 開演 |\n');
      await p.click('#mnSave'); await settle(p);
      await p.click('[data-mode="preview"]'); await settle(p); await c.shot();
    } },

  { no: '3-11-4', title: 'マニュアル／javascript: はリンクにしない',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="edit"]'); await settle(p);
      await p.locator('#content textarea').first()
        .fill('# リンクの安全確認\n\n[危険](javascript:alert(1))\n\n[安全](https://comthink.co.jp/)\n');
      await p.click('#mnSave'); await settle(p);
      await p.click('[data-mode="preview"]'); await settle(p); await c.shot();
      const hrefs = await p.$$eval('#content a', as => as.map(a => a.getAttribute('href')));
      console.log(`\n      → プレビュー内のリンク: ${JSON.stringify(hrefs)}`);
    } },

  { no: '3-11-5', title: 'マニュアル／リストの自動継続',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="edit"]'); await settle(p);
      const ta = p.locator('#content textarea').first();
      await ta.fill(''); await ta.click();
      await ta.type('- 名札を用意する');
      await p.keyboard.press('Enter'); await ta.type('参加者名簿を印刷する');
      await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
      await ta.type('1. 受付に立つ');
      await p.keyboard.press('Enter'); await ta.type('誘導する');
      await c.shot();
    } },

  { no: '3-11-7', title: 'マニュアル／Shift+Enter は通常の改行',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'manual');
      await p.click('[data-mode="edit"]'); await settle(p);
      const ta = p.locator('#content textarea').first();
      await ta.fill(''); await ta.click();
      await ta.type('- 名札を用意する');
      await p.keyboard.press('Shift+Enter'); await ta.type('（続き。行頭に記号が入らないこと）');
      await c.shot();
    } },

  { no: '3-12-1', title: 'ファイル／追加',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      const tmp = path.join('/tmp', '会場レイアウト.txt');
      fs.writeFileSync(tmp, '結合試験用のダミーファイルです。\n会場レイアウト：受付＝入口右手、机2台。\n');
      await p.setInputFiles('#flInput', tmp); await settle(p);
      await c.shot({ wait: 500 });
    } },

  { no: '3-12-5', title: 'ファイル／削除',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      await p.locator('[data-fdel]').first().click(); await p.waitForTimeout(400);
      await c.shot({ full: false });                                    // 確認画面
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '3-13-1', title: 'お知らせ／掲示',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'notice');
      await p.fill('#ntTitle', '【結合試験】開催場所を4階から6階に変更しました');
      await p.fill('#ntBody', '会場が6階セミナールームに変わりました。お間違えのないようお願いします。');
      await p.fill('#ntAuthor', 'カンファレンス事務局');
      await p.click('#ntAdd'); await settle(p); await c.shot({ wait: 350 });
      // 参加者側の公開ページに出ることを確認する
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
    } },

  { no: '3-14-3', ...RO, title: '告知／X・LINE の共有',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'promo');
      await c.shot();
      const links = await p.$$eval('#xShare, #lineShare', as => as.map(a => `${a.id}: ${a.href}`));
      console.log(`\n      → 共有リンク: ${JSON.stringify(links, null, 0).slice(0, 240)}`);
    } },

  { no: '3-15-1', title: '概要・編集／複製',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'edit');
      await p.click('#dupBtn'); await p.waitForTimeout(400);
      await c.shot({ full: false });                                    // 確認画面
      await p.click('#mOk'); await settle(p);
      await H.orgTab(p, 'events'); await c.shot();                      // （コピー）付きの下書き
    } },

  { no: '3-15-2', title: '概要・編集／公開する',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_partner'); await H.sub(p, 'edit');
      await c.shot();
      const pub = p.locator('#content button', { hasText: /^公開する/ }).first();
      if (await pub.count()) {
        await pub.click(); await p.waitForTimeout(400); await c.shot({ full: false });
      }
    } },

  { no: '3-15-3', title: '概要・編集／中止する',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'edit');
      await p.click('#cancelBtn'); await p.waitForTimeout(400);
      await c.shot({ full: false });                                    // 確認画面
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 400 });
    } },

  // ===================== 4. 参加者ビュー =====================
  { no: '4-1-1', ...RO, title: 'イベントを探す／出るイベント',
    run: async (p, c, H) => { await H.part(p); await c.shot(); } },

  { no: '4-1-3', ...RO, title: 'イベントを探す／カバー画像の帯',
    run: async (p, c, H) => { await H.part(p); await c.shot({ sel: '.pcard' }); } },

  { no: '4-2-2', ...RO, title: '公開ページ／申込ボタンの文言',
    run: async (p, c, H) => {
      await H.part(p);
      for (const id of ['ev_public', 'ev_before', 'ev_past', 'ev_cancel']) {
        await p.goto(`${BASE}?event=${id}`, { waitUntil: 'domcontentloaded' }); await settle(p);
        await c.shot();
      }
    } },

  { no: '4-2-4', ...RO, title: '公開ページ／視聴URLは出さない',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
      const leaked = await p.evaluate(() => document.body.innerText.includes('teams.microsoft.com'));
      console.log(`\n      → 公開ページに視聴URLが出ている: ${leaked}`);
    } },

  { no: '4-3-3', title: '申込フォーム／必須の質問が空',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await p.fill('#fName', '試験 太郎'); await p.fill('#fKana', 'シケン タロウ');
      await p.fill('#fEmail', 'shiken@example.com');
      if (await p.locator('#fConsent').count()) await p.check('#fConsent');
      await p.click('#toConfirm'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '4-3-4', title: '申込フォーム／確認→申込',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '試験 花子', kana: 'シケン ハナコ', email: 'hanako-test@example.com' });
      await c.shot();                                                   // 確認画面
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click(); await settle(p);
      await c.shot({ wait: 400 });                                      // 完了画面
      await H.org(p); await H.openEvent(p, 'ev_public');
      await p.fill('#searchBox', '試験 花子'); await settle(p); await c.shot();
    } },

  { no: '4-3-5', title: '申込フォーム／満席ちょうど',
    run: async (p, c, H) => {
      // 定員2・申込0のイベントを作り、2人目までは通り3人目で止まることを見る
      await H.openEvent(p, 'ev_soon');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      for (let i = 0; i < 3; i++) { await p.click('#next'); await settle(p); }
      const now = await p.locator('#content').innerText();
      await c.shot();
      console.log(`\n      → 定員欄の現状を撮影（${now.slice(0, 40).replace(/\n/g, ' ')}）`);
      await H.part(p);
      await p.goto(`${BASE}?event=ev_soon`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                   // 残席の表示
    } },

  { no: '4-3-6', title: '申込フォーム／二重申込',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '田中 太郎', kana: 'タナカ タロウ', email: 'abc@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '4-3-8', title: '申込フォーム／メールの表記ゆれ',
    run: async (p, c, H) => {
      // 同じアドレスを①小文字そのまま ②大文字＋前後スペース で別イベントに申込み、
      // 名簿で1人にまとまることを見る（emailKey は trim と小文字化だけで正規化する）
      await H.part(p);
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '表記 ゆれ', kana: 'ヒョウキ ユレ', email: 'yure-test@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click(); await settle(p);
      await c.shot({ wait: 350 });
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '表記 ゆれ', kana: 'ヒョウキ ユレ', email: '  YURE-Test@Example.COM  ' });
      await c.shot();                                                    // 確認画面
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click(); await settle(p);
      await c.shot({ wait: 400 });
      await H.org(p); await H.unlockRoster(p);
      await p.fill('#rSearch', 'yure-test'); await settle(p); await c.shot();   // 名簿では1行
    } },

  { no: '4-3-9', title: '申込フォーム／拒否されたら残らない',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '田中 太郎', kana: 'タナカ タロウ', email: 'abc@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });                     // 拒否される
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                   // 再読み込みしても増えていない
      await H.org(p); await H.openEvent(p, 'ev_public'); await c.shot();
    } },

  { no: '4-4-1', title: '申込完了／完了画面',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '完了 確認', kana: 'カンリョウ カクニン', email: 'kanryo@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });
      const det = p.locator('#content details, #content summary').first();
      if (await det.count()) { await det.click(); await settle(p); await c.shot(); }
    } },

  { no: '4-5-1', ...RO, title: 'マイ申込／未ログイン',
    run: async (p, c, H) => {
      await H.part(p); await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await c.shot();
    } },

  { no: '4-5-2', ...RO, title: 'マイ申込／正しい情報でログイン',
    run: async (p, c, H) => { await H.part(p); await H.login(p); await c.shot(); } },

  { no: '4-5-3', ...RO, title: 'マイ申込／誤ったパスワード',
    run: async (p, c, H) => {
      await H.part(p); await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await p.fill('#lgEmail', 'abc@example.com'); await p.fill('#lgPw', 'wrong-password');
      await p.click('#lgGo'); await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '4-5-4', ...RO, title: 'マイ申込／ログインの解除',
    run: async (p, c, H) => {
      await H.part(p); await H.login(p); await c.shot();                 // ログイン済み
      const out = p.locator('#content button', { hasText: /ログアウト/ }).first();
      if (await out.count()) { await out.click(); await settle(p); await c.shot(); }
      // 再読み込み（読み込み直すと主催者ビューから始まるので、参加者ビューへ戻してから見る）
      await H.part(p); await H.login(p);
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await H.part(p);
      await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await c.shot();                                                    // 再読み込みで解除
      await H.login(p);
      await H.org(p); await H.part(p);
      await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await c.shot();                                                    // ビュー切替でも解除
    } },

  { no: '4-5-5', ...RO, title: 'マイ申込／詳細の表示内容',
    run: async (p, c, H) => {
      await H.part(p); await H.login(p);
      await p.locator('#content [data-app], #content .card').first().click(); await settle(p);
      await c.shot();
    } },

  { no: '4-5-6', ...RO, title: 'マイ申込／視聴URL',
    run: async (p, c, H) => {
      await H.part(p); await H.login(p);
      const cards = p.locator('#content [data-app], #content .card');
      for (let i = 0; i < Math.min(await cards.count(), 6); i++) {
        await cards.nth(i).click(); await settle(p);
        if ((await p.locator('#content').innerText()).includes('http')) { await c.shot(); return; }
        await p.click('#tabs button[data-page="myticket"]').catch(() => {}); await settle(p);
      }
      await c.shot();
    } },

  { no: '4-5-7', ...RO, title: 'マイ申込／受付用QR',
    run: async (p, c, H) => {
      await H.part(p); await H.login(p);
      await p.locator('#content [data-app], #content .card').first().click(); await settle(p);
      const qr = p.locator('#content button', { hasText: /QR/ }).first();
      if (await qr.count()) { await qr.click(); await settle(p); }
      await c.shot({ wait: 600 });
    } },

  { no: '4-5-8', title: 'マイ申込／キャンセル',
    run: async (p, c, H) => {
      await H.part(p); await H.login(p);
      await p.locator('#content [data-app], #content .card').first().click(); await settle(p);
      const btn = p.locator('#content button', { hasText: /キャンセル/ }).first();
      await btn.click(); await p.waitForTimeout(400); await c.shot({ full: false });
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 400 });
    } },

  { no: '4-5-9', ...RO, title: 'マイ申込／カバー画像の帯',
    run: async (p, c, H) => { await H.part(p); await H.login(p); await c.shot(); } },

  // ===================== 5. 名簿・設定 =====================
  { no: '5-1-1', ...RO, title: '参加者名簿／保護',
    run: async (p, c, H) => { await H.orgTab(p, 'roster'); await c.shot(); } },

  { no: '5-1-2', ...RO, title: '参加者名簿／誤ったパスワード',
    run: async (p, c, H) => {
      await H.orgTab(p, 'roster'); await p.fill('#lkPw', 'wrong'); await p.click('#lkGo');
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '5-1-3', ...RO, title: '参加者名簿／admin で解除',
    run: async (p, c, H) => { await H.unlockRoster(p); await c.shot(); } },

  { no: '5-1-4', ...RO, title: '参加者名簿／行の展開',
    run: async (p, c, H) => {
      await H.unlockRoster(p);
      await p.locator('#content tbody tr').first().click(); await settle(p); await c.shot();
    } },

  { no: '5-1-5', ...RO, title: '参加者名簿／かな・カナ検索',
    run: async (p, c, H) => {
      await H.unlockRoster(p);
      await p.fill('#rSearch', 'たなか'); await settle(p); await c.shot();
      await p.fill('#rSearch', 'タナカ'); await settle(p); await c.shot();
    } },

  { no: '5-1-6', ...RO, title: '参加者名簿／CSV出力',
    run: async (p, c, H) => {
      await H.unlockRoster(p);
      const { name } = await saveDownload(p, '5-1-6', () => p.click('#rCsv'));
      console.log(`\n      → CSVを保存: ${name}`);
      await settle(p); await c.shot({ wait: 350 });
    } },

  { no: '5-1-7', ...RO, title: '参加者名簿／ロックの復帰',
    run: async (p, c, H) => {
      await H.unlockRoster(p); await c.shot();
      await H.part(p); await H.org(p); await H.orgTab(p, 'roster'); await c.shot();
    } },

  { no: '5-2-1', title: '設定／初期化',
    run: async (p, c, H) => {
      await H.orgTab(p, 'settings');
      await p.click('#reset'); await p.waitForTimeout(400); await c.shot({ full: false });
      await p.click('#mOk'); await settle(p); await p.waitForTimeout(800);
      await H.orgTab(p, 'dashboard'); await c.shot();
      await H.orgTab(p, 'events'); await c.shot();
    } },

  { no: '5-2-2', title: '設定／デモデータの投入',
    run: async (p, c, H) => {
      await H.orgTab(p, 'settings');
      await p.click('#reset'); await p.click('#mOk'); await p.waitForTimeout(1200);
      await p.click('#seed');
      await p.waitForFunction(() => !document.querySelector('#seed[disabled]'), null, { timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(2500); await settle(p); await c.shot({ wait: 300 });
      await H.orgTab(p, 'dashboard'); await c.shot();
      await H.unlockRoster(p); await c.shot();
    } },

  // ===================== 6. 共通 =====================
  { no: '6-1-1', title: 'URLから開く／確認用URL',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public');
      const token = await p.evaluate(async () => await new Promise((res) => {
        const req = indexedDB.open('neo_event_tool');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('applications', 'readonly');
          const all = tx.objectStore('applications').getAll();
          all.onsuccess = () => res((all.result.find(a => a.status === 'applied') || all.result[0] || {}).token);
        };
      }));
      console.log(`\n      → 使ったトークン: ${String(token).slice(0, 8)}…`);
      await p.goto(`${BASE}?ticket=${token}`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
      console.log(`      → 復帰後のURL: ${p.url()}`);
    } },

  { no: '6-1-4', ...RO, title: 'URLから開く／イベントURL',
    run: async (p, c, H) => {
      for (const id of ['ev_public', 'ev_limited']) {
        await p.goto(`${BASE}?event=${id}`, { waitUntil: 'domcontentloaded' }); await settle(p);
        await c.shot();
      }
    } },

  { no: '6-1-7', ...RO, title: 'URLから開く／プレビュー',
    run: async (p, c, H) => {
      await p.goto(`${BASE}?preview=ev_draft`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();
    } },

  { no: '6-2-1', ...RO, title: 'ビューの切替／役割ボタン',
    run: async (p, c, H) => {
      await H.org(p); await c.shot({ sel: 'header' }); await c.shot({ sel: '#tabs' });
      await H.part(p); await c.shot({ sel: '#tabs' });
    } },

  { no: '6-2-2', ...RO, title: 'ビューの切替／スマホ表示',
    run: async (p, c, H) => {
      await H.part(p);
      await p.setViewportSize({ width: 390, height: 844 });
      await settle(p); await c.shot();
      await p.click('#tabs button[data-page="myticket"]'); await settle(p); await c.shot();
      const sizes = await p.$$eval('#content input', els => els.map(e => getComputedStyle(e).fontSize));
      console.log(`\n      → 参加者ビューの入力欄の文字サイズ: ${JSON.stringify(sizes)}`);
      await H.org(p); await c.shot();                                    // 主催者はPC幅のまま
      await p.setViewportSize({ width: 1280, height: 900 }); await settle(p);
    } },

  { no: '6-2-3', ...RO, title: 'ビューの切替／高速な連続切替',
    run: async (p, c, H) => {
      for (let i = 0; i < 6; i++) {
        await p.click('#tabs button[data-page="dashboard"]');
        await p.click('#tabs button[data-page="events"]');
        await p.click('#tabs button[data-page="notify"]');
      }
      await p.click('#tabs button[data-page="dashboard"]');
      await settle(p, 1200); await c.shot();
    } },

  { no: '6-3-1', ...RO, title: '表示と保存／書体',
    run: async (p, c, H) => {
      await H.orgTab(p, 'dashboard'); await c.shot({ sel: 'header' }); await c.shot();
      const f = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
      console.log(`\n      → body の font-family: ${f}`);
    } },

  { no: '6-3-2', title: '表示と保存／再読み込みで残る',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '運営A');
      await p.fill('#opBody', '再読み込みしても残ることの確認');
      await p.click('#opSend'); await settle(p); await c.shot();
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread'); await c.shot();
    } },

  { no: '6-3-6', title: '表示と保存／スクリプトの埋め込み',
    run: async (p, c, H) => {
      let popped = false;
      p.on('dialog', () => { popped = true; });
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '<script>alert(1)</script>');
      await p.fill('#opBody', '<script>alert(1)</script><img src=x onerror=alert(2)>');
      await p.click('#opSend'); await settle(p); await c.shot({ wait: 500 });
      console.log(`\n      → ダイアログが出た: ${popped}`);
    } },

  { no: '6-4-4', title: 'メッセージ表示／取り消せない操作の確認画面',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'edit');
      await p.click('#cancelBtn'); await p.waitForTimeout(400); await c.shot({ full: false });
      await p.click('#mCancel'); await settle(p);
      await H.orgTab(p, 'settings');
      await p.click('#reset'); await p.waitForTimeout(400); await c.shot({ full: false });
      await p.click('#mCancel'); await settle(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'files');
      const del = p.locator('[data-fdel]').first();
      if (await del.count()) { await del.click(); await p.waitForTimeout(400); await c.shot({ full: false }); await p.click('#mCancel'); }
    } },

  // ===================== 7. 通しシナリオ =====================
  { no: '7-1-1', title: '通し：作成→公開→申込→受付→出力→中止',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await p.click('#newEvent'); await settle(p);
      await p.fill('[data-f="title"]', '通し試験イベント');
      await p.fill('[data-f="startAt"]', '2026-09-10T13:00');
      await p.fill('[data-f="endAt"]', '2026-09-10T15:00');
      await p.click('#next'); await settle(p); await c.shot();               // 1) 作成
      await p.fill('[data-f="venueName"]', '本社 大会議室');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="description"]', '結合試験の通しシナリオ 7-1-1 で使うイベントです。');
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="capacity"]', '10');
      await p.fill('[data-f="applyDeadline"]', '2026-09-30');               // 締切>開催日
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="contactInfo"]', '通し試験事務局 t@example.com');
      await p.click('#check'); await settle(p); await c.shot({ wait: 400 }); // 2) 矛盾の指摘
      await p.click('#prev'); await settle(p);
      await p.fill('[data-f="applyDeadline"]', '2026-09-05');
      await p.click('#next'); await settle(p);
      await p.click('#publish'); await p.waitForTimeout(500);
      await c.shot({ full: false });
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 400 });   // 3) 公開
      const id = await p.evaluate(async () => await new Promise(res => {
        const r = indexedDB.open('neo_event_tool');
        r.onsuccess = () => { const t = r.result.transaction('events').objectStore('events').getAll();
          t.onsuccess = () => res((t.result.find(e => e.title === '通し試験イベント') || {}).id); };
      }));
      await H.part(p);
      await p.goto(`${BASE}?event=${id}`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '通し 太郎', kana: 'トオシ タロウ', email: 'toshi@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });                          // 4) 申込
      await H.org(p); await H.orgTab(p, 'events');
      await p.locator('.evcard', { hasText: '通し試験イベント' }).first().click(); await settle(p);
      await p.locator('button[data-checkin]').first().click(); await settle(p);
      await c.shot({ wait: 350 });                                           // 5) 受付
      await saveDownload(p, '7-1-1', () => p.click('#csvBtn'));              // 6) 出力
      await H.sub(p, 'edit'); await p.click('#cancelBtn'); await p.waitForTimeout(400);
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 400 });   // 7) 中止
    } },

  { no: '7-3-1', title: '通し：URLから開く全パターン',
    run: async (p, c, H) => {
      const token = await p.evaluate(async () => await new Promise(res => {
        const r = indexedDB.open('neo_event_tool');
        r.onsuccess = () => { const t = r.result.transaction('applications').objectStore('applications').getAll();
          t.onsuccess = () => res((t.result.find(a => a.status === 'applied') || {}).token); };
      }));
      for (const [label, url] of [
        ['正しい確認URL', `${BASE}?ticket=${token}`],
        ['でたらめな確認URL', `${BASE}?ticket=deadbeefdeadbeef`],
        ['公開イベント', `${BASE}?event=ev_public`],
        ['限定公開イベント', `${BASE}?event=ev_limited`],
        ['下書きのプレビュー', `${BASE}?preview=ev_draft`],
        ['中止イベント', `${BASE}?event=ev_cancel`],
      ]) {
        await p.goto(url, { waitUntil: 'domcontentloaded' }); await settle(p);
        await c.shot();
        console.log(`\n      → ${label}: ${p.url()}`);
      }
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p); await c.shot();
    } },

  { no: '7-4-1', title: '通し：イベント作成の入力チェック',
    run: async (p, c, H) => {
      await H.orgTab(p, 'events'); await p.click('#newEvent'); await settle(p);
      await p.click('#next'); await settle(p); await c.shot();               // 名前が空
      await p.fill('[data-f="title"]', '入力チェック通し');
      await p.fill('[data-f="startAt"]', '2026-09-20T13:00');
      await p.click('#next'); await settle(p);
      await p.click('#next'); await settle(p);
      await p.click('#next'); await settle(p);
      await p.fill('[data-f="applyDeadline"]', '2026-10-31');
      await p.click('#next'); await settle(p);
      await p.click('#check'); await settle(p); await c.shot({ wait: 400 }); // 締切>開催日
      await p.click('#publish'); await settle(p); await c.shot({ wait: 400 }); // 問い合わせ先が空
      await H.openEvent(p, 'ev_public');
      await p.click('#subtabs button[data-tab="edit"]'); await settle(p);
      await p.click('#editBtn'); await settle(p);
      for (let i = 0; i < 4; i++) { await p.click('#next'); await settle(p); }
      await c.shot();                                                        // 公開後の公開範囲
    } },

  { no: '7-5-1', title: '通し：キャンセルと申込み直し',
    run: async (p, c, H) => {
      await H.part(p);
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                        // 残席（申込前）
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '再申込 太郎', kana: 'サイモウシコミ タロウ', email: 'saimoushi@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });                          // 申込完了
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                        // 残席が1減る
      await H.org(p); await H.openEvent(p, 'ev_seminar');
      await p.fill('#searchBox', '再申込'); await settle(p);
      await p.locator('#content tbody tr').first().click(); await settle(p);
      await p.locator('[data-cancel]').first().click(); await p.waitForTimeout(400);
      await p.click('#mOk'); await settle(p); await c.shot({ wait: 400 });   // キャンセルの記録が残る
      await H.part(p);
      await p.goto(`${BASE}?event=ev_seminar`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await p.click('#apply'); await settle(p);
      await fillApply(p, { name: '再申込 太郎', kana: 'サイモウシコミ タロウ', email: 'saimoushi@example.com' });
      await p.locator('#content button', { hasText: /申込む|申し込む/ }).first().click();
      await settle(p); await c.shot({ wait: 400 });                          // 申込み直せる
      await H.org(p); await H.unlockRoster(p);
      await p.fill('#rSearch', '再申込'); await settle(p); await c.shot();   // 名簿では1行
    } },

  { no: '7-6-1', title: '通し：運営の連絡機能ひととおり',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '運営A'); await p.fill('#opBody', '通し確認：スレッド投稿');
      await p.click('#opSend'); await settle(p); await c.shot();
      await H.orgTab(p, 'events'); await c.shot();                           // 別イベントに未読が付かない
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread'); await settle(p);
      await H.orgTab(p, 'events'); await c.shot();                           // 開いたら消える
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'qa');
      await p.fill('#qaBody', '通し確認：Q&Aの登録'); await p.fill('#qaAuthor', '運営B');
      await p.click('#qaAdd'); await settle(p); await c.shot();
      await H.sub(p, 'notice');
      await p.fill('#ntTitle', '通し確認：参加者へのお知らせ');
      await p.fill('#ntBody', 'このお知らせは参加者にだけ見えます。');
      await p.fill('#ntAuthor', '事務局');
      await p.click('#ntAdd'); await settle(p); await c.shot();
      await H.part(p);
      await p.goto(`${BASE}?event=ev_public`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                        // 参加者にはお知らせだけ
    } },

  { no: '7-7-1', title: '通し：タスクの進み具合が各画面に伝わる',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks');
      await p.click('#tkAdd'); await p.waitForTimeout(400);
      await p.fill('#tkTitle', '通し確認：進捗の連動');
      await p.click('#tkSave'); await settle(p); await c.shot();
      await p.evaluate(() => {
        const src = document.querySelector('.tcard[draggable="true"]');
        const cols = [...document.querySelectorAll('[data-status]')];
        const dst = cols.find(x => !x.contains(src));
        if (!src || !dst) return;
        const dt = new DataTransfer();
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      });
      await settle(p); await c.shot();
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'tasks'); await c.shot();
      await p.click('[data-view="timeline"]'); await settle(p); await c.shot();
      await H.orgTab(p, 'events'); await c.shot({ sel: '.evcard[data-ev="ev_public"]' });
      await H.orgTab(p, 'dashboard'); await c.shot();
    } },

  { no: '7-8-1', title: '通し：マイ申込のログイン',
    run: async (p, c, H) => {
      await H.part(p); await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await c.shot();                                                        // 未ログイン
      await p.fill('#lgEmail', 'abc@example.com'); await p.fill('#lgPw', 'wrong');
      await p.click('#lgGo'); await settle(p); await c.shot({ wait: 350 });  // 誤入力
      await p.fill('#lgPw', 'abc123'); await p.click('#lgGo'); await settle(p);
      await c.shot();                                                        // 本人分のみ
      await H.org(p); await H.part(p);
      await p.click('#tabs button[data-page="myticket"]'); await settle(p);
      await c.shot();                                                        // 解除される
      const token = await p.evaluate(async () => await new Promise(res => {
        const r = indexedDB.open('neo_event_tool');
        r.onsuccess = () => { const t = r.result.transaction('applications').objectStore('applications').getAll();
          t.onsuccess = () => res((t.result.find(a => a.status === 'applied') || {}).token); };
      }));
      await p.goto(`${BASE}?ticket=${token}`, { waitUntil: 'domcontentloaded' }); await settle(p);
      await c.shot();                                                        // 確認URLはログイン不要
    } },

  { no: '7-9-1', title: '通し：参加者名簿とCSV',
    run: async (p, c, H) => {
      await H.orgTab(p, 'roster'); await c.shot();
      await p.fill('#lkPw', 'admin'); await p.click('#lkGo'); await settle(p); await c.shot();
      await p.locator('#content tbody tr').first().click(); await settle(p); await c.shot();
      await p.fill('#rSearch', 'たなか'); await settle(p); await c.shot();
      await p.fill('#rSearch', 'タナカ'); await settle(p); await c.shot();
      await p.fill('#rSearch', ''); await settle(p);
      const { name } = await saveDownload(p, '7-9-1', () => p.click('#rCsv'));
      console.log(`\n      → CSVを保存: ${name}`);
      await H.part(p); await H.org(p); await H.orgTab(p, 'roster'); await c.shot();  // ロックが掛かり直す
    } },

  { no: '7-10-1', ...RO, title: '通し：時期の表示が3箇所で一致する',
    run: async (p, c, H) => {
      await H.part(p); await c.shot();                                       // 「探す」の一覧
      for (const id of ['ev_public', 'ev_before', 'ev_past', 'ev_cancel', 'ev_limited', 'ev_soon']) {
        await p.goto(`${BASE}?event=${id}`, { waitUntil: 'domcontentloaded' }); await settle(p);
        await c.shot();
      }
      await H.org(p); await H.orgTab(p, 'events');
      await p.click('[data-k="past"]'); await settle(p); await c.shot();     // 主催者一覧のバッジ
    } },

  { no: '7-12-1', title: '通し：データが消えない・消せる',
    run: async (p, c, H) => {
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread');
      await p.fill('#opAuthor', '運営A'); await p.fill('#opBody', '保存の一生：この投稿が残るか');
      await p.click('#opSend'); await settle(p); await c.shot();
      await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
      await H.openEvent(p, 'ev_public'); await H.sub(p, 'thread'); await c.shot();   // 残る
      await H.orgTab(p, 'settings');
      await p.click('#reset'); await p.waitForTimeout(400); await c.shot({ full: false });
      await p.click('#mOk'); await p.waitForTimeout(1500);
      await H.orgTab(p, 'events'); await c.shot();                            // 空になる
      await H.orgTab(p, 'settings'); await p.click('#seed');
      await p.waitForFunction(() => !document.querySelector('#seed[disabled]'), null, { timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(2500);
      await H.orgTab(p, 'events'); await c.shot();                            // やり直せる
    } },
];
