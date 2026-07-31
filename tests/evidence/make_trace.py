#!/usr/bin/env python3
"""docs/トレーサビリティ一覧.md を作る。
仕様書5章は「IF → 項目番号」の一方向なので、その逆（項目番号 → IF・区分・エビデンス）を作る。
並びは Excel の行順と同じにして、番号で1行ずつ突き合わせられるようにする。"""
import collections, json, os, re, sys

ITEMS = sys.argv[1]
EV = 'evidence'
DATE = '20260731'
OUT = 'docs/トレーサビリティ一覧.md'

items = json.load(open(ITEMS, encoding='utf-8'))
shots, other = collections.defaultdict(list), collections.defaultdict(list)
for f in sorted(os.listdir(EV)):
    m = re.match(r'^(\d+-\d+-\d+)_' + DATE + r'_(.+)$', f)
    if m:
        (shots if f.endswith('.png') else other)[m.group(1)].append(f)

SECTION = {'1': 'ダッシュボード', '2': 'イベント一覧・作成', '3': 'イベント詳細',
           '4': '参加者ビュー', '5': '名簿・設定', '6': '共通', '7': '通シナリオ'}


def evidence_cell(i):
    no = i['no']
    ps, os_ = shots.get(no, []), other.get(no, [])
    if ps or os_:
        bits = []
        if len(ps) == 1:
            bits.append(f'`{ps[0]}`')
        elif ps:
            bits.append(f'`{no}_{DATE}_*.png`（{len(ps)}枚）')
        for f in os_:
            bits.append(f'`{f}`')
        return '<br>'.join(bits)
    if i['区分'] == '自動':
        return 'CI の実行ログ（`guard.js` / `smoke.js` 151件）'
    return '未取得（人が実施して Excel の履歴欄に記入する）'


by_sec = collections.OrderedDict()
for i in items:
    by_sec.setdefault(i['no'].split('-')[0], []).append(i)

cnt = collections.Counter(i['区分'] for i in items)
n_ev = len(set(shots) | set(other))
n_png = sum(len(v) for v in shots.values())
n_out = sum(len(v) for v in other.values())

L = []
L.append('# トレーサビリティ一覧（項目番号からの逆引き）\n')
L.append('作成日：2026年7月31日\n')
L.append('`結合試験仕様書.md` 5章は **IF → 項目番号** の方向しか持っていない。')
L.append('本書はその逆で、**項目番号から IF・区分・エビデンスを引く**。')
L.append('並びは `結合試験項目一覧.xlsx` の行順と同一なので、番号で1行ずつ突き合わせられる。\n')
L.append('## 突き合わせ方\n')
L.append('| 見たいもの | 引き方 |')
L.append('|---|---|')
L.append('| 番号 → 試験の中身 | `結合試験仕様書.md` 3章、または Excel の同じ番号の行 |')
L.append('| 番号 → エビデンス | 本書の表、または `evidence/` を番号で前方一致（`3-3-1_*`） |')
L.append('| 番号 → 実施記録 | Excel の同じ番号の行（**履歴欄にエビデンスのファイル名が入っている**） |')
L.append('| 番号 → IF | 本書の表（IF列） |')
L.append('| IF → 番号 | `結合試験仕様書.md` 5章 |')
L.append('| エビデンス → 番号 | ファイル名の先頭が項目番号（`<項目番号>_<YYYYMMDD>_<連番>.png`） |\n')
L.append('**エビデンスのファイル名は先頭が項目番号なので、番号そのものが結合キーになる。**\n')
L.append('## 集計\n')
L.append('| 区分 | 件数 | エビデンスの取り方 |')
L.append('|---|---|---|')
L.append(f'| 自動 | {cnt["自動"]} | CI（`guard.js` / `smoke.js` 151件）の実行ログ |')
L.append(f'| 自動＋手動 | {cnt["自動＋手動"]} | 実画面のスクリーンショット（**{n_png}枚・出力物{n_out}件を取得済み**） |')
L.append(f'| 手動 | {cnt["手動"]} | 人が実施して Excel に記入（カメラ・通信遮断・実機の操作感・表計算での実開き） |')
L.append(f'| **合計** | **{sum(cnt.values())}** | うち {n_ev} 項目のエビデンスが `evidence/` にある |\n')
L.append('---\n')

for k, its in by_sec.items():
    L.append(f'## {k}. {SECTION[k]}（{len(its)}項目）\n')
    L.append('| 項目番号 | 大項目 | 中項目 | 小項目 | 区分 | IF | エビデンス |')
    L.append('|---|---|---|---|---|---|---|')
    for i in its:
        L.append(f'| {i["no"]} | {i["大"]} | {i["中"]} | {i["小"]} | {i["区分"]} | {i["IF"]} | {evidence_cell(i)} |')
    L.append('')

open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(f'{OUT} を作成（{sum(cnt.values())}項目 / エビデンス {n_ev}項目）')
