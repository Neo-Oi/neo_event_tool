# tests（開発補助・任意 / 成果物ではない）

`smoke.js` は jsdom + fake-indexeddb で `index.html` を実ブラウザ相当に読み込み、
主要な描画・操作パス（DB/シード/チケット廃止後の残席・運営スレッド/Q&Aの永続・
運営タスクのボード/タイムライン/ドロップ保存・ウィザード・参加者表示・リセット）を
通す非公式なスモークテスト。

ドラッグ&ドロップは jsdom が DnD を実装していないため、カードの DOM を移動してから
`zone.ondrop(...)` を直接呼ぶ形で保存処理だけを検証している。

**アプリ本体は npm 不使用。これは開発時だけ使う任意ツール。**

```bash
npm init -y && npm install jsdom fake-indexeddb   # 初回のみ
node tests/smoke.js                               # 期待: N passed, 0 failed
```
