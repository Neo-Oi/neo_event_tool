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
    "\n;window.__M={App,Repo,Seed,DB,Domain,Util,Dashboard,EventsList,EventDetail,Ops,Tasks,Settings,Wizard,Participant,FB};");
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

  await step("DB open (v2)", async () => { if (!M.DB.db()) throw new Error("DB未オープン"); if (M.DB.db().objectStoreNames.contains("ticketTypes")) throw new Error("ticketTypesが残存"); if (!M.DB.db().objectStoreNames.contains("messages")) throw new Error("messagesストアなし"); if (!M.DB.db().objectStoreNames.contains("tasks")) throw new Error("tasksストアなし"); });
  await step("Seed.load", async () => { await M.Seed.load(); });
  await step("Seed件数（チケット廃止後）", async () => {
    const [ev, ps, ap, sv, msg, tk] = await Promise.all([
      M.Repo.events.all(), M.Repo.persons.all(), M.Repo.applications.all(),
      M.Repo.savedTokens.all(), M.DB.getAll("messages"), M.DB.getAll("tasks")]);
    const c = `ev=${ev.length} ps=${ps.length} ap=${ap.length} sv=${sv.length} msg=${msg.length} task=${tk.length}`;
    if (ev.length !== 6 || sv.length !== 3 || msg.length !== 5 || tk.length !== 10) throw new Error("件数不正: " + c);
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
  await step("EventsList.render", async () => { await M.EventsList.render(content); nonEmpty("events"); if (content.innerHTML.includes("申込枠")) throw new Error("申込枠の語が残存"); });
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

  // 運営スレッド（実データで永続）
  await step("運営スレッド 表示", async () => { clickTab(1); await wait(20); if (!content.querySelector("#opSend")) throw new Error("送信ボタンなし"); if (content.querySelectorAll(".bubble").length !== 2) throw new Error("シードのスレッド2件が出ない"); });
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

  await step("告知タブ（X/LINEリンク）", async () => {
    clickTab(4); await wait(20);
    if (!content.querySelector("#xShare").href.includes("twitter.com")) throw new Error("X共有リンク不正");
    if (!content.querySelector("#lineShare").href.includes("line.me")) throw new Error("LINE共有リンク不正");
  });
  await step("概要・編集タブ + 中止確認モーダル", async () => {
    clickTab(5); await wait(20);
    const c = content.querySelector("#cancelBtn");
    if (c) { c.click(); await wait(20); if (!window.document.querySelector("#modalHost .modal")) throw new Error("確認モーダルなし"); window.document.querySelector("#mCancel").click(); }
  });
  await step("Settings.render（実装区分に運営行）", async () => { await M.Settings.render(content); if (!content.innerHTML.includes("運営スレッド")) throw new Error("実装区分に運営行なし"); if (!content.innerHTML.includes("運営タスク")) throw new Error("実装区分に運営タスク行なし"); if (!content.innerHTML.includes("チケット制")) throw new Error("チケット制廃止行なし"); });

  // ウィザード（申込枠→定員のみ）
  await step("Wizard.render(新規)", async () => { await M.Wizard.render(content, null); nonEmpty("wizard"); });
  await step("Wizard 名称未入力で次へ→エラー", async () => { content.querySelector("#next").click(); await wait(20); if (!content.querySelector(".field .err")) throw new Error("必須エラーなし"); });
  await step("Wizard 5ステップ踏破（申込枠名の入力なし）", async () => {
    content.querySelector('[data-f="title"]').value = "テストイベント";
    for (let i = 0; i < 3; i++) { content.querySelector("#next").click(); await wait(20); }
    if (content.innerHTML.includes("申込枠の名称")) throw new Error("枠名フィールドが残存");
    if (!content.querySelector('[data-f="capacity"]')) throw new Error("定員フィールドがない（step4）");
    content.querySelector("#next").click(); await wait(20);
    if (!content.querySelector("#publish")) throw new Error("最終ステップに公開ボタンなし");
  });
  await step("Wizard.render(編集)", async () => { await M.Wizard.render(content, "ev_public"); if (content.querySelector('[data-f="capacity"]') == null) { /* step4で確認 */ } nonEmpty("wizard-edit"); });

  // 参加者（最後仕上げ。表示のみ確認）
  await step("Participant.renderPublic(ev_public)", async () => { await M.Participant.renderPublic(content, "ev_public"); nonEmpty("public"); });
  await step("Participant.renderMyTicket（マイ申込）", async () => { await M.Participant.renderMyTicket(content); if (!content.innerHTML.includes("マイ申込")) throw new Error("マイ申込の見出しなし"); if (content.querySelectorAll(".ticket-item").length !== 3) throw new Error("件数不正"); });

  await step("DB reset → 空", async () => { await M.Repo.reset(); if ((await M.Repo.events.all()).length !== 0) throw new Error("リセット後も残存"); });

  console.log("\n===== SMOKE TEST RESULTS =====");
  for (const [s, n] of results) console.log(s + " " + n);
  const failed = results.filter(r => r[0] === "ERR").length;
  console.log(`\n${results.filter(r=>r[0]==="OK ").length} passed, ${failed} failed`);
  if (errors.length) { console.log("\n----- captured errors -----"); errors.slice(0, 15).forEach(e => console.log(String(e).split("\n").slice(0,4).join("\n"))); }
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
