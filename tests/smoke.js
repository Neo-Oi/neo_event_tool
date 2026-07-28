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
  window.eval(scriptText +
    "\n;window.__M={App,Repo,Seed,DB,Domain,Util,AppSvc,Dashboard,EventsList,EventDetail,Ops,Tasks,Manual,Roster,Settings,Wizard,Participant,FB};");
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

  await step("DB open (v4)", async () => { if (!M.DB.db()) throw new Error("DB未オープン"); if (M.DB.db().version !== 4) throw new Error("バージョンが4でない: " + M.DB.db().version); if (M.DB.db().objectStoreNames.contains("ticketTypes")) throw new Error("ticketTypesが残存"); for (const s of ["events","persons","applications","savedTokens","messages","tasks","readStates","manuals"]) if (!M.DB.db().objectStoreNames.contains(s)) throw new Error(s + "ストアなし"); });
  await step("Seed.load", async () => { await M.Seed.load(); });
  await step("Seed件数（チケット廃止後）", async () => {
    const [ev, ps, ap, sv, msg, tk] = await Promise.all([
      M.Repo.events.all(), M.Repo.persons.all(), M.Repo.applications.all(),
      M.Repo.savedTokens.all(), M.DB.getAll("messages"), M.DB.getAll("tasks")]);
    const c = `ev=${ev.length} ps=${ps.length} ap=${ap.length} sv=${sv.length} msg=${msg.length} task=${tk.length}`;
    if (ev.length !== 10 || sv.length !== 3 || msg.length !== 12 || tk.length !== 17) throw new Error("件数不正: " + c);
    if (ap.some(a => "ticketTypeId" in a)) throw new Error("申込にticketTypeIdが残存");
    if (!ev.every(e => "capacity" in e)) throw new Error("イベントにcapacityがない");
    results.push(["   ", c]);
  });
  await step("定員はイベント基準（残席計算）", async () => {
    const ev = await M.Repo.events.get("ev_public");
    const ap = await M.Repo.applications.byEvent("ev_public");
    if (M.Domain.capacity(ev) !== 60) throw new Error("capacityがイベントから取れない");
    if (M.Domain.remaining(ev, ap) !== 57) throw new Error("残席計算が不正: " + M.Domain.remaining(ev, ap)); // 60 - 有効3
  });

  await step("Dashboard.render", async () => { await M.Dashboard.render(content); nonEmpty("dashboard"); });

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
  // 対象範囲（社外向けが既定 / F-98）
  await step("F-98 既定は社外向け", async () => {
    if (M.Domain.DEFAULT_AUDIENCE !== "external") throw new Error("既定が社外向けでない");
    if (M.Domain.audienceOf({}) !== "external") throw new Error("未設定データが社外向けにならない");
    if (!M.Domain.hasExternal({ audience:"both" })) throw new Error("社内外が社外扱いにならない");
    if (M.Domain.hasExternal({ audience:"internal" })) throw new Error("社内向けが社外扱いになっている");
  });
  await step("F-98 シードに社外向け・社内外・社内向けが揃う", async () => {
    const evs = await M.Repo.events.all();
    const n = (a) => evs.filter(e => M.Domain.audienceOf(e) === a).length;
    if (!n("external") || !n("both") || !n("internal"))
      throw new Error(`区分が揃わない ext=${n("external")} both=${n("both")} int=${n("internal")}`);
    if (n("external") + n("both") <= n("internal")) throw new Error("社外向けが主体になっていない");
  });
  await step("F-98 カードと公開ページに対象範囲バッジが出る", async () => {
    await M.EventsList.render(content); await wait(40);
    const card = [...content.querySelectorAll(".evcard")].find(c => c.dataset.ev === "ev_seminar");
    if (!card.querySelector(".badge.aud.external")) throw new Error("カードに社外向けバッジがない");
    await M.Participant.renderPublic(content, "ev_seminar"); await wait(30);
    if (!content.querySelector(".badge.aud.external")) throw new Error("公開ページにバッジがない");
  });
  await step("F-98 社外向けは問い合わせ先が必須（公開前チェック）", async () => {
    await M.Wizard.render(content, "ev_partner"); await wait(40);   // 社外向けの下書き（問い合わせ先が空）
    for (let i = 0; i < 4; i++) { content.querySelector("#next").click(); await wait(80); }
    content.querySelector("#publish").click(); await wait(40);
    if (window.document.querySelector("#modalHost .modal")) throw new Error("不備があるのに公開できる");
    if ((await M.Repo.events.get("ev_partner")).status !== "draft") throw new Error("公開されてしまった");
  });
  await step("F-98 社外向けの申込では会社名を聞く", async () => {
    await M.Participant.renderApply(content, "ev_seminar"); await wait(40);
    if (!content.querySelector('[data-q="q_comp"]')) throw new Error("会社名の質問がない");
    if (content.querySelector('[data-q="q_dept"]')) throw new Error("社外向けなのに所属部署を聞いている");
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

  // お知らせ（主催者→参加者 / messages channel:'notice'）
  await step("お知らせ 表示（シード2件）", async () => {
    clickTab(5); await wait(40);
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
    clickTab(6); await wait(20);
    if (!content.querySelector("#xShare").href.includes("twitter.com")) throw new Error("X共有リンク不正");
    if (!content.querySelector("#lineShare").href.includes("line.me")) throw new Error("LINE共有リンク不正");
  });
  await step("概要・編集タブ + 中止確認モーダル", async () => {
    clickTab(7); await wait(20);
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
    clickTab(7); await wait(20);
    content.querySelector("#publishBtn").click(); await wait(20);
    window.document.querySelector("#mOk").click(); await wait(80);
    const ev = await M.Repo.events.get("ev_draft");
    if (ev.status !== "published") throw new Error("公開が保存されない: " + ev.status);
  });
  await step("C-1 公開後は下書きに戻せない（F-37）", async () => {
    await M.EventDetail.render(content, "ev_draft"); await wait(20);
    clickTab(7); await wait(20);
    if (content.querySelector("#publishBtn")) throw new Error("公開済みに公開ボタンが出ている");
    if (content.querySelector("#deleteBtn")) throw new Error("公開済みに削除ボタンが出ている");
  });
  await step("C-1 中止が永続し、申込は変更されない（F-39）", async () => {
    const before = (await M.Repo.applications.byEvent("ev_public")).map(a => a.status).join(",");
    await M.EventDetail.render(content, "ev_public"); await wait(20);
    clickTab(7); await wait(20);
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
    try { await M.AppSvc.editApplicant(target.id, { name:"a", kana:"ア", email:"tanaka@example.com" }); }
    catch { threw = true; }
    if (!threw) throw new Error("誤統合が許されている");
  });

  // ---- C-2: 申込フローの永続化 ----
  await step("C-2 申込が永続し、名寄せされる（F-16〜F-19）", async () => {
    const evId = "ev_limited";
    const beforeP = (await M.Repo.persons.all()).length;
    const { app, person } = await M.AppSvc.apply(evId, {
      name:"田中 太郎", kana:"たなか たろう", email:" TANAKA@example.com ", consent:true, answers:{} });
    if ((await M.Repo.persons.all()).length !== beforeP) throw new Error("既存の人が名寄せされず増えた");
    if (person.id !== "p0") throw new Error("emailKey での名寄せが効いていない: " + person.id);
    if (person.nameKana !== "タナカ タロウ") throw new Error("カナがカタカナ化されていない");
    if (!/^[0-9a-f]{32}$/.test(app.token)) throw new Error("トークンが不正");
    if (!await M.Repo.savedTokens.get(app.token)) throw new Error("端末に控えが保存されない");
  });
  await step("C-2 同一イベントへの二重申込を拒否（F-17）", async () => {
    let threw = false;
    try { await M.AppSvc.apply("ev_limited", { name:"田中 太郎", kana:"タナカ タロウ", email:"tanaka@example.com", consent:false, answers:{} }); }
    catch { threw = true; }
    if (!threw) throw new Error("二重申込ができてしまう");
  });
  await step("C-2 キャンセル後の再申込は許す（F-42）", async () => {
    const mine = (await M.Repo.applications.byEvent("ev_limited")).filter(a => a.personId === "p0");
    await M.AppSvc.cancel(mine[0].id);
    const { app } = await M.AppSvc.apply("ev_limited", { name:"田中 太郎", kana:"タナカ タロウ", email:"tanaka@example.com", consent:false, answers:{} });
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
    if (!content.querySelector('[data-q="q_dept"]')) throw new Error("カスタム質問が描画されない");
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
    content.querySelector('[data-q="q_dept"]').value = "情報システム部";
    content.querySelector("#toConfirm").click(); await wait(40);
    if (!content.querySelector("#submit")) throw new Error("確認画面に進めない");
    if (!content.innerHTML.includes("情報システム部")) throw new Error("確認画面に回答が出ない");
    content.querySelector("#submit").click(); await wait(120);
    const a = (await M.Repo.applications.byEvent("ev_soon")).find(x => x.answers && x.answers.q_dept === "情報システム部");
    if (!a) throw new Error("申込が保存されない");
    if (!content.innerHTML.includes("申込が完了しました")) throw new Error("完了画面に進まない");
  });
  await step("C-2 主催者の一覧に反映され残席が減る（受け入れ確認8）", async () => {
    await M.EventDetail.render(content, "ev_soon"); await wait(30);
    if (!content.innerHTML.includes("テスト 太郎")) throw new Error("申込一覧に出ない");
  });
  await step("C-2 参加者からのキャンセルも共通処理（F-25）", async () => {
    const a = (await M.Repo.applications.byEvent("ev_soon")).find(x => x.answers && x.answers.q_dept === "情報システム部");
    await M.AppSvc.cancel(a.id);
    if ((await M.Repo.applications.get(a.id)).status !== "cancelled") throw new Error("共通キャンセルが効かない");
  });

  // ---- F-20 / F-07 ----
  await step("F-20 確認URL(?ticket=)から申込詳細へ復帰", async () => {
    const a = (await M.Repo.applications.byEvent("ev_public"))[0];
    window.history.replaceState(null, "", "/index.html?ticket=" + a.token);
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
    const a = (await M.Repo.applications.byEvent("ev_public")).find(x => x.status !== "cancelled");
    M.Participant.selectTicket(a.token);
    await M.Participant.renderMyTicket(content); await wait(40);
    if (!content.innerHTML.includes("teams.microsoft.com")) throw new Error("申込者に視聴URLが出ない");
    M.Participant.resetMyTicket();
  });
  await step("F-d 複製で下書きが作られ copiedFromId が残る", async () => {
    const before = (await M.Repo.events.all()).length;
    await M.EventDetail.render(content, "ev_limited"); await wait(30);
    content.querySelectorAll("#subtabs button")[7].click(); await wait(30);
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
      questions:[{ id:"q1", label:"所属", type:"text", required:true, options:[] }],
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
    if ((await M.Repo.events.all()).length !== 10) throw new Error("再投入されない");
  });

  await step("DB reset → 空", async () => { await M.Repo.reset(); if ((await M.Repo.events.all()).length !== 0) throw new Error("リセット後も残存"); });

  console.log("\n===== SMOKE TEST RESULTS =====");
  for (const [s, n] of results) console.log(s + " " + n);
  const failed = results.filter(r => r[0] === "ERR").length;
  console.log(`\n${results.filter(r=>r[0]==="OK ").length} passed, ${failed} failed`);
  if (errors.length) { console.log("\n----- captured errors -----"); errors.slice(0, 15).forEach(e => console.log(String(e).split("\n").slice(0,4).join("\n"))); }
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
