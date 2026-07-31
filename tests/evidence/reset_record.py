#!/usr/bin/env python3
"""結合試験項目一覧.xlsx の実施記録を、次の試験ラウンドの初期状態に戻す。

  担当者（L列） … 指定した氏名に一括で揃える（既定: 大井 音和）
  日付（M列）   … 空にする
  結果（N列）   … 空にする

**履歴（O列）と備考（P列）は消さない。** 履歴にはエビデンスのファイル名、
備考には区分が入っていて、どちらも「これから確認する材料」だから。

使い方（リポジトリ直下で）:
  python3 tests/evidence/reset_record.py                 # ドライラン
  python3 tests/evidence/reset_record.py --apply
  python3 tests/evidence/reset_record.py --apply --name "山田 花子"
"""
import re, shutil, sys, zipfile

XLSX = 'docs/結合試験項目一覧.xlsx'
DRY = '--apply' not in sys.argv
NAME = '大井 音和'
if '--name' in sys.argv:
    NAME = sys.argv[sys.argv.index('--name') + 1]

zin = zipfile.ZipFile(XLSX)
sst_xml = zin.read('xl/sharedStrings.xml').decode('utf-8')
strings = [''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))
           for si in re.findall(r'<si>(.*?)</si>', sst_xml, re.S)]

added = []
if NAME in strings:
    name_id = strings.index(NAME)
else:
    name_id = len(strings)
    added.append(NAME)

CELL = re.compile(r'<c ([^>]*?)/>|<c ([^>]*?)>(.*?)</c>', re.S)


def value(attrs, body):
    t = re.search(r't="(\w+)"', attrs)
    v = re.search(r'<v>(.*?)</v>', body, re.S)
    if not v:
        return ''
    return strings[int(v.group(1))] if (t and t.group(1) == 's') else v.group(1)


def keep_style(attrs):
    """r と s だけ残す（書式は保つ、型と値は捨てる）"""
    return ' '.join(m.group(0) for m in re.finditer(r'(?:r|s)="[^"]*"', attrs))


sheets_out = {}
n_name, n_date, n_res, refs_delta = 0, 0, 0, 0
for n in range(1, 9):
    sheet = f'xl/worksheets/sheet{n}.xml'
    if sheet not in zin.namelist():
        continue
    xml = zin.read(sheet).decode('utf-8')
    edits = []
    for row in re.finditer(r'<row[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for m in CELL.finditer(row.group(1)):
            attrs = m.group(1) or m.group(2)
            ref = re.search(r'r="([A-Z]+)\d+"', attrs)
            if ref:
                cells[ref.group(1)] = (m, attrs, m.group(3) or '')
        no = '-'.join(value(a, b) for (_, a, b) in
                      (cells.get(k, (None, '', '')) for k in 'BCD'))
        if not re.fullmatch(r'\d+-\d+-\d+', no) or not value(*cells.get('E', (None, '', ''))[1:]):
            continue
        for col in 'LMN':
            if col not in cells:
                continue
            m, attrs, body = cells[col]
            before = value(attrs, body)
            had_ref = bool(re.search(r't="s"', attrs) and re.search(r'<v>', body))
            if col == 'L':
                if before == NAME:
                    continue
                new = f'<c {keep_style(attrs)} t="s"><v>{name_id}</v></c>'
                n_name += 1
                refs_delta += 0 if had_ref else 1
            else:
                if before == '':
                    continue
                new = f'<c {keep_style(attrs)}/>'
                n_date += col == 'M'
                n_res += col == 'N'
                refs_delta -= 1 if had_ref else 0
            edits.append((row.start(1) + m.start(), row.start(1) + m.end(), new))
    if edits:
        buf, pos = [], 0
        for s, e, t in sorted(edits):
            buf.append(xml[pos:s]); buf.append(t); pos = e
        buf.append(xml[pos:])
        sheets_out[sheet] = ''.join(buf)

print(f'担当者を「{NAME}」に揃える : {n_name} 行')
print(f'日付を空にする             : {n_date} 行')
print(f'結果を空にする             : {n_res} 行')
print('履歴（エビデンス）と備考（区分）は残す')
if DRY:
    print('\n(ドライラン。--apply で書き込み)')
    sys.exit(0)

sst_out = sst_xml
if added:
    sst_out = sst_out.replace('</sst>', ''.join(f'<si><t>{s}</t></si>' for s in added) + '</sst>')
    sst_out = re.sub(r'(<sst\b[^>]*?uniqueCount=")(\d+)(")',
                     lambda m: m.group(1) + str(int(m.group(2)) + len(added)) + m.group(3), sst_out, count=1)
sst_out = re.sub(r'(<sst\b[^>]*?count=")(\d+)(")',
                 lambda m: m.group(1) + str(int(m.group(2)) + refs_delta) + m.group(3), sst_out, count=1)

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
print(f'\n書き込み完了（元ファイルは .bak に退避）')
