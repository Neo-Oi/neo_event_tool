# tests（開発補助・任意 / 成果物ではない）

`smoke.js` は jsdom + fake-indexeddb で `index.html` を実ブラウザ相当に読み込み、
主要な描画・操作パス（DB/シード/残席・運営スレッド/Q&A/タスク/マニュアル/ファイル共有・
申込フローの一周・URL復帰・CSV・参加者名簿・カレンダー）を通す非公式なスモークテスト。

**アプリ本体は npm 不使用。これは開発時だけ使う任意ツール。**
`package.json` と `node_modules` は `.gitignore` 済みで、成果物には含まれない。

```bash
npm i jsdom fake-indexeddb   # 初回のみ
node tests/guard.js          # 技術方針への適合（依存なしで動く）
node tests/smoke.js          # 期待: N passed, 0 failed
```

CI（`.github/workflows/test.yml`）が push と pull request のたびに両方を実行する。

## guard.js（技術方針の検査）

`CLAUDE.md` の技術方針・禁止事項を機械的に検査する。**npm 依存なしで動く。**

- 禁止API: `Math.random()` / `localStorage` / `sessionStorage`
- 単一HTMLの自己完結: `<script src>` / `<link href>` / 画像ファイル参照
- Repository 層の迂回: `Repo` 定義の外からの `DB.*()` 直呼び
- 区画マーカー `// ===== [n] =====` の並びの逆転

**コメントと文字列と正規表現リテラルを取り除いてから判定する。**
単純な grep だと「`Math.random()` は使用しない」というコメント自体に反応してしまう。
また正規表現リテラル（`/[&<>"']/g` など）の中の引用符を文字列の開始と誤認すると
以降の解析がずれ、**本物の違反を見逃す**。実際に一度それで見逃した。

## この環境で検証できないこと

jsdom + fake-indexeddb は実ブラウザではないため、以下は**手動で確認する必要がある**。

| 項目 | 理由 |
|---|---|
| **Blob の往復**（カバー画像 F-03 / 共有ファイル E-3） | fake-indexeddb の構造化複製が Blob に対応しておらず、取り出すと素の Object になる。テストはメタデータ側のみ検証している。**2026-07-28 にブラウザで手動確認し、正常に動作することを確認済み。** この箇所を変更したら都度手動で確認すること |
| **ドラッグ&ドロップ**（運営タスクのボード） | jsdom が DnD を実装していない。カードの DOM を移動してから `zone.ondrop(...)` を直接呼び、保存処理だけを検証している |
| **カメラ**（QR受付 F-95） | `getUserMedia` が無い |
| **CDN の実取得**（QR**読取**のみ） | ネットワークに出ないため。QR**生成**はインライン化したので本物を検証している |
| **実際の描画結果**（レイアウト崩れ） | jsdom はスタイルを計算しない |

上記は `python3 -m http.server 8010` で起動し、ブラウザで確認すること。
