#!/usr/bin/env python3
"""トレーサビリティの突き合わせ。

項目番号を結合キーとして、次の4つが食い違っていないかを見る。
  ① docs/結合試験仕様書.md      … 試験の中身（3章の表）
  ② docs/結合試験項目一覧.xlsx  … 実施記録の帳票（区分＝備考欄／エビデンス＝履歴欄）
  ③ docs/トレーサビリティ一覧.md … 番号からの逆引き
  ④ evidence/                   … 実物（ファイル名の先頭が項目番号）

使い方: python3 tests/trace_check.py   （リポジトリ直下で実行）
外部ライブラリは使わない。xlsx は zip + XML として読む。
"""
import collections, glob, os, re, sys, xml.dom.minidom, zipfile

SPEC = 'docs/結合試験仕様書.md'
XLSX = 'docs/結合試験項目一覧.xlsx'
TRACE = 'docs/トレーサビリティ一覧.md'
EV = 'evidence'
DATE = '20260731'
NO = re.compile(r'^\d+-\d+-\d+$')


def read_spec():
    """3章の項目表から 項目番号 → 区分 を拾う。列数が足りない行（他章の参照）は飛ばす。"""
    out = {}
    for line in open(SPEC, encoding='utf-8'):
        if not line.startswith('| '):
            continue
        cols = [c.strip() for c in line.strip().strip('|').split('|')]
        if not cols or not NO.match(cols[0]) or len(cols) < 10:
            continue
        out[cols[0]] = next((c for c in cols if c in ('自動', '手動', '自動＋手動')), '')
    return out


def read_xlsx():
    """B-C-D を項目番号、P を区分（備考）、O をエビデンス（履歴）として読む。"""
    z = zipfile.ZipFile(XLSX)
    for name in z.namelist():
        if name.endswith(('.xml', '.rels')):
            xml.dom.minidom.parseString(z.read(name))     # 壊れていればここで落ちる
    sst = [''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))
           for si in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf-8'), re.S)]
    cell = re.compile(r'<c ([^>]*?)/>|<c ([^>]*?)>(.*?)</c>', re.S)

    def value(attrs, body):
        t = re.search(r't="(\w+)"', attrs)
        v = re.search(r'<v>(.*?)</v>', body, re.S)
        if not v:
            return ''
        return sst[int(v.group(1))] if (t and t.group(1) == 's') else v.group(1)

    rows = []
    for n in range(1, 9):
        sheet = f'xl/worksheets/sheet{n}.xml'
        if sheet not in z.namelist():
            continue
        for row in re.findall(r'<row[^>]*>(.*?)</row>', z.read(sheet).decode('utf-8'), re.S):
            c = {}
            for m in cell.finditer(row):
                attrs = m.group(1) or m.group(2)
                ref = re.search(r'r="([A-Z]+)\d+"', attrs)
                if ref:
                    c[ref.group(1)] = value(attrs, m.group(3) or '')
            if c.get('B', '').isdigit() and c.get('E'):
                rows.append((f"{c['B']}-{c['C']}-{c['D']}", c.get('P', ''), c.get('O', '')))
    return rows


def read_trace():
    return [m.group(1) for line in open(TRACE, encoding='utf-8')
            if (m := re.match(r'\| (\d+-\d+-\d+) \|', line))]


def read_evidence():
    out = collections.defaultdict(list)
    for f in sorted(os.listdir(EV)):
        if (m := re.match(r'^(\d+-\d+-\d+)_' + DATE + r'_', f)):
            out[m.group(1)].append(f)
    return out


def main():
    spec, rows, trace, ev = read_spec(), read_xlsx(), read_trace(), read_evidence()
    order = [r[0] for r in rows]
    xl = {no: (kind, hist) for no, kind, hist in rows}
    ng = []

    def check(label, ok, detail=''):
        print(('OK  ' if ok else 'NG  ') + label + (f'  → {detail}' if detail and not ok else ''))
        if not ok:
            ng.append(label)

    check('項目数が3箇所で一致', len(spec) == len(xl) == len(trace),
          f'仕様書{len(spec)} / Excel{len(xl)} / 逆引き{len(trace)}')
    check('番号の集合が一致', set(spec) == set(xl) == set(trace),
          f'差分 {sorted((set(spec) ^ set(xl)) | (set(spec) ^ set(trace)))[:5]}')
    check('並び順が一致（Excel の行順＝仕様書＝逆引き）', order == list(spec) == trace)
    mismatch = [n for n in spec if n in xl and xl[n][0] != spec[n]]
    check('区分が Excel と仕様書で一致', not mismatch, str(mismatch[:5]))

    # 区分とエビデンスの有無は対応しない（1-4 の注記）。撮れないのは実機が要る4件と対象外1件だけ。
    NO_EVIDENCE = {'3-4-1', '3-4-2', '3-4-3', '3-4-4', '5-2-3'}
    want = set(spec) - NO_EVIDENCE
    check('実機が要る4件と対象外1件を除く全項目にエビデンスがある', set(ev) == want,
          f'余分 {sorted(set(ev) - want)[:3]} / 不足 {sorted(want - set(ev))[:5]}')

    missing, wrong_no = [], []
    for no, (_, hist) in xl.items():
        for pat in re.findall(r'evidence/([^／（]+)', hist):
            if not glob.glob(os.path.join(EV, pat)):
                missing.append((no, pat))
            elif not pat.startswith(no + '_'):
                wrong_no.append((no, pat))
    check('履歴欄の参照が実在する', not missing, str(missing[:3]))
    check('履歴欄の参照が自分の項目番号で始まる', not wrong_no, str(wrong_no[:3]))

    counted = []
    for no, (_, hist) in xl.items():
        m = re.search(r'evidence/([^／（]+\*\.png)（(\d+)枚）', hist)
        if m and len(glob.glob(os.path.join(EV, m.group(1)))) != int(m.group(2)):
            counted.append(no)
    check('履歴欄の枚数が実ファイル数と一致', not counted, str(counted[:3]))

    n_hist = sum(1 for _, (_, h) in xl.items() if h.startswith('evidence/'))
    check('エビデンスのある項目すべてに履歴欄の記入がある', n_hist == len(ev), f'{n_hist} / {len(ev)}')

    total = sum(len(v) for v in ev.values())
    print(f'\n{len(spec)}項目 ／ エビデンス {len(ev)}項目・{total}ファイル')
    if ng:
        print(f'!! 不一致 {len(ng)}件')
        return 1
    print('すべて一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
