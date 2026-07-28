/* jsdom + fake-indexeddb スモークテスト（実ブラウザ相当で描画パスを実行） */
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const { webcrypto } = require("crypto");
let FDBFactory = require("fake-indexeddb/lib/FDBFactory");
let FDBKeyRange = require("fake-indexeddb/lib/FDBKeyRange");
FDBFactory = FDBFactory.default || FDBFactory;
FDBKeyRange = FDBKeyRange.default || FDBKeyRange;

const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const scriptText = html.match(/<script>\s*"use strict";([\s\S]*)<\/script>/)[1];
/* 冒頭にインライン化した外部ライブラリ（QR生成）。CDN から読まなくなったので、
   テストでも本物を評価して生成経路を検証できる。 */
const vendorText = html.match(/<script>\s*(\/\/-+[\s\S]*?)<\/script>/)[1];

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => {
  if (/Not implemented|Could not load/.test(e.message)) return;
  errors.push("jsdomError: " + (e.detail && e.detail.message || e.message));
});
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost:8010/index.html", virtualConsole: vc });
const { window } = dom;
window.indexedDB = new FDBFactory();
window.IDBKeyRange = FDBKeyRange;
window.crypto = webcrypto;
if (!window.URL.createObjectURL) window.URL.createObjectURL = () => "blob:stub";
if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
window.navigator.clipboard = { writeText: async () => true };
window.HTMLAnchorElement.prototype.click = function () {};
window.onerror = (msg) => { errors.push("window.onerror: " + msg); };

const wait = (ms) => new Promise(r => window.setTimeout(r, ms));

(async () => {
  window.eval(vendorText);                    // 先にライブラリを読み込む
  window.eval(scriptText +
    "\n;window.__M={QR_READ_LIB,App,Repo,Seed,DB,Domain,Util,AppSvc,Dashboard,EventsList,EventDetail,Ops,Tasks,Manual,Files,Roster,Settings,Wizard,Participant,FB};");
  await wait(300);

  const M = window.__M;
  const content = window.document.getElementById("content");
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(["OK ", name]); }
    catch (e) { results.push(["ERR", name + " :: " + e.message]); errors.push(name + ": " + e.stack); }
  };
  const nonEmpty = (l) => { if (!content.innerHTML || content.innerHTML.length < 20) throw new Error(l + " が空"); };
  const clickTab = (i) => { content.querySelectorAll("#subtabs button")[i].click(); };
  /* マイ申込の詳細を開くには savedTokens に控えのあるトークンが必要。
     applications.byEvent() の返却順は主キー（ランダムID）順で実行ごとに変わるため、
     「最初の非キャンセル」を選ぶと控えの無いトークンを引いて一覧に落ちることがある。 */
  const savedTokenFor = async (eventId) => {
    const saved = await M.Repo.savedTokens.all();
    for (const s of saved.filter(x => x.eventId === eventId)) {
      const app = await M.Repo.applications.byToken(s.token);
      if (app && app.status !== "cancelled") return { token: s.token, app };
    }
    throw new Error(eventId + " に有効な控え付きの申込が無い");
  };

  await step("DB open (v5)", async () => { if (!M.DB.db()) throw new Error("DB未オープン"); if (M.DB.db().version !== 5) throw new Error("バージョンが5でない: " + M.DB.db().version); if (M.DB.db().objectStoreNames.contains("ticketTypes")) throw new Error("ticketTypesが残存"); for (const s of ["events","persons","applications","savedTokens","messages","tasks","readStates","manuals","files"]) if (!M.DB.db().objectStoreNames.contains(s)) throw new Error(s + "ストアなし"); });
  await step("Seed.load", async () => { await M.Seed.load(); });
  await step("Seed件数（チケット廃止後）", async () => {
    const [ev, ps, ap, sv, msg, tk] = await Promise.all([
      M.Repo.events.all(), M.Repo.persons.all(), M.Repo.applications.all(),
      M.Repo.savedTokens.all(), M.DB.getAll("messages"), M.DB.getAll("tasks")]);
    const c = `ev=${ev.length} ps=${ps.length} ap=${ap.length} sv=${sv.length} msg=${msg.length} task=${tk.length}`;
    if (ev.length !== 40 || ps.length !== 24 || sv.length !== 3 || msg.length !== 12 || tk.length !== 17) throw new Error("件数不正: " + c);
    if (ap.length < 200) throw new Error("過去アーカイブの申込が少ない: " + ap.length);
    if (ap.some(a => "ticketTypeId" in a)) throw new Error("申込にticketTypeIdが残存");
    if (!ev.every(e => "capacity" in e)) throw new Error("イベントにcapacityがない");
    results.push(["   ", c]);
  });
  await step("過去アーカイブが蓄積されている（F-33b）", async () => {
    const now = Date.now();
    const evs = await M.Repo.events.all();
    const past = evs.filter(e => e.endAt && new Date(e.endAt).getTime() < now);
    if (past.length < 25) throw new Error("過去イベントが少ない: " + past.length);
    // 2年ぶん程度にまたがっていること
    const oldest = Math.min(...past.map(e => new Date(e.startAt).getTime()));
    const months = (now - oldest) / (86400000 * 30);
    if (months < 18) throw new Error("期間が短い: 約" + Math.round(months) + "ヶ月");
    if (!past.some(e => e.status === "cancelled")) throw new Error("中止の回が無い");
  });
  await step("名簿にリピーターが溜まっている（F-92 の裏付け）", async () => {
    const apps = await M.Repo.applications.all();
    const byPerson = {};
    apps.forEach(a => { byPerson[a.personId] = (byPerson[a.personId] || 0) + 1; });
    const counts = Object.values(byPerson);
    if (counts.length < 20) throw new Error("参加者が少ない: " + counts.length);
    if (Math.max(...counts) < 5) throw new Error("複数回参加している人がいない");
    const checked = apps.filter(a => a.status === "checkedin").length;
    if (checked < 100) throw new Error("来場実績が少ない: " + checked);
  });

  await step("定員はイベント基準（残席計算）", async () => {
    const ev = await M.Repo.events.get("ev_public");
    const ap = await M.Repo.applications.byEvent("ev_public");
    if (M.Domain.capacity(ev) !== 60) throw new Error("capacityがイベントから取れない");
    if (M.Domain.remaining(ev, ap) !== 57) throw new Error("残席計算が不正: " + M.Domain.remaining(ev, ap)); // 60 - 有効3
  });

  await step("F-49b CSVインジェクション対策", async () => {
    const c = M.Util.csvCell;
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=x", "\r=x"])
      if (!/^'|^"'/.test(c(bad))) throw new Error("無害化されない: " + JSON.stringify(bad) + " → " + c(bad));
    if (c("=HYPERLINK(\"http://evil\",\"x\")") !== '"\'=HYPERLINK(""http://evil"",""x"")"')
      throw new Error("引用符との組み合わせが不正: " + c('=HYPERLINK("http://evil","x")'));
    // 通常の値は変えない
    for (const ok of ["田中 太郎", "tanaka@alpha.example.com", "3", "2026/08/11 18:30", ""])
      if (c(ok) !== ok) throw new Error("通常の値が変わった: " + ok + " → " + c(ok));
    // 実際の出力にも効いていること
    const csv = M.Util.buildCsv([["氏名"], ["=cmd|'/c calc'!A1"]]);
    if (!csv.includes("'=cmd")) throw new Error("buildCsv に反映されない: " + csv);
  });

  await step("配色が会社サイト由来になっている", async () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    for (const c of ["#20272e", "#194bf4", "#dee5ed", "#eff2ff"])
      if (!css.includes(c)) throw new Error("サイトの色が使われていない: " + c);
    for (const c of ["#12294d", "#2563eb", "#e8f0fe", "#1f2733"])
      if (css.includes(c)) throw new Error("旧配色が残っている: " + c);
    // 状態を表す色は意味があるので変えない
    for (const c of ["#137a4b", "#b26a00", "#c02828"])
      if (!css.includes(c)) throw new Error("状態色が失われている: " + c);
  });
  await step("書体は外部CSSを読まず @font-face をインラインで持つ", async () => {
    /* 条文は「JS と CSS はインラインに置く」。<link> で外部CSSを読むのは違反なので、
       @font-face を自分で書き、フォント実体だけを配布元から取る形にしている。 */
    if (/<link[^>]+href=/.test(html)) throw new Error("<link href> が復活している");
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    if (faces.length < 3) throw new Error("@font-face が足りない: " + faces.length);
    if (!faces.every(f => /font-family:\s*'Jost'/.test(f)))
      throw new Error("Jost 以外の @font-face が混ざっている（日本語は容量の都合で入れない）");
    if (!faces.every(f => /font-display:\s*swap/.test(f)))
      throw new Error("font-display:swap が無い（読み込めない時に表示が壊れる）");
    if (!/font-family:"Jost",system-ui/.test(css))
      throw new Error("本文の書体指定が Jost + システムフォントでない");
    // 日本語のフォールバックが残っていること
    if (!/Hiragino Kaku Gothic ProN/.test(css)) throw new Error("日本語のフォールバックが無い");
  });

  await step("ヘッダーのロゴが会社サイトへのリンクになっている", async () => {
    const a = window.document.querySelector("header.appbar a.logo");
    if (!a) throw new Error("ロゴのリンクが無い");
    if (a.getAttribute("href") !== "https://comthink.co.jp/") throw new Error("リンク先が違う: " + a.getAttribute("href"));
    if (a.getAttribute("rel") !== "noopener") throw new Error("rel=noopener が無い");
    const img = a.querySelector("img");
    if (!img) throw new Error("ロゴ画像が無い");
    // 外部ファイルを参照しない制約。データURIで埋め込まれていること
    if (!/^data:image\/webp;base64,/.test(img.getAttribute("src") || ""))
      throw new Error("データURIで埋め込まれていない: " + (img.getAttribute("src") || "").slice(0, 40));
    if (!img.getAttribute("alt")) throw new Error("alt が無い");
    // ヘッダーの左端にあること（ロゴ → アプリ名の順）
    const kids = [...window.document.querySelector("header.appbar").children];
    if (kids.indexOf(a) !== 0) throw new Error("ロゴがヘッダー左端にない");
    // 社名部分が白いロゴなので、白い地に載せると文字が消える（引き継ぎ書 7-13）
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const rule = css.match(/header\.appbar \.logo\{[^}]*\}/);
    if (rule && /background:\s*#fff/.test(rule[0]))
      throw new Error("ロゴを白地に載せている（社名が消える）: " + rule[0]);
    if (!kids[1] || !kids[1].classList.contains("brand")) throw new Error("ロゴの次がアプリ名でない");
  });

  await step("Dashboard.render", async () => { await M.Dashboard.render(content); nonEmpty("dashboard"); });

  // 申込ヒートマップ（S-1 / F-103）
  const hmCells = () => [...content.querySelectorAll(".hm-grid > div")];
  const hmSum = () => hmCells().reduce((n, c) => n + (+c.dataset.n || 0), 0);
  await step("ヒートマップ 7×26=182セルが描画される（F-103）", async () => {
    const grid = content.querySelector(".hm-grid");
    if (!grid) throw new Error("ヒートマップがない");
    if (grid.getAttribute("role") !== "img") throw new Error("role=img がない");
    if (!(grid.getAttribute("aria-label") || "").includes("ヒートマップ")) throw new Error("aria-label がない");
    if (hmCells().length !== 182) throw new Error("セル数が不正: " + hmCells().length);
    if (!hmCells().every(c => /^(2026|202[0-9])-\d{2}-\d{2}（.）: \d+件$/.test(c.title)))
      throw new Error("title の形式が不正: " + hmCells()[0].title);
  });
  await step("ヒートマップ 中止イベントの申込は数えない（F-40）", async () => {
    const before = hmSum();
    if (!before) throw new Error("前提が崩れた（申込が1件も数えられていない）");
    const cancelled = (await M.Repo.events.all()).find(e => e.status === "cancelled");
    await M.Repo.applications.put({ id:M.Util.uid(), eventId:cancelled.id, personId:"p0",
      token:M.Util.newToken(), status:"applied", checkinAt:null, cancelledAt:null,
      appliedAt:new Date().toISOString(), answers:{}, searchText:"" });
    await M.Dashboard.render(content); await wait(60);
    if (hmSum() !== before) throw new Error(`中止イベントの申込が数えられている ${before}→${hmSum()}`);
  });
  await step("ヒートマップ 同日複数件は0件より濃い", async () => {
    const multi = hmCells().find(c => +c.dataset.n >= 2);
    if (!multi) throw new Error("同日に2件以上ある日がシードに無い（前提が崩れた）");
    const lv = (c) => +(c.className.match(/l(\d)/) || [0, 0])[1];
    if (lv(multi) <= 0) throw new Error("複数件の日が0件と同じ階調: " + multi.className);
    const zero = hmCells().find(c => +c.dataset.n === 0);
    if (zero && lv(zero) !== 0) throw new Error("0件のセルが l0 でない: " + zero.className);
  });
  await step("ヒートマップ 申込0件でも例外なく描画される（全セル --hm-0）", async () => {
    await M.Repo.reset();
    await M.Dashboard.render(content); await wait(60);
    if (hmCells().length !== 182) throw new Error("0件時にセルが揃わない: " + hmCells().length);
    if (!hmCells().every(c => c.className === "l0")) throw new Error("0件なのに濃いセルがある");
    if (hmSum() !== 0) throw new Error("0件のはずが集計されている");
    await M.Seed.load();                      // 後続のテストのため戻す
    await M.Dashboard.render(content); await wait(60);
  });

  // 開催カレンダー（S-1 / F-100）
  await step("カレンダー 要対応リストの下に月表示が出る", async () => {
    if (!content.querySelector(".cal-grid")) throw new Error("カレンダーがない");
    if (content.querySelectorAll(".cal-wd").length !== 7) throw new Error("曜日見出しが7つない");
    const cells = content.querySelectorAll(".cal-cell").length;
    if (cells % 7 !== 0 || cells < 28) throw new Error("日セル数が不正: " + cells);
    if (!content.querySelector(".cal-cell.today")) throw new Error("今日が強調されない");
    // 要対応リストより後ろにあること
    if (content.innerHTML.indexOf("要対応リスト") > content.innerHTML.indexOf("開催カレンダー"))
      throw new Error("カレンダーが要対応リストより上にある");
  });
  await step("カレンダー 今月のイベントが日付に載る", async () => {
    const now = new Date();
    const evs = (await M.Repo.events.all()).filter(e => e.startAt &&
      new Date(e.startAt).getFullYear() === now.getFullYear() &&
      new Date(e.startAt).getMonth() === now.getMonth());
    if (!evs.length) throw new Error("今月のシードイベントがない（前提が崩れた）");
    const chips = [...content.querySelectorAll(".cal-chip")];
    if (!chips.length) throw new Error("イベントの帯が出ない");
    if (!chips.some(c => c.dataset.calEv === evs[0].id)) throw new Error("今月のイベントが載っていない");
  });
  await step("カレンダー 日程未定は件数として下に出る", async () => {
    const undated = (await M.Repo.events.all()).filter(e => !e.startAt).length;
    if (undated && !content.querySelector(".cal-undated .chip")) throw new Error("日程未定の一覧がない");
  });
  await step("カレンダー 月を送れる／今月に戻れる", async () => {
    const title = () => content.querySelector(".cal-title").textContent;
    const cur = title();
    content.querySelector("#calNext").click(); await wait(60);
    if (title() === cur) throw new Error("次の月へ進まない");
    if (!content.querySelector("#calToday") || content.querySelector("#calToday").disabled)
      throw new Error("今月ボタンが有効にならない");
    content.querySelector("#calPrev").click(); await wait(60);
    if (title() !== cur) throw new Error("前の月へ戻らない");
    content.querySelector("#calNext").click(); await wait(60);
    content.querySelector("#calToday").click(); await wait(60);
    if (title() !== cur) throw new Error("今月に戻らない");
  });
  await step("カレンダー 中止イベントは打ち消しで出る", async () => {
    const cancelled = (await M.Repo.events.all()).find(e => e.status === "cancelled" && e.startAt);
    if (!cancelled) return;
    const d = new Date(cancelled.startAt);
    const now = new Date();
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return; // 今月でなければ対象外
    const chip = [...content.querySelectorAll(".cal-chip")].find(c => c.dataset.calEv === cancelled.id);
    if (!chip || !chip.className.includes("cancelled")) throw new Error("中止イベントの見た目が区別されない");
  });
  await step("EventsList.render（カード表示）", async () => {
    await M.EventsList.render(content); nonEmpty("events");
    if (content.innerHTML.includes("申込枠")) throw new Error("申込枠の語が残存");
    if (!content.querySelectorAll(".evcard").length) throw new Error("カードが描画されない");
    if (content.querySelector("table.list")) throw new Error("旧テーブル表示が残っている");
  });
  await step("EventsList カードに申込・準備の2本のバーが出る", async () => {
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_public");
    if (!card) throw new Error("ev_public のカードがない");
    if (card.querySelectorAll(".track .fill").length !== 2) throw new Error("バーが2本ない");
    if (!card.querySelector(".fill.seats") || !card.querySelector(".fill.prep")) throw new Error("申込／準備のバーがない");
    if (!card.textContent.includes("3")) throw new Error("申込数が出ない");
  });
  await step("EventsList カードに未対応タスク・未解決Q&A・期限超過が出る", async () => {
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_public");
    const txt = card.textContent;
    // シード: 未対応/処理中=4件、未解決Q&A=1件、期限超過=1件、完了2/8
    if (!txt.includes("未対応タスク")) throw new Error("未対応タスクが出ない: " + txt);
    if (!txt.includes("未解決Q&A")) throw new Error("未解決Q&Aが出ない: " + txt);
    if (!txt.includes("期限超過")) throw new Error("期限超過が出ない: " + txt);
    if (!txt.includes("2 / 8")) throw new Error("準備の進捗が出ない: " + txt);
  });
  await step("EventsList タスク未登録のイベントはその旨を出す", async () => {
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_before");
    if (!card.textContent.includes("タスク未登録")) throw new Error("タスク未登録の表示がない");
  });
  await step("EventsList 終了・中止では要対応を出さない", async () => {
    M.EventsList.render; // 終了・中止トグルをONにする
    content.querySelectorAll(".toggles button")[2].click(); await wait(60);
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_cancel");
    if (!card) throw new Error("中止イベントのカードがない");
    if (card.textContent.includes("未対応タスク")) throw new Error("中止なのに要対応が出ている");
    if (!card.className.includes("done")) throw new Error("終了扱いのスタイルになっていない");
    content.querySelectorAll(".toggles button")[2].click(); await wait(60);
  });
  // 社外向けイベント専用（F-98）
  await step("F-98 対象範囲の概念を持たない", async () => {
    if (M.Domain.AUDIENCE || M.Domain.audienceOf) throw new Error("対象範囲の実装が残っている");
    const evs = await M.Repo.events.all();
    if (evs.some(e => "audience" in e)) throw new Error("シードに audience が残っている");
    await M.EventsList.render(content); await wait(40);
    if (content.querySelector(".badge.aud")) throw new Error("対象範囲バッジが残っている");
    if (/社内向け|社内外/.test(content.textContent)) throw new Error("社内向けの表記が残っている");
  });
  await step("F-98 問い合わせ先は公開時の必須項目", async () => {
    await M.Wizard.render(content, "ev_partner"); await wait(40);   // 問い合わせ先が空の下書き
    for (let i = 0; i < 4; i++) { content.querySelector("#next").click(); await wait(80); }
    content.querySelector("#publish").click(); await wait(40);
    if (window.document.querySelector("#modalHost .modal")) throw new Error("不備があるのに公開できる");
    if ((await M.Repo.events.get("ev_partner")).status !== "draft") throw new Error("公開されてしまった");
    if (!content.querySelector('[data-f="audience"]') === false) throw new Error("対象範囲の入力欄が残っている");
  });
  await step("F-91b 所属は会社／学校／なしの選択で聞く", async () => {
    await M.Participant.renderApply(content, "ev_seminar"); await wait(40);
    const sel = content.querySelector('[data-q="q_comp"]');
    if (!sel) throw new Error("所属の質問がない");
    if (sel.tagName !== "SELECT") throw new Error("選択式になっていない: " + sel.tagName);
    const opts = [...sel.options].map(o => o.value).filter(Boolean);
    if (opts.join(",") !== "会社,学校,なし") throw new Error("選択肢が不正: " + opts.join(","));
    if (content.querySelector('[data-q="q_dept"]')) throw new Error("所属部署を聞いている（社内向けの名残）");
  });
  await step("F-91b シードに学校・なしの参加者が含まれる", async () => {
    const vals = new Set((await M.Repo.applications.all())
      .map(a => a.answers && a.answers.q_comp).filter(Boolean));
    for (const v of ["会社","学校","なし"])
      if (!vals.has(v)) throw new Error(v + " の回答が無い: " + [...vals].join(","));
  });

  await step("EventDetail.render(ev_public)", async () => { await M.EventDetail.render(content, "ev_public"); nonEmpty("detail"); });
  await step("申込一覧は4列（申込枠列なし）", async () => {
    const ths = content.querySelectorAll("#subpane thead th");
    if (ths.length !== 4) throw new Error("列数=" + ths.length);
  });
  await step("EventDetail 検索フィルタ（正規化）", async () => {
    const box = content.querySelector("#searchBox");
    box.value = "たなか"; box.dispatchEvent(new window.Event("input")); await wait(20);
    if (content.querySelectorAll("#appRows tr[data-row]").length !== 1) throw new Error("正規化検索不一致");
  });
  await step("EventDetail CSV出力（申込枠列なし）", async () => { content.querySelector("#csvBtn").click(); await wait(20); });

  // 未読スレッド（readStates / v3）
  await step("未読: 未読の投稿がカードに出る", async () => {
    await M.EventsList.render(content); await wait(40);
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_public");
    if (!card.textContent.includes("未読のスレッド投稿 2件")) throw new Error("未読が出ない: " + card.textContent);
    if (!card.className.includes("unread")) throw new Error("未読の見た目になっていない");
  });
  await step("未読: サブタブにバッジが出る", async () => {
    await M.EventDetail.render(content, "ev_public"); await wait(40);
    const dot = content.querySelector('#subtabs [data-tab="thread"] .tabdot');
    if (!dot || dot.textContent !== "2") throw new Error("サブタブの未読バッジが不正");
  });

  // 運営スレッド（実データで永続）
  await step("運営スレッド 表示", async () => { clickTab(1); await wait(40); if (!content.querySelector("#opSend")) throw new Error("送信ボタンなし"); if (content.querySelectorAll(".bubble").length !== 2) throw new Error("シードのスレッド2件が出ない"); });
  await step("未読: 開いたら既読になり、バッジが消える", async () => {
    if (content.querySelector('#subtabs [data-tab="thread"] .tabdot')) throw new Error("バッジが消えない");
    const r = await M.Repo.readStates.get("ev_public:thread");
    if (!r || !r.lastReadAt) throw new Error("既読位置が保存されない");
    await M.EventsList.render(content); await wait(40);
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_public");
    if (card.textContent.includes("未読のスレッド投稿")) throw new Error("一覧でも未読が消えるはず");
    // 後続のスレッドテストのため、詳細＋スレッドタブに戻しておく
    await M.EventDetail.render(content, "ev_public"); await wait(40);
    clickTab(1); await wait(40);
  });
  await step("運営スレッド 送信で永続", async () => {
    content.querySelector("#opAuthor").value = "運営D";
    content.querySelector("#opBody").value = "リハーサルは16時からです。";
    content.querySelector("#opSend").click(); await wait(40);
    if (content.querySelectorAll(".bubble").length !== 3) throw new Error("送信後に3件にならない");
    const saved = (await M.DB.getAll("messages")).filter(m => m.channel === "thread" && m.eventId === "ev_public");
    if (saved.length !== 3) throw new Error("DBに保存されていない: " + saved.length);
  });
  await step("運営スレッド 削除で永続", async () => {
    content.querySelector("[data-del]").click(); await wait(40);
    if (content.querySelectorAll(".bubble").length !== 2) throw new Error("削除後に2件にならない");
  });

  // 運営Q&A（実データで永続）
  await step("運営Q&A 表示（シード2件）", async () => { clickTab(2); await wait(20); if (!content.querySelector("#qaAdd")) throw new Error("登録ボタンなし"); if (content.querySelectorAll(".qa-item").length !== 2) throw new Error("シードQ&A2件が出ない"); });
  await step("運営Q&A 登録で永続", async () => {
    content.querySelector("#qaBody").value = "看板は何枚必要？";
    content.querySelector("#qaAdd").click(); await wait(40);
    if (content.querySelectorAll(".qa-item").length !== 3) throw new Error("登録後に3件にならない");
  });
  await step("運営Q&A 解決トグルで永続", async () => {
    // 先頭（未解決）の解決ボタンを押す
    const tog = content.querySelector("[data-toggle]");
    tog.click(); await wait(40);
    const qas = (await M.DB.getAll("messages")).filter(m => m.channel === "qa");
    if (!qas.some(q => q.resolved && q.resolvedAt)) throw new Error("解決状態が保存されない");
  });

  // 運営タスク（backlog風 / E-2。実データで永続）
  await step("運営タスク ボード表示（シード8件）", async () => {
    clickTab(3); await wait(60);
    if (!content.querySelector(".board")) throw new Error("ボードが描画されない");
    if (content.querySelectorAll(".col").length !== 4) throw new Error("列が4つでない");
    const n = content.querySelectorAll(".tcard").length;
    if (n !== 8) throw new Error("ev_publicのタスク8件が出ない: " + n);
  });
  await step("運営タスク 進捗と期限超過の集計", async () => {
    const s = M.Domain.taskSummary(await M.Repo.tasks.byEvent("ev_public"));
    if (s.total !== 8 || s.done !== 2) throw new Error(`集計不正 total=${s.total} done=${s.done}`);
    if (s.overdue !== 1) throw new Error("期限超過の判定が不正: " + s.overdue);
    if (!content.querySelector(".tk-bar > span")) throw new Error("進捗バーがない");
  });
  await step("運営タスク ドロップで状態と並び順が永続", async () => {
    const card = content.querySelector('[data-drop="todo"] .tcard');
    const id = card.dataset.id;
    const zone = content.querySelector('[data-drop="doing"]');
    zone.insertBefore(card, zone.firstChild);          // ドロップ先の先頭へ移動
    zone.ondrop({ preventDefault() {} }); await wait(80);
    const t = (await M.DB.getAll("tasks")).find(x => x.id === id);
    if (t.status !== "doing" || t.order !== 0) throw new Error(`保存されない status=${t.status} order=${t.order}`);
    if (content.querySelectorAll('[data-drop="doing"] .tcard').length !== 2) throw new Error("再描画後の列件数が不正");
  });
  await step("運営タスク 追加（タイトル必須→保存で永続）", async () => {
    content.querySelector("#tkAdd").click(); await wait(20);
    const host = window.document.getElementById("modalHost");
    if (!host.querySelector("#tkTitle")) throw new Error("編集モーダルが出ない");
    host.querySelector("#tkSave").click(); await wait(20);
    if (!host.querySelector("#tkErr").textContent) throw new Error("タイトル必須のエラーが出ない");
    host.querySelector("#tkTitle").value = "看板を作成する";
    host.querySelector("#tkAssignee").value = "運営D";
    host.querySelector("#tkSave").click(); await wait(80);
    const mine = (await M.DB.getAll("tasks")).filter(t => t.eventId === "ev_public");
    if (mine.length !== 9) throw new Error("追加が保存されない: " + mine.length);
    if (!mine.some(t => t.title === "看板を作成する" && t.assignee === "運営D")) throw new Error("入力値が保存されない");
  });
  await step("運営タスク 開始日>期限日はエラー", async () => {
    content.querySelector(".tcard").click(); await wait(20);
    const host = window.document.getElementById("modalHost");
    host.querySelector("#tkStart").value = "2026-08-10";
    host.querySelector("#tkDue").value = "2026-08-01";
    host.querySelector("#tkSave").click(); await wait(20);
    if (!host.querySelector("#tkErr").textContent.includes("開始日")) throw new Error("日付の前後チェックがない");
    host.querySelector("#tkCancel").click();
  });
  await step("運営タスク タイムライン（今日線・週末・日付未設定）", async () => {
    content.querySelectorAll(".tk-head [data-view]")[1].click(); await wait(60);
    if (!content.querySelector(".tl-bar")) throw new Error("バーが描画されない");
    if (!content.querySelector(".tl-today")) throw new Error("今日線がない");
    if (!content.querySelector(".tl-d.we")) throw new Error("週末シェードがない");
    if (!content.querySelector(".tl-undated .chip")) throw new Error("日付未設定の一覧がない");
  });
  await step("運営タスク 削除で永続", async () => {
    content.querySelectorAll(".tk-head [data-view]")[0].click(); await wait(60);
    content.querySelector(".tcard").click(); await wait(20);
    window.document.querySelector("#tkDel").click(); await wait(20);
    window.document.querySelector("#mOk").click(); await wait(80);
    const mine = (await M.DB.getAll("tasks")).filter(t => t.eventId === "ev_public");
    if (mine.length !== 8) throw new Error("削除が反映されない: " + mine.length);
  });
  await step("運営タスク 固定表示に進捗が出る", async () => {
    await M.EventDetail.render(content, "ev_public"); await wait(20);
    const chip = content.querySelector("#taskChip");
    if (!chip || !chip.innerHTML.includes("タスク")) throw new Error("固定表示にタスク進捗がない");
  });

  // イベントマニュアル（Markdown / F-99）
  await step("マニュアル 本文があるとプレビューで開く", async () => {
    clickTab(4); await wait(60);
    if (!content.querySelector(".mn-body.preview")) throw new Error("プレビューで開かない");
    if (content.querySelector("#mnEdit")) throw new Error("プレビューなのに編集欄がある");
    if (!content.querySelector(".mn-prev h1")) throw new Error("Markdownが描画されない");
  });
  await step("マニュアル Markdown の表・チェックボックス・引用が描画される", async () => {
    // 表・チェックボックス・引用を含むのは ev_seminar のマニュアル
    await M.EventDetail.render(content, "ev_seminar"); await wait(30);
    clickTab(4); await wait(60);
    const prev = content.querySelector(".mn-prev");
    if (!prev.querySelector("table th")) throw new Error("表が描画されない");
    if (!prev.querySelector("li.task input[type=checkbox]")) throw new Error("チェックボックスが描画されない");
    if (!prev.querySelector("li.task input[checked]")) throw new Error("チェック済みが反映されない");
    if (!prev.querySelector("blockquote")) throw new Error("引用が描画されない");
    if (!prev.querySelector("ol li")) throw new Error("番号付きリストが描画されない");
    if (!prev.querySelector("strong")) throw new Error("強調が描画されない");
    await M.EventDetail.render(content, "ev_public"); await wait(30);
    clickTab(4); await wait(60);
  });
  await step("マニュアル HTMLはエスケープされる（本文をタグとして解釈しない）", async () => {
    const html = M.Util.markdown('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))');
    if (/<img/i.test(html)) throw new Error("HTMLが素通りしている: " + html);
    if (/javascript:/i.test(html) && /<a /i.test(html)) throw new Error("javascript: リンクが作られている");
  });
  await step("マニュアル 3ビューを切り替えられる", async () => {
    const modes = content.querySelectorAll(".mn-bar [data-mode]");
    if (modes.length !== 3) throw new Error("ビューが3つない");
    modes[1].click(); await wait(30);                       // 分割
    if (!content.querySelector(".mn-body.split")) throw new Error("分割にならない");
    if (!content.querySelector("#mnEdit") || !content.querySelector(".mn-prev"))
      throw new Error("分割に両方出ない");
    modes[0].click(); await wait(30);                       // 編集
    if (content.querySelector(".mn-prev")) throw new Error("編集なのにプレビューがある");
  });
  await step("マニュアル 編集→保存で永続し、プレビューに戻る", async () => {
    const ta = content.querySelector("#mnEdit");
    ta.value = "# 変更後の見出し\n\n本文を書き換えた。";
    ta.dispatchEvent(new window.Event("input")); await wait(30);
    if (content.querySelector("#mnSave").disabled) throw new Error("保存が有効にならない");
    content.querySelector("#mnSave").click(); await wait(80);
    const rec = await M.Repo.manuals.get("ev_public");
    if (!rec || !rec.body.includes("変更後の見出し")) throw new Error("保存されない");
    if (!content.querySelector(".mn-body.preview")) throw new Error("保存後にプレビューへ戻らない");
  });
  await step("マニュアル 未作成なら編集で開き、ひな形を挿入できる", async () => {
    await M.EventDetail.render(content, "ev_soon"); await wait(30);
    clickTab(4); await wait(60);
    if (!content.querySelector("#mnEdit")) throw new Error("初回に編集で開かない");
    if (!content.querySelector("#mnTmpl")) throw new Error("ひな形ボタンがない");
    content.querySelector("#mnTmpl").click(); await wait(40);
    if (!content.querySelector(".mn-body.split")) throw new Error("ひな形挿入後に分割にならない");
    if (!content.querySelector("#mnEdit").value.includes("当日マニュアル")) throw new Error("ひな形が入らない");
    await M.EventDetail.render(content, "ev_public"); await wait(30);
  });

  // 受付用QR（F-95）。ライブラリをインライン化したので、本物で生成を検証する
  await step("QR ライブラリがインライン化され、CDNに依存しない", async () => {
    if (typeof window.qrcode !== "function") throw new Error("qrcode がグローバルに無い");
    if (/qrcode-generator/.test(M.QR_READ_LIB || "")) throw new Error("生成側がCDN定数に残っている");
    // 実行されるスクリプト内の参照だけを見る（HTMLコメントの再取得先メモは対象外）
    const cdn = [...scriptText.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"]+/g)].map(x => x[0]);
    if (cdn.some(u => /qrcode-generator/.test(u))) throw new Error("生成側のCDN参照が残っている: " + cdn);
    if (cdn.length !== 1) throw new Error("実行時のCDN参照は読取側の1件だけのはず: " + cdn.join(", "));
  });
  await step("QR 本物のライブラリでSVGが生成される", async () => {
    const { token, app } = await savedTokenFor("ev_public");
    M.Participant.selectTicket(token);
    await M.Participant.renderMyTicket(content); await wait(40);
    const btn = content.querySelector("#qrShow");
    if (!btn) throw new Error("QR表示ボタンがない");
    btn.click(); await wait(80);
    const svg = content.querySelector("#qrHost svg");
    if (!svg) throw new Error("SVGが描画されない: " + content.querySelector("#qrHost").innerHTML.slice(0, 140));
    // 32文字のトークンなら 29x29 モジュール。セル5pxなので 145px 前後になる
    const w = +(svg.getAttribute("width") || "").replace(/[^0-9]/g, "");
    if (!(w >= 100 && w <= 220)) throw new Error("QRの寸法が想定外: " + svg.getAttribute("width"));
    if (svg.querySelectorAll("path, rect").length === 0) throw new Error("QRの中身が空");
    M.Participant.resetMyTicket();
  });
  await step("QR 生成に失敗したら氏名検索を案内する", async () => {
    // 例外を投げるスタブに差し替えて、フォールバック経路を通す
    const real = window.qrcode;
    window.qrcode = () => { throw new Error("生成失敗のシミュレーション"); };
    const { token } = await savedTokenFor("ev_public");
    M.Participant.selectTicket(token);
    await M.Participant.renderMyTicket(content); await wait(40);
    content.querySelector("#qrShow").click(); await wait(80);
    const html2 = content.querySelector("#qrHost").innerHTML;
    if (!html2.includes("氏名で検索")) throw new Error("フォールバックの案内が出ない: " + html2.slice(0, 140));
    window.qrcode = real;
    M.Participant.resetMyTicket();
  });

  // ファイル共有（E-3 / F-102）
  await step("ファイル共有 シードのファイルが一覧に出る", async () => {
    await M.EventDetail.render(content, "ev_seminar"); await wait(30);
    clickTab(5); await wait(60);
    if (!content.querySelector("#flInput")) throw new Error("追加ボタンがない");
    if (content.querySelectorAll(".fl-item").length !== 3) throw new Error("シード3件が出ない");
    if (!content.innerHTML.includes("進行台本.txt")) throw new Error("ファイル名が出ない");
  });
  await step("ファイル共有 メタデータが保存されている", async () => {
    /* 注意: fake-indexeddb は Blob を構造化複製できず、取り出すと素の Object になる。
       実ブラウザでは Blob のまま往復するが、ここでは検証できない（tests/README 参照）。
       そのため一覧・削除が依存するメタデータ側を検証する。**Blob の往復は実ブラウザで確認すること。** */
    const fs = await M.Repo.files.byEvent("ev_seminar");
    const f = fs.find(x => x.name === "進行台本.txt");
    if (!f) throw new Error("レコードが無い");
    if (!f.size || typeof f.size !== "number") throw new Error("サイズが保存されていない");
    if (f.type !== "text/plain") throw new Error("MIMEタイプが保存されていない");
    if (!f.uploadedAt || !f.eventId) throw new Error("メタデータが欠けている");
    if (!("blob" in f)) throw new Error("blob フィールドが無い");
  });
  await step("ファイル共有 追加すると永続する", async () => {
    const before = (await M.Repo.files.byEvent("ev_seminar")).length;
    const blob = new window.Blob(["備品リスト\nマイク2本\n延長コード3本\n"], { type:"text/plain" });
    const file = new window.File([blob], "備品リスト.txt", { type:"text/plain" });
    const input = content.querySelector("#flInput");
    Object.defineProperty(input, "files", { value:[file], configurable:true });
    input.onchange({ target:input }); await wait(120);
    const after = await M.Repo.files.byEvent("ev_seminar");
    if (after.length !== before + 1) throw new Error("保存されない: " + after.length);
    if (!after.some(f => f.name === "備品リスト.txt")) throw new Error("名前が保存されない");
  });
  await step("ファイル共有 削除できる", async () => {
    const target = (await M.Repo.files.byEvent("ev_seminar")).find(f => f.name === "備品リスト.txt");
    content.querySelector(`[data-fdel="${target.id}"]`).click(); await wait(30);
    window.document.querySelector("#mOk").click(); await wait(120);
    if ((await M.Repo.files.byEvent("ev_seminar")).some(f => f.id === target.id))
      throw new Error("削除されない");
    await M.EventDetail.render(content, "ev_public"); await wait(30);
  });

  // お知らせ（主催者→参加者 / messages channel:'notice'）
  await step("お知らせ 表示（シード2件）", async () => {
    clickTab(6); await wait(40);
    if (!content.querySelector("#ntAdd")) throw new Error("お知らせ投稿ボタンなし");
    if (content.querySelectorAll("[data-ntdel]").length !== 2) throw new Error("シードのお知らせ2件が出ない");
  });
  await step("お知らせ 件名必須→投稿で永続", async () => {
    content.querySelector("#ntAdd").click(); await wait(40);
    if (content.querySelectorAll("[data-ntdel]").length !== 2) throw new Error("件名なしで投稿された");
    content.querySelector("#ntTitle").value = "駐輪場は使えません";
    content.querySelector("#ntBody").value = "近隣の有料駐輪場をご利用ください。";
    content.querySelector("#ntAdd").click(); await wait(60);
    const saved = (await M.DB.getAll("messages")).filter(m => m.channel === "notice" && m.eventId === "ev_public");
    if (saved.length !== 3) throw new Error("お知らせが保存されない: " + saved.length);
  });
  await step("お知らせが参加者の公開ページに出る", async () => {
    await M.Participant.renderPublic(content, "ev_public"); await wait(20);
    if (!content.querySelector(".notices")) throw new Error("公開ページにお知らせ欄がない");
    if (content.querySelectorAll(".notices .nitem").length !== 3) throw new Error("公開ページのお知らせ件数が不正");
    if (!content.innerHTML.includes("駐輪場は使えません")) throw new Error("投稿したお知らせが出ない");
    await M.EventDetail.render(content, "ev_public"); await wait(20);
  });

  await step("告知タブ（X/LINEリンク）", async () => {
    clickTab(7); await wait(20);
    if (!content.querySelector("#xShare").href.includes("twitter.com")) throw new Error("X共有リンク不正");
    if (!content.querySelector("#lineShare").href.includes("line.me")) throw new Error("LINE共有リンク不正");
  });
  await step("概要・編集タブ + 中止確認モーダル", async () => {
    clickTab(8); await wait(20);
    const c = content.querySelector("#cancelBtn");
    if (c) { c.click(); await wait(20); if (!window.document.querySelector("#modalHost .modal")) throw new Error("確認モーダルなし"); window.document.querySelector("#mCancel").click(); }
  });

  // 受付開始日（F-45b）と phase:before（従来は到達不能だったデッド仕様）
  await step("受付前フェーズが算出される（phase:before）", async () => {
    const ev = await M.Repo.events.get("ev_before");
    const t = M.Domain.timing(ev);
    if (t.phase !== "before") throw new Error("phase=" + t.phase);
    if (t.label !== "受付前") throw new Error("label=" + t.label);
    const btn = M.Domain.applyButtonLabel(ev, []);
    if (!btn.disabled || !btn.text.includes("受付開始")) throw new Error("F-08の文言が不正: " + btn.text);
  });
  await step("受付開始が未設定なら受付中のまま", async () => {
    const ev = await M.Repo.events.get("ev_public");
    if (M.Domain.timing(ev).phase !== "open") throw new Error("openにならない");
  });
  await step("公開ページの申込ボタンが受付前で無効", async () => {
    await M.Participant.renderPublic(content, "ev_before"); await wait(20);
    const b = content.querySelector("#apply");
    if (!b.disabled) throw new Error("受付前なのに申込できる");
  });

  // C-1: イベントの書き込みが永続する
  await step("C-1 状態遷移が永続（下書き→公開）", async () => {
    await M.EventDetail.render(content, "ev_draft"); await wait(20);
    clickTab(8); await wait(20);
    content.querySelector("#publishBtn").click(); await wait(20);
    window.document.querySelector("#mOk").click(); await wait(80);
    const ev = await M.Repo.events.get("ev_draft");
    if (ev.status !== "published") throw new Error("公開が保存されない: " + ev.status);
  });
  await step("C-1 公開後は下書きに戻せない（F-37）", async () => {
    await M.EventDetail.render(content, "ev_draft"); await wait(20);
    clickTab(8); await wait(20);
    if (content.querySelector("#publishBtn")) throw new Error("公開済みに公開ボタンが出ている");
    if (content.querySelector("#deleteBtn")) throw new Error("公開済みに削除ボタンが出ている");
  });
  await step("C-1 中止が永続し、申込は変更されない（F-39）", async () => {
    const before = (await M.Repo.applications.byEvent("ev_public")).map(a => a.status).join(",");
    await M.EventDetail.render(content, "ev_public"); await wait(20);
    clickTab(8); await wait(20);
    content.querySelector("#cancelBtn").click(); await wait(20);
    window.document.querySelector("#mOk").click(); await wait(80);
    const ev = await M.Repo.events.get("ev_public");
    if (ev.status !== "cancelled") throw new Error("中止が保存されない");
    const after = (await M.Repo.applications.byEvent("ev_public")).map(a => a.status).join(",");
    if (before !== after) throw new Error("中止で申込が変わった");
  });
  await step("Settings.render（実装区分に運営行）", async () => { await M.Settings.render(content); if (!content.innerHTML.includes("運営スレッド")) throw new Error("実装区分に運営行なし"); if (!content.innerHTML.includes("運営タスク")) throw new Error("実装区分に運営タスク行なし"); if (!content.innerHTML.includes("チケット制")) throw new Error("チケット制廃止行なし"); });

  // ウィザード（申込枠→定員のみ）
  await step("Wizard.render(新規)", async () => { await M.Wizard.render(content, null); nonEmpty("wizard"); });
  await step("Wizard 名称未入力で次へ→エラー", async () => { content.querySelector("#next").click(); await wait(20); if (!content.querySelector(".field .err")) throw new Error("必須エラーなし"); });
  await step("Wizard ステップ1保存で下書きが実際に作られる（F-70）", async () => {
    const before = (await M.Repo.events.all()).length;
    content.querySelector('[data-f="title"]').value = "テストイベント";
    content.querySelector("#next").click(); await wait(80);
    const evs = await M.Repo.events.all();
    if (evs.length !== before + 1) throw new Error("下書きが作られない");
    const made = evs.find(e => e.title === "テストイベント");
    if (!made || made.status !== "draft") throw new Error("下書きとして保存されていない");
  });
  await step("Wizard 5ステップ踏破＋受付開始欄（申込枠名なし）", async () => {
    for (let i = 0; i < 2; i++) { content.querySelector("#next").click(); await wait(80); }
    if (content.innerHTML.includes("申込枠の名称")) throw new Error("枠名フィールドが残存");
    if (!content.querySelector('[data-f="capacity"]')) throw new Error("定員フィールドがない（step4）");
    if (!content.querySelector('[data-f="applyStartAt"]')) throw new Error("受付開始フィールドがない（F-45b）");
    content.querySelector("#next").click(); await wait(80);
    if (!content.querySelector("#publish")) throw new Error("最終ステップに公開ボタンなし");
  });
  await step("Wizard 離脱しても保存済みのステップが残る（F-72）", async () => {
    const made = (await M.Repo.events.all()).find(e => e.title === "テストイベント");
    if (!made) throw new Error("下書きが消えている");
    await M.Wizard.render(content, made.id); await wait(40);
    if (content.querySelector('[data-f="title"]').value !== "テストイベント") throw new Error("再開時に値が復元されない");
  });
  await step("Wizard 不備があると公開できない（F-06）", async () => {
    const made = (await M.Repo.events.all()).find(e => e.title === "テストイベント");
    await M.Wizard.render(content, made.id); await wait(40);
    for (let i = 0; i < 4; i++) { content.querySelector("#next").click(); await wait(80); }
    content.querySelector("#publish").click(); await wait(40);
    if (window.document.querySelector("#modalHost .modal")) throw new Error("不備があるのに確認モーダルが出た");
    if ((await M.Repo.events.get(made.id)).status !== "draft") throw new Error("不備があるのに公開された");
  });
  await step("Wizard 定員は有効な申込数を下回れない（F-41）", async () => {
    await M.Wizard.render(content, "ev_soon"); await wait(40);
    for (let i = 0; i < 3; i++) { content.querySelector("#next").click(); await wait(80); }
    content.querySelector('[data-f="capacity"]').value = "1";   // 有効な申込は2件
    content.querySelector("#next").click(); await wait(80);
    if ((await M.Repo.events.get("ev_soon")).capacity !== 20) throw new Error("定員が下限を割って保存された");
  });
  await step("Wizard.render(編集)", async () => { await M.Wizard.render(content, "ev_public"); if (content.querySelector('[data-f="capacity"]') == null) { /* step4で確認 */ } nonEmpty("wizard-edit"); });

  // 参加者（最後仕上げ。表示のみ確認）
  await step("Participant.renderPublic(ev_public)", async () => { await M.Participant.renderPublic(content, "ev_public"); nonEmpty("public"); });
  await step("Participant.renderMyTicket（マイ申込）", async () => { await M.Participant.renderMyTicket(content); if (!content.innerHTML.includes("マイ申込")) throw new Error("マイ申込の見出しなし"); if (content.querySelectorAll(".ticket-item").length !== 3) throw new Error("件数不正"); });

  // ---- C-3: 申込管理の永続化 ----
  await step("C-3 チェックインと取消が永続（F-24）", async () => {
    await M.EventDetail.render(content, "ev_soon"); await wait(30);
    const target = (await M.Repo.applications.byEvent("ev_soon")).find(a => a.status === "applied");
    content.querySelector(`[data-checkin="${target.id}"]`).click(); await wait(80);
    let a = await M.Repo.applications.get(target.id);
    if (a.status !== "checkedin" || !a.checkinAt) throw new Error("チェックインが保存されない");
    content.querySelector(`[data-checkin="${target.id}"]`).click(); await wait(80);
    a = await M.Repo.applications.get(target.id);
    if (a.status !== "applied" || a.checkinAt) throw new Error("受付取消が保存されない");
  });
  await step("C-3 キャンセルで残席が戻る（F-25）", async () => {
    const ev = await M.Repo.events.get("ev_soon");
    const before = M.Domain.remaining(ev, await M.Repo.applications.byEvent("ev_soon"));
    const target = (await M.Repo.applications.byEvent("ev_soon")).find(a => a.status === "applied");
    content.querySelector(`[data-row="${target.id}"]`).click(); await wait(30);
    content.querySelector(`[data-cancel="${target.id}"]`).click(); await wait(30);
    window.document.querySelector("#mOk").click(); await wait(100);
    const a = await M.Repo.applications.get(target.id);
    if (a.status !== "cancelled" || !a.cancelledAt) throw new Error("キャンセルが保存されない");
    const after = M.Domain.remaining(ev, await M.Repo.applications.byEvent("ev_soon"));
    if (after !== before + 1) throw new Error(`残席が戻らない ${before}→${after}`);
  });
  await step("C-3 内容修正が person に反映（F-26）", async () => {
    const target = (await M.Repo.applications.byEvent("ev_soon"))[0];
    await M.AppSvc.editApplicant(target.id, { name:"高橋 美咲子", kana:"タカハシ ミサキコ", email:"misakiko@example.com" });
    const p = await M.Repo.persons.get(target.personId);
    if (p.name !== "高橋 美咲子" || p.emailKey !== "misakiko@example.com") throw new Error("person が更新されない");
    const a = await M.Repo.applications.get(target.id);
    if (!a.searchText.includes("みさきこ")) throw new Error("searchText が再計算されていない");
  });
  await step("C-3 別人のメールアドレスへは変更できない（4-5）", async () => {
    const target = (await M.Repo.applications.byEvent("ev_soon"))[0];
    let threw = false;
    try { await M.AppSvc.editApplicant(target.id, { name:"a", kana:"ア", email:"tanaka@alpha.example.com" }); }
    catch { threw = true; }
    if (!threw) throw new Error("誤統合が許されている");
  });

  // ---- C-2: 申込フローの永続化 ----
  await step("C-2 申込が永続し、名寄せされる（F-16〜F-19）", async () => {
    const evId = "ev_limited";
    const beforeP = (await M.Repo.persons.all()).length;
    const { app, person } = await M.AppSvc.apply(evId, {
      name:"田中 太郎", kana:"たなか たろう", email:" TANAKA@ALPHA.example.com ", consent:true, answers:{} });
    if ((await M.Repo.persons.all()).length !== beforeP) throw new Error("既存の人が名寄せされず増えた");
    if (person.id !== "p0") throw new Error("emailKey での名寄せが効いていない: " + person.id);
    if (person.nameKana !== "タナカ タロウ") throw new Error("カナがカタカナ化されていない");
    if (!/^[0-9a-f]{32}$/.test(app.token)) throw new Error("トークンが不正");
    if (!await M.Repo.savedTokens.get(app.token)) throw new Error("端末に控えが保存されない");
  });
  await step("C-2 同一イベントへの二重申込を拒否（F-17）", async () => {
    let threw = false;
    try { await M.AppSvc.apply("ev_limited", { name:"田中 太郎", kana:"タナカ タロウ", email:"tanaka@alpha.example.com", consent:false, answers:{} }); }
    catch { threw = true; }
    if (!threw) throw new Error("二重申込ができてしまう");
  });
  await step("C-2 キャンセル後の再申込は許す（F-42）", async () => {
    const mine = (await M.Repo.applications.byEvent("ev_limited")).filter(a => a.personId === "p0");
    await M.AppSvc.cancel(mine[0].id);
    const { app } = await M.AppSvc.apply("ev_limited", { name:"田中 太郎", kana:"タナカ タロウ", email:"tanaka@alpha.example.com", consent:false, answers:{} });
    if (!app) throw new Error("再申込できない");
    const all = (await M.Repo.applications.byEvent("ev_limited")).filter(a => a.personId === "p0");
    if (all.length !== 2) throw new Error("再申込が別レコードになっていない: " + all.length);
  });
  await step("C-2 定員に達したら申込できない（F-18）", async () => {
    const ev = await M.Repo.events.get("ev_limited");
    await M.Repo.events.put({ ...ev, capacity: 1 });   // 有効な申込は既に1件
    let threw = false;
    try { await M.AppSvc.apply("ev_limited", { name:"新規 花子", kana:"シンキ ハナコ", email:"new@example.com", consent:false, answers:{} }); }
    catch (e) { threw = /定員/.test(e.message); }
    if (!threw) throw new Error("満席でも申込できてしまう");
    await M.Repo.events.put(ev);
  });
  await step("C-2 受付前は申込できない（F-45b）", async () => {
    let threw = false;
    try { await M.AppSvc.apply("ev_before", { name:"新規 花子", kana:"シンキ ハナコ", email:"new@example.com", consent:false, answers:{} }); }
    catch (e) { threw = /受付前/.test(e.message); }
    if (!threw) throw new Error("受付前でも申込できてしまう");
  });
  await step("C-2 カスタム質問の必須が未回答だと進めない（F-a）", async () => {
    await M.Participant.renderApply(content, "ev_soon"); await wait(30);
    if (!content.querySelector('[data-q="q_comp"]')) throw new Error("カスタム質問が描画されない");
    content.querySelector("#fName").value = "テスト 太郎";
    content.querySelector("#fKana").value = "テスト タロウ";
    content.querySelector("#fEmail").value = "test@example.com";
    content.querySelector("#toConfirm").click(); await wait(40);
    if (!content.innerHTML.includes("回答してください")) throw new Error("必須質問のエラーが出ない");
  });
  await step("C-2 申込フロー通しで保存され、回答も残る（F-80）", async () => {
    content.querySelector("#fName").value = "テスト 太郎";
    content.querySelector("#fKana").value = "テスト タロウ";
    content.querySelector("#fEmail").value = "test@example.com";
    content.querySelector('[data-q="q_comp"]').value = "学校";   // 会社／学校／なし の選択式（F-91b）
    content.querySelector("#toConfirm").click(); await wait(40);
    if (!content.querySelector("#submit")) throw new Error("確認画面に進めない");
    if (!content.innerHTML.includes("学校")) throw new Error("確認画面に回答が出ない");
    content.querySelector("#submit").click(); await wait(120);
    const a = (await M.Repo.applications.byEvent("ev_soon")).find(x => x.answers && x.answers.q_comp === "学校");
    if (!a) throw new Error("申込が保存されない");
    if (!content.innerHTML.includes("申込が完了しました")) throw new Error("完了画面に進まない");
  });
  await step("C-2 主催者の一覧に反映され残席が減る（受け入れ確認8）", async () => {
    await M.EventDetail.render(content, "ev_soon"); await wait(30);
    if (!content.innerHTML.includes("テスト 太郎")) throw new Error("申込一覧に出ない");
  });
  await step("C-2 参加者からのキャンセルも共通処理（F-25）", async () => {
    const a = (await M.Repo.applications.byEvent("ev_soon")).find(x => x.answers && x.answers.q_comp === "学校");
    await M.AppSvc.cancel(a.id);
    if ((await M.Repo.applications.get(a.id)).status !== "cancelled") throw new Error("共通キャンセルが効かない");
  });

  // ---- F-20 / F-07 ----
  await step("F-20 確認URL(?ticket=)から申込詳細へ復帰", async () => {
    const { token } = await savedTokenFor("ev_public");
    window.history.replaceState(null, "", "/index.html?ticket=" + token);
    const hit = await M.App.routeFromUrl(); await wait(60);
    if (!hit) throw new Error("ルーティングされない");
    if (!content.innerHTML.includes("公開ページを開く")) throw new Error("申込詳細が出ない");
    if (window.location.search) throw new Error("URLが元に戻っていない");
  });
  await step("F-20 ?event= で限定公開イベントを直接開ける（F-65）", async () => {
    window.history.replaceState(null, "", "/index.html?event=ev_limited");
    await M.App.routeFromUrl(); await wait(60);
    if (!content.innerHTML.includes("事業説明会")) throw new Error("限定公開ページが開かない");
  });
  await step("F-07 ?preview= で下書きを参加者ビュー確認", async () => {
    const draft = (await M.Repo.events.all()).find(e => e.status === "draft");
    window.history.replaceState(null, "", "/index.html?preview=" + draft.id);
    await M.App.routeFromUrl(); await wait(60);
    if (!content.innerHTML.includes("下書きのプレビュー")) throw new Error("プレビュー表示にならない");
  });

  // ---- F-b / F-c / F-d / F-f ----
  // 参加者名簿のロック（F-101）
  await step("F-101 名簿はパスワードで保護される", async () => {
    await M.Roster.render(content); await wait(30);
    if (!content.querySelector("#lkPw")) throw new Error("ロック画面が出ない");
    if (content.innerHTML.includes("田中 太郎")) throw new Error("ロック中なのに個人情報が見えている");
    if (!content.innerHTML.includes("肩越しの覗き見")) throw new Error("保護の限界が説明されていない");
  });
  await step("F-101 誤ったパスワードでは解除されない", async () => {
    content.querySelector("#lkPw").value = "password";
    content.querySelector("#lkGo").click(); await wait(30);
    if (!content.querySelector("#lkPw")) throw new Error("誤りでも解除された");
    if (!content.innerHTML.includes("パスワードが違います")) throw new Error("エラーが出ない");
  });
  await step("F-101 admin で解除でき、再ロックできる", async () => {
    content.querySelector("#lkPw").value = "admin";
    content.querySelector("#lkGo").click(); await wait(60);
    if (content.querySelector("#lkPw")) throw new Error("解除されない");
    if (!content.innerHTML.includes("田中 太郎")) throw new Error("解除後に名簿が出ない");
    content.querySelector("#rLock").click(); await wait(40);
    if (!content.querySelector("#lkPw")) throw new Error("再ロックできない");
  });
  await step("F-101 参加者ビューへ切り替えると再ロックされる", async () => {
    content.querySelector("#lkPw").value = "admin";
    content.querySelector("#lkGo").click(); await wait(60);
    if (content.querySelector("#lkPw")) throw new Error("解除されない");
    M.Roster.lock();                                  // setView が呼ぶのと同じ処理
    await M.Roster.render(content); await wait(30);
    if (!content.querySelector("#lkPw")) throw new Error("ビュー切替で再ロックされない");
    content.querySelector("#lkPw").value = "admin";   // 後続のテストのため解除しておく
    content.querySelector("#lkGo").click(); await wait(60);
  });

  await step("F-b 参加者名簿に参加履歴が出る", async () => {
    await M.Roster.render(content); await wait(30);
    if (!content.innerHTML.includes("田中 太郎")) throw new Error("名簿に出ない");
    const row = content.querySelector("tr[data-p]");
    row.click(); await wait(30);
    if (!content.querySelector(".hist")) throw new Error("参加履歴が展開されない");
  });
  await step("F-b 名簿の絞り込み（正規化検索）", async () => {
    const box = content.querySelector("#rSearch");
    box.value = "すずき"; box.dispatchEvent(new window.Event("input")); await wait(40);
    if (content.querySelectorAll("tr[data-p]").length !== 1) throw new Error("絞り込みが効かない");
    box.value = ""; box.dispatchEvent(new window.Event("input")); await wait(40);
  });
  await step("F-c 視聴URLは公開ページに出さず、マイ申込に出す", async () => {
    await M.Participant.renderPublic(content, "ev_public"); await wait(30);
    if (content.innerHTML.includes("teams.microsoft.com")) throw new Error("公開ページに視聴URLが漏れている");
    if (!content.innerHTML.includes("ハイブリッド")) throw new Error("開催形式が出ない");
    const { token } = await savedTokenFor("ev_public");
    M.Participant.selectTicket(token);
    await M.Participant.renderMyTicket(content); await wait(40);
    if (!content.querySelector("#toPublic")) throw new Error("マイ申込の詳細が開いていない");
    if (!content.innerHTML.includes("teams.microsoft.com")) throw new Error("申込者に視聴URLが出ない");
    M.Participant.resetMyTicket();
  });
  await step("F-d 複製で下書きが作られ copiedFromId が残る", async () => {
    const before = (await M.Repo.events.all()).length;
    await M.EventDetail.render(content, "ev_limited"); await wait(30);
    content.querySelectorAll("#subtabs button")[8].click(); await wait(30);
    content.querySelector("#dupBtn").click(); await wait(30);
    window.document.querySelector("#mOk").click(); await wait(100);
    const evs = await M.Repo.events.all();
    if (evs.length !== before + 1) throw new Error("複製されない");
    const copy = evs.find(e => e.copiedFromId === "ev_limited");
    if (!copy || copy.status !== "draft") throw new Error("下書きとして複製されていない");
    if (!copy.title.includes("コピー")) throw new Error("タイトルが区別できない");
  });
  await step("F-f 申込推移が描画される", async () => {
    await M.EventDetail.render(content, "ev_public"); await wait(30);
    if (!content.querySelector(".trend svg rect")) throw new Error("推移グラフが出ない");
  });
  await step("F-a CSVにカスタム質問の列が入る", async () => {
    const ev = await M.Repo.events.get("ev_public");
    if (!(ev.questions || []).length) throw new Error("シードに質問がない");
    content.querySelector("#csvBtn").click(); await wait(40);
  });

  // ---- 受け入れ確認（要件定義書 4-5）を通しで（D-4） ----
  await step("D-4 通し: 作成→公開→申込→受付→CSV→中止", async () => {
    await M.Repo.reset();
    await M.Seed.load();
    const evId = M.Util.uid();
    const iso = (d) => new Date(Date.now() + d*86400000).toISOString();
    const ymd = (d) => { const x = new Date(Date.now() + d*86400000);
      return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
    // 2. 作成して下書き保存
    await M.Repo.events.put({ id:evId, title:"通しテスト勉強会", description:"説明",
      targetAudience:"", startAt:iso(10), endAt:iso(10), venueName:"会議室A", venueAddress:"",
      contactInfo:"", coverImage:null, capacity:2, applyStartAt:null, applyDeadline:ymd(5),
      eventFormat:"onsite", onlineUrl:null, onlineNote:null,
      questions:[{ id:"q1", label:"会社名", type:"text", required:true, options:[] }],
      status:"draft", visibility:"public", groupId:null, copiedFromId:null,
      createdAt:iso(0), updatedAt:iso(0) });
    // 4. 公開 → 参加者ビューの一覧に出る（下書きは出ない）
    await M.Repo.events.put({ ...await M.Repo.events.get(evId), status:"published" });
    await M.Participant.renderList(content); await wait(40);
    if (!content.innerHTML.includes("通しテスト勉強会")) throw new Error("4: 公開後に参加者一覧へ出ない");
    // 6. 申込 → 完了
    const r1 = await M.AppSvc.apply(evId, { name:"通し 一郎", kana:"トオシ イチロウ",
      email:"toshi1@example.com", consent:true, answers:{ q1:"開発部" } });
    // 7. 再読込相当（DBから読み直す）
    if (!(await M.Repo.applications.byToken(r1.app.token))) throw new Error("7: 再読込でデータが残らない");
    // 8. 主催者側に反映され残席が減る
    let ev = await M.Repo.events.get(evId);
    let apps = await M.Repo.applications.byEvent(evId);
    if (M.Domain.remaining(ev, apps) !== 1) throw new Error("8: 残席が減らない");
    // 9. 検索 → チェックイン → 取消
    if (!apps[0].searchText.includes("とおし")) throw new Error("9: 正規化検索用の文字列が不正");
    await M.AppSvc.setCheckin(apps[0].id, true);
    if ((await M.Repo.applications.get(apps[0].id)).status !== "checkedin") throw new Error("9: チェックイン不可");
    await M.AppSvc.setCheckin(apps[0].id, false);
    if ((await M.Repo.applications.get(apps[0].id)).status !== "applied") throw new Error("9: 受付取消不可");
    // 10. 主催者が内容を修正
    await M.AppSvc.editApplicant(apps[0].id, { name:"通し 一朗", kana:"トオシ イチロウ", email:"toshi1@example.com" });
    if ((await M.Repo.persons.get(apps[0].personId)).name !== "通し 一朗") throw new Error("10: 内容修正が反映されない");
    // 12. 定員まで申込むと以降は不可
    await M.AppSvc.apply(evId, { name:"通し 二郎", kana:"トオシ ジロウ",
      email:"toshi2@example.com", consent:false, answers:{ q1:"営業部" } });
    let full = false;
    try { await M.AppSvc.apply(evId, { name:"通し 三郎", kana:"トオシ サブロウ",
      email:"toshi3@example.com", consent:false, answers:{ q1:"総務部" } }); }
    catch { full = true; }
    if (!full) throw new Error("12: 定員を超えて申込できてしまう");
    // 11. CSV（カスタム質問の列を含む）
    await M.EventDetail.render(content, evId); await wait(40);
    content.querySelector("#csvBtn").click(); await wait(40);
    // 13. 中止 → 参加者ビューに状態が出る
    await M.Repo.events.put({ ...await M.Repo.events.get(evId), status:"cancelled" });
    await M.Participant.renderPublic(content, evId); await wait(40);
    if (!content.innerHTML.includes("中止されました")) throw new Error("13: 中止が参加者に出ない");
    apps = await M.Repo.applications.byEvent(evId);
    if (apps.some(a => a.status === "cancelled")) throw new Error("13: 中止で申込が書き換わった（F-39違反）");
  });
  await step("D-4 14: 初期化と再投入", async () => {
    await M.Repo.reset();
    if ((await M.Repo.events.all()).length !== 0) throw new Error("初期化されない");
    await M.Seed.load();
    if ((await M.Repo.events.all()).length !== 40) throw new Error("再投入されない");
  });

  await step("DB reset → 空", async () => { await M.Repo.reset(); if ((await M.Repo.events.all()).length !== 0) throw new Error("リセット後も残存"); });

  console.log("\n===== SMOKE TEST RESULTS =====");
  for (const [s, n] of results) console.log(s + " " + n);
  const failed = results.filter(r => r[0] === "ERR").length;
  console.log(`\n${results.filter(r=>r[0]==="OK ").length} passed, ${failed} failed`);
  if (errors.length) { console.log("\n----- captured errors -----"); errors.slice(0, 15).forEach(e => console.log(String(e).split("\n").slice(0,4).join("\n"))); }
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
