/* 成果物（index.html）が技術方針から外れていないかを機械的に検査する。
   CLAUDE.md「技術方針」「実装上の禁止事項」に対応。CI から実行される。

   コメント内の言及（「Math.random() は使用しない」など）を誤検出しないよう、
   検査前に JS のコメントと文字列リテラルを取り除いてから判定する。 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
const m = html.match(/<script>\s*"use strict";([\s\S]*)<\/script>/);
if (!m) fail("index.html からインラインスクリプトを取り出せませんでした");
const script = m[1];

const problems = [];
function fail(msg) { problems.push(msg); }

/* コメント・文字列・正規表現リテラルを潰す。
   **正規表現リテラルを飛ばさないと壊れる。** 本体に /[&<>"']/g のような正規表現があり、
   その中の " を文字列の開始と誤認すると、そこから先の解析が全部ずれる。
   実際にそれで Math.random() の検出をすり抜けさせたことがあるので、必ず対応しておくこと。
   スラッシュが除算か正規表現かは、直前の非空白文字から判定する（一般的な近似）。 */
function stripCommentsAndStrings(src) {
  let out = "", i = 0, prev = "";
  const n = src.length;
  // 直前が識別子・数値・`)` `]` なら除算、それ以外なら正規表現の開始とみなす
  const regexAllowed = () => prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; out += '""'; prev = '"'; continue;
    }
    if (c === "/" && regexAllowed()) {           // 正規表現リテラル
      i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === "\n") break;             // 未閉じなら諦める
        i++;
      }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++; // フラグ
      out += "RE"; prev = "E"; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}
const code = stripCommentsAndStrings(script);

// --- 禁止API（CLAUDE.md 実装上の禁止事項 / 技術方針） ---
if (/\bMath\s*\.\s*random\s*\(/.test(code))
  fail("Math.random() は使用禁止です。トークン・IDは crypto.getRandomValues() を使ってください");
if (/\b(localStorage|sessionStorage)\b/.test(code))
  fail("localStorage / sessionStorage は使用禁止です。永続データは IndexedDB に置いてください");

// --- 単一HTMLの自己完結（外部ファイルを作らない） ---
const body = html.replace(/<script>[\s\S]*<\/script>/, "");
/* <link href> は「同梱すべきファイルの切り出し」を禁じるのが目的なので、
   絶対URL（https:// / CDN）は通し、相対パス＝ローカルファイルだけを弾く
   （Google Fonts のため。以前は一律で落としていた）。
   一方 <script src> は URL を問わず禁止のまま——第三者スクリプトの静的読み込みは
   改ざんリスクを負う（QR生成をインライン化した理由 / 引き継ぎ書 7-12）。
   CDN のスクリプトは Util.loadScript の遅延読み込みだけを許す。 */
const localRef = (tag, attr) => {
  const re = new RegExp(`<${tag}[^>]+\\b${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
  return [...body.matchAll(re)].map(m => m[1]).filter(v => !/^https:\/\//.test(v));
};
if (/<script[^>]+\bsrc\s*=/.test(body))
  fail("<script src> が含まれています。JS はインラインにしてください（CDN は Util.loadScript で遅延読み込み）");
for (const v of localRef("link", "href"))
  fail(`<link href="${v}"> がローカルを参照しています。CSS はインラインにしてください`);
if (/<img[^>]+src\s*=\s*["'](?!data:)[^"']*\.(png|jpe?g|gif|svg|webp)/i.test(body))
  fail("画像ファイルを参照しています。インラインSVGかデータURIにしてください");

// --- Repository 層の迂回（引き継ぎ書 4-2） ---
const repoStart = code.indexOf("const Repo");
const repoEnd = code.indexOf("const Domain");
if (repoStart < 0 || repoEnd < 0) fail("Repo / Domain の定義位置を特定できませんでした");
else {
  const outside = code.slice(0, repoStart) + code.slice(repoEnd);
  const hits = outside.match(/\bDB\s*\.\s*(getAll|getAllByIndex|get|put|remove|bulkPut)\s*\(/g);
  if (hits) fail(`Repository 層を迂回した DB 直呼びが ${hits.length} 件あります（Repo にメソッドを足して経由させてください）`);
}

// --- 区画マーカーの並び（引き継ぎ書 7-3） ---
const markers = [...html.matchAll(/^\/\/ ===== \[([0-9]+[a-z]?)\]/gm)].map(x => x[1]);
const key = (s) => {
  const num = parseInt(s, 10);
  const suf = s.replace(/^[0-9]+/, "");
  return num * 100 + (suf ? suf.charCodeAt(0) - 96 : 0);
};
for (let i = 1; i < markers.length; i++)
  if (key(markers[i]) < key(markers[i - 1]))
    fail(`区画マーカーの並びが逆転しています: [${markers[i - 1]}] の後に [${markers[i]}]`);

// --- 結果 ---
if (problems.length) {
  console.error("技術方針への違反が見つかりました:\n");
  problems.forEach(p => console.error("  ✗ " + p));
  process.exit(1);
}
console.log(`OK: 技術方針への違反はありません（区画 ${markers.length} 個を確認）`);
