#!/usr/bin/env python3
"""結合試験項目一覧.xlsx の履歴欄（O列）に、その項目のエビデンスを書き込む。
ファイル名の先頭が項目番号なので、番号だけで Excel ↔ evidence/ を往復できる。"""
import collections, json, os, re, shutil, sys, zipfile

XLSX = 'docs/結合試験項目一覧.xlsx'
EV = 'evidence'
DATE = '20260731'
ITEMS = sys.argv[1]
DRY = '--apply' not in sys.argv

items = {i['no']: i for i in json.load(open(ITEMS, encoding='utf-8'))}

shots = collections.defaultdict(list)
other = collections.defaultdict(list)
for f in sorted(os.listdir(EV)):
    m = re.match(r'^(\d+-\d+-\d+)_' + DATE + r'_(.+)$', f)
    if not m:
        continue
    (shots if f.endswith('.png') else other)[m.group(1)].append(f)


def note(no):
    """履歴欄に入れる文字列。連番はまとめて短く書く。"""
    # 複数枚はワイルドカードで書く。「〜」で範囲を書くとファイル名として解決できないため。
    parts = []
    ps = shots.get(no, [])
    if len(ps) == 1:
        parts.append(f'evidence/{ps[0]}')
    elif ps:
        parts.append(f'evidence/{no}_{DATE}_*.png（{len(ps)}枚）')
    for f in other.get(no, []):
        parts.append(f'evidence/{f}')
    return '／'.join(parts)


zin = zipfile.ZipFile(XLSX)
sst_xml = zin.read('xl/sharedStrings.xml').decode('utf-8')
strings = [''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))
           for si in re.findall(r'<si>(.*?)</si>', sst_xml, re.S)]
index = {s: n for n, s in enumerate(strings)}
added = []


def sid(text):
    if text in index:
        return index[text]
    index[text] = len(strings) + len(added)
    added.append(text)
    return index[text]


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


CELL = re.compile(r'<c ([^>]*?)/>|<c ([^>]*?)>(.*?)</c>', re.S)


def text_of(attrs, body):
    t = re.search(r't="(\w+)"', attrs)
    v = re.search(r'<v>(.*?)</v>', body, re.S)
    if not v:
        return ''
    return strings[int(v.group(1))] if (t and t.group(1) == 's') else v.group(1)


sheets_out, written, skipped, refs_added = {}, 0, [], 0
for n in range(1, 9):
    name = f'xl/worksheets/sheet{n}.xml'
    xml = zin.read(name).decode('utf-8')
    edits = []
    for row in re.finditer(r'<row[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for c in CELL.finditer(row.group(1)):
            attrs = c.group(1) or c.group(2)
            ref = re.search(r'r="([A-Z]+)(\d+)"', attrs)
            if ref:
                cells[ref.group(1)] = (c, attrs, c.group(3) or '')
        key = '-'.join(text_of(a, b) for (_, a, b) in
                       (cells.get(col, (None, '', '')) for col in 'BCD'))
        if key not in items or 'O' not in cells:
            continue
        txt = note(key)
        if not txt:
            skipped.append(key)
            continue
        c, attrs, body = cells['O']
        if text_of(attrs, body) == txt:
            continue
        was_empty = not re.search(r'<v>', body)
        clean = re.sub(r'\s*t="\w+"', '', attrs).rstrip().rstrip('/').rstrip()
        edits.append((row.start(1) + c.start(), row.start(1) + c.end(),
                      f'<c {clean} t="s"><v>{sid(txt)}</v></c>'))
        written += 1
        refs_added += 1 if was_empty else 0
    if edits:
        buf, pos = [], 0
        for s, e2, t in sorted(edits):
            buf.append(xml[pos:s]); buf.append(t); pos = e2
        buf.append(xml[pos:])
        sheets_out[name] = ''.join(buf)

print(f'エビデンスのある項目: {len(set(shots) | set(other))}')
print(f'履歴欄に書き込む行  : {written}')
print(f'エビデンス無しで据置 : {len(skipped)}（区分が「自動」「手動」の行）')
if DRY:
    print('\n例:')
    for k in ['3-3-1', '1-4-2', '3-6-2', '7-1-1']:
        print(f'  {k}: {note(k)}')
    print('\n(ドライラン。--apply で書き込み)')
    sys.exit(0)

sst_out = sst_xml
if added:
    sst_out = sst_out.replace('</sst>', ''.join(f'<si><t>{esc(s)}</t></si>' for s in added) + '</sst>')
    sst_out = re.sub(r'(<sst\b[^>]*?uniqueCount=")(\d+)(")',
                     lambda m: m.group(1) + str(int(m.group(2)) + len(added)) + m.group(3), sst_out, count=1)
    # 空セルに新しく文字列参照が入った分だけ、参照の総数 count も増える
    sst_out = re.sub(r'(<sst\b[^>]*?count=")(\d+)(")',
                     lambda m: m.group(1) + str(int(m.group(2)) + refs_added) + m.group(3), sst_out, count=1)

shutil.copy2(XLSX, XLSX + '.bak')
with zipfile.ZipFile(XLSX + '.tmp', 'w', zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename == 'xl/sharedStrings.xml':
            data = sst_out.encode('utf-8')
        elif info.filename in sheets_out:
            data = sheets_out[info.filename].encode('utf-8')
        zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        zi.compress_type = info.compress_type
        zi.external_attr = info.external_attr
        zout.writestr(zi, data)
shutil.move(XLSX + '.tmp', XLSX)
print(f'\n書き込み完了（共有文字列 +{len(added)}、参照 +{refs_added}）')
