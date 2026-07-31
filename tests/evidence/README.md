# エビデンス撮影の一式

結合試験のエビデンス（`evidence/`）を撮り直すための道具。
`docs/結合試験仕様書.md` 3章の「手順」欄をそのまま操作に落とし、実画面を撮る。

**149項目のうち144項目を撮れる。** 撮れないのは次の5項目だけ。

| 項目 | 撮れない理由 |
|---|---|
| 3-4-1〜3-4-4 | QR の読み取り。カメラと**2台目の実機**が要る |
| 5-2-3 | 対象外（実装区分の一覧は画面から削除済み） |

## 中身

| ファイル | 役割 |
|---|---|
| `capture.mjs` | 撮影の本体。項目を1つずつ実行し `evidence/` に置く |
| `lib.mjs` | ブラウザ起動・画面遷移・デモデータ投入・遮断/低速/権限の細工 |
| `recipes.mjs` | 区分「自動＋手動」97項目の手順 |
| `recipes2.mjs` | 区分「手動」「自動」のうち撮れる47項目の手順 |
| `items.json` | 仕様書3章の項目表を機械可読にしたもの（番号・区分・手順・期待動作・IF） |
| `make_viewer.py` | `evidence/index.html`（番号で引ける一覧ページ）を作る |
| `make_index.py` | `evidence/README.md` を作る |
| `make_trace.py` | `docs/トレーサビリティ一覧.md` を作る |
| `patch_history.py` | Excel の履歴欄にエビデンスのファイル名を書き込む |

## 準備

**製品（`index.html`）には一切影響しない。** これは試験の道具で、成果物の自己完結の制約とは無関係。

```bash
npm install playwright                 # package.json は .gitignore 済み
npx playwright install chromium
```

### WSL で動かす場合の2点

このリポジトリの開発環境（WSL2 / Ubuntu）では、追加で次が要る。**root は不要。**

**1. Chromium が要る共有ライブラリ**（`libnspr4` / `libnss3` / `libasound2t64`）が入っていない。
`sudo` が使えないので、deb を取ってきて展開し `LD_LIBRARY_PATH` で参照する。

```bash
mkdir -p /tmp/cap-libs && cd /tmp/cap-libs
for p in libnspr4 libnss3 libasound2t64; do apt-get download "$p"; done
for f in *.deb; do dpkg -x "$f" root; done
export LD_LIBRARY_PATH=/tmp/cap-libs/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

**2. 日本語フォントが入っていない**（そのまま撮ると豆腐になる）。
Windows 側のフォントを fontconfig に見せる。実機の Chrome と同じ書体になるので、見え方も揃う。

```bash
mkdir -p /tmp/cap-fc/cache
cat > /tmp/cap-fc/fonts.conf <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>/mnt/c/Windows/Fonts</dir>
  <cachedir>/tmp/cap-fc/cache</cachedir>
  <match target="pattern"><test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Yu Gothic UI</string></edit></match>
  <match target="pattern"><test qual="any" name="family"><string>system-ui</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Yu Gothic UI</string></edit></match>
</fontconfig>
XML
export FONTCONFIG_FILE=/tmp/cap-fc/fonts.conf
fc-cache -f
```

## 撮る

```bash
python3 -m http.server 8010 &          # file:// では IndexedDB が動かない

node tests/evidence/capture.mjs                 # 全144項目（30分ほどかかる）
node tests/evidence/capture.mjs 3-              # セクション3だけ
node tests/evidence/capture.mjs 3-3-1 4-5-2     # 番号を指定
```

## 撮ったあとに必ず走らせる

エビデンスを増減したら、**索引・逆引き・Excel の履歴欄がずれる**。3つとも作り直して突き合わせる。

```bash
python3 tests/evidence/make_viewer.py  tests/evidence/items.json   # evidence/index.html
python3 tests/evidence/make_index.py   tests/evidence/items.json   # evidence/README.md
python3 tests/evidence/make_trace.py   tests/evidence/items.json   # docs/トレーサビリティ一覧.md
python3 tests/evidence/patch_history.py tests/evidence/items.json --apply   # Excel の履歴欄
python3 tests/trace_check.py                                       # 突き合わせ
```

**`patch_history.py` は Excel を書き換える。開いたまま実行しないこと**（Excel 側から保存すると上書きで消える）。
引数無しで実行すると変更内容だけ表示するドライラン。

## 作りの注意

- **デモデータは項目ごとに「初期化→投入」で入れ直す。** 項目間で状態が混ざらないようにするため。
  読むだけの項目は `fresh: false / mutates: false` を付けて投入を省いている
- **ログイン（F-107）と名簿のロック（F-101）はセッション内だけの状態**なので、各項目の前にページを開き直す。
  これを忘れると前の項目のログイン状態を引き継いで落ちる
- **遮断・低速・権限拒否・例外注入を使う項目は `isolate: true`** を付け、別のコンテキストで走らせる。
  `addInitScript` は取り消せず、`route` も残るため、後続の項目を汚す
- **F12 の Offline は localhost も落ちる。** 読み込んでから切り替えること（7-11-1）
- **公開済みイベントの編集は最終ステップのボタンが `#saveOnly` になる**（下書きは `#check`/`#saveDraft`/`#publish`）
- **複数枚のときは履歴欄に `*` で書く**（`evidence/1-4-2_20260731_*.png（4枚）`）。
  「〜」で範囲を書くとファイル名として解決できず、トレーサビリティの役に立たない

## 撮ったものが証明すること・しないこと

自動取得のスクリーンショットが示すのは「**アプリがこう描画した**」まで。
「**人が操作して妥当と判断した**」ではない。判断の行為は人に残る（仕様書 1-4・6-3）。
