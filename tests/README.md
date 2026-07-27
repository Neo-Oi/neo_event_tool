# tests（開発補助・任意 / 成果物ではない）

`smoke.js` は jsdom + fake-indexeddb で `index.html` を実ブラウザ相当に読み込み、
主要な描画・操作パス（DB/シード/チケット廃止後の残席・運営スレッド/Q&Aの永続・
ウィザード・参加者表示・リセット）を通す非公式なスモークテスト。

**アプリ本体は npm 不使用。これは開発時だけ使う任意ツール。**

```bash
npm init -y && npm install jsdom fake-indexeddb   # 初回のみ
node tests/smoke.js                               # 期待: N passed, 0 failed
```
