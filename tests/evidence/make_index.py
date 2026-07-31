#!/usr/bin/env python3
"""evidence/README.md を作る。項目番号ごとに、撮れたファイルを並べる。"""
import json, os, re, sys, collections

ITEMS = sys.argv[1]
EV = '/home/neo-oi/neo_event_tool/evidence'
DATE = '20260731'

items = json.load(open(ITEMS, encoding='utf-8'))
by_no = {i['no']: i for i in items}

files = collections.defaultdict(list)
for f in sorted(os.listdir(EV)):
    m = re.match(r'^(\d+-\d+-\d+)_' + DATE + r'_(.+)$', f)
    if m:
        files[m.group(1)].append(f)

targets = items
done = [i for i in targets if files.get(i['no'])]
missing = [i for i in targets if not files.get(i['no'])]

png = sum(1 for fs in files.values() for f in fs if f.endswith('.png'))
other = sum(1 for fs in files.values() for f in fs if not f.endswith('.png'))

out = []
out.append('# エビデンス（結合試験）\n')
out.append(f'取得日：2026年7月31日　／　対象：区分が「自動＋手動」の {len(targets)} 項目\n')
out.append('命名は `結合試験仕様書.md` 6-2 に従う（`<項目番号>_<YYYYMMDD>_<連番>.png`）。')
out.append('出力ファイル（CSV）は同じ規則で `<項目番号>_<YYYYMMDD>_<元のファイル名>` として置いている。\n')
out.append('## 取得方法\n')
out.append('ローカルHTTPサーバ（`python3 -m http.server 8010`）に対し、Chromium を 1280x900 で動かして')
out.append('仕様書の「手順」欄どおりに操作し、実データの画面をそのまま撮っている。')
out.append('デモデータは各項目の前に「初期化→投入」で入れ直しているので、項目間で状態が混ざらない。\n')
out.append(f'## 集計\n')
out.append(f'| 区分 | 件数 |')
out.append(f'|---|---|')
out.append(f'| 撮影できた項目 | {len(done)} / {len(targets)} |')
out.append(f'| スクリーンショット | {png} 枚 |')
out.append(f'| 出力ファイル（CSV等） | {other} 件 |\n')
if missing:
    out.append('### 撮影できなかった項目\n')
    for i in missing:
        out.append(f'- **{i["no"]}** {i["大"]}／{i["中"]}／{i["小"]}')
    out.append('')

out.append('## 番号で引く\n')
out.append('- **`evidence/index.html`** をローカルHTTPサーバで開くと、項目ごとに手順・期待動作と画像が並ぶ。')
out.append('  番号での絞り込みと `#3-3-1` のようなアンカーで直接飛べる')
out.append('- **`docs/トレーサビリティ一覧.md`** に 項目番号 → IF・区分・エビデンス の逆引き表がある')
out.append('- **`docs/結合試験項目一覧.xlsx`** の履歴欄に、その行のエビデンスのファイル名が入っている')
out.append('- ファイル名の先頭が項目番号なので、`3-3-1_*` のような前方一致でも引ける\n')
out.append('## 項目ごとのファイル\n')
out.append('| 項目番号 | 大項目 | 中項目 | 小項目 | エビデンス |')
out.append('|---|---|---|---|---|')
for i in targets:
    fs = files.get(i['no'], [])
    cell = '<br>'.join(f'`{f}`' for f in fs) if fs else '—'
    out.append(f'| {i["no"]} | {i["大"]} | {i["中"]} | {i["小"]} | {cell} |')

open(os.path.join(EV, 'README.md'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(f'evidence/README.md を作成： {len(done)}/{len(targets)} 項目、PNG {png}枚、出力物 {other}件')
if missing:
    print('未取得:', ', '.join(i['no'] for i in missing))
