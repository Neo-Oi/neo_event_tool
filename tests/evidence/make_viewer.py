#!/usr/bin/env python3
"""evidence/index.html を作る。項目ごとに手順・期待動作とスクリーンショットを並べ、
見比べられるようにする。画像は相対パス参照なので、ローカルHTTPサーバから開く。"""
import json, os, re, sys, collections, html

ITEMS = sys.argv[1]
EV = '/home/neo-oi/neo_event_tool/evidence'
DATE = '20260731'

items = json.load(open(ITEMS, encoding='utf-8'))
files = collections.defaultdict(list)
for f in sorted(os.listdir(EV)):
    m = re.match(r'^(\d+-\d+-\d+)_' + DATE + r'_(.+)$', f)
    if m:
        files[m.group(1)].append(f)

targets = items
groups = collections.OrderedDict()
for i in targets:
    groups.setdefault(i['no'].split('-')[0], []).append(i)

SECTION = {'1': 'ダッシュボード', '2': 'イベント一覧・作成', '3': 'イベント詳細',
           '4': '参加者ビュー', '5': '名簿・設定', '6': '共通', '7': '通しシナリオ'}
e = html.escape

out = ['''<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>結合試験エビデンス 2026-07-31</title>
<style>
:root{--ink:#20272e;--accent:#194bf4;--line:#dee5ed;--bg:#f5f7fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;line-height:1.6}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:14px 24px}
h1{font-size:18px;margin:0}
.sub{font-size:13px;color:#5b6572;margin-top:2px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
nav a{font-size:13px;text-decoration:none;color:var(--accent);border:1px solid var(--line);
  border-radius:999px;padding:3px 11px;background:#fff}
.find{display:flex;gap:8px;align-items:center;margin-top:10px}
.find input{font:inherit;font-size:14px;padding:6px 11px;border:1px solid var(--line);
  border-radius:6px;width:280px}
.find .hit{font-size:12px;color:#5b6572}
.item:target{outline:2px solid var(--accent);outline-offset:3px}
.no a{color:inherit;text-decoration:none}
.no a:hover{text-decoration:underline}
main{padding:24px;max-width:1400px;margin:0 auto}
h2{font-size:16px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--accent)}
.item{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:14px}
.hd{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.no{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.ttl{font-weight:600}
.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:#5b6572}
.tag.k-a{background:#eef4ff;border-color:#c7d9ff;color:#194bf4}
.tag.k-am{background:#eafaf1;border-color:#bfe8d2;color:#137a4a}
.tag.k-m{background:#fff4e8;border-color:#ffd9ae;color:#a55b00}
.item.none{opacity:.72}
dl{display:grid;grid-template-columns:5.5em 1fr;gap:2px 10px;margin:10px 0 0;font-size:13px}
dt{color:#5b6572}
dd{margin:0}
.shots{display:flex;gap:10px;overflow-x:auto;margin-top:12px;padding-bottom:6px}
.shot{flex:0 0 auto;width:260px}
.shot img{width:100%;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:zoom-in;display:block}
.shot.vid{width:360px}
.shot video{width:100%;border:1px solid var(--line);border-radius:6px;background:#000;display:block}
.shot .cap{font-size:11px;color:#5b6572;margin-top:4px;word-break:break-all}
.file{display:inline-block;font-size:12px;background:#eef2f8;border-radius:6px;padding:6px 10px;
  margin-top:10px;text-decoration:none;color:var(--ink)}
dialog{border:0;padding:0;background:transparent;max-width:96vw;max-height:96vh}
dialog::backdrop{background:rgba(16,22,30,.82)}
dialog img{max-width:96vw;max-height:92vh;display:block;border-radius:6px;background:#fff}
dialog .cap{color:#fff;font-size:12px;text-align:center;padding:8px}
</style></head><body>
<header>
  <h1>結合試験エビデンス</h1>
  <div class="sub">2026年7月31日取得　／　全 ''' + str(len(targets)) + ''' 項目（撮影済み ''' + str(len(files)) + '''）　／　画像をクリックすると拡大します</div>
  <nav>''' + ''.join(f'<a href="#s{k}">{k}. {e(SECTION[k])}</a>' for k in groups) + '''</nav>
  <div class="find">
    <input id="q" type="search" placeholder="項目番号で絞り込み（例: 3-3 / 4-5-2）" autocomplete="off">
    <span class="hit" id="hit"></span>
  </div>
</header><main>''']

for k, its in groups.items():
    out.append(f'<h2 id="s{k}">{k}. {e(SECTION[k])}（{len(its)}項目）</h2>')
    for i in its:
        fs = files.get(i['no'], [])
        pngs = [f for f in fs if f.endswith('.png')]
        vids = [f for f in fs if f.endswith(('.mp4', '.webm', '.mov'))]
        others = [f for f in fs if f not in pngs and f not in vids]
        out.append(f'<section class="item{"" if fs else " none"}" id="{e(i["no"])}" data-no="{e(i["no"])}">')
        out.append(f'<div class="hd"><span class="no"><a href="#{e(i["no"])}">{e(i["no"])}</a></span>'
                   f'<span class="ttl">{e(i["大"])}／{e(i["中"])}／{e(i["小"])}</span>'
                   f'<span class="tag k-{"a" if i["区分"]=="自動" else "m" if i["区分"]=="手動" else "am"}">{e(i["区分"])}</span>'
                   f'<span class="tag">{e(i["観点"])}</span><span class="tag">{e(i["IF"])}</span>'
                   f'<span class="tag">{("、".join(filter(None, [f"{len(pngs)}枚" if pngs else "", f"動画{len(vids)}本" if vids else ""])) or "エビデンス未取得")}</span></div>')
        out.append('<dl>'
                   f'<dt>手順</dt><dd>{e(i["手順"])}</dd>'
                   + (f'<dt>条件</dt><dd>{e(i["条件"])}</dd>' if i['条件'] not in ('', '—') else '')
                   + f'<dt>期待動作</dt><dd>{e(i["期待"])}</dd></dl>')
        if pngs:
            out.append('<div class="shots">')
            for n, f in enumerate(pngs, 1):
                out.append(f'<figure class="shot"><img loading="lazy" src="{e(f)}" alt="{e(i["no"])} の{n}枚目" '
                           f'data-cap="{e(f)}"><figcaption class="cap">{n}. {e(f)}</figcaption></figure>')
            out.append('</div>')
        if vids:
            out.append('<div class="shots">')
            for f in vids:
                out.append(f'<figure class="shot vid"><video src="{e(f)}" controls preload="metadata"></video>'
                           f'<figcaption class="cap">▶ {e(f)}</figcaption></figure>')
            out.append('</div>')
        for f in others:
            out.append(f'<a class="file" href="{e(f)}" download>⤓ {e(f)}</a> ')
        out.append('</section>')

out.append('''</main>
<dialog id="zoom"><img alt=""><div class="cap"></div></dialog>
<script>
const dlg = document.getElementById('zoom');
document.addEventListener('click', ev => {
  const img = ev.target.closest('.shot img');
  if (img) { dlg.querySelector('img').src = img.src;
             dlg.querySelector('.cap').textContent = img.dataset.cap; dlg.showModal(); return; }
  if (ev.target === dlg || ev.target.closest('dialog')) dlg.close();
});

// 番号で絞り込む。「3-3」のような前方一致でも引ける。
const q = document.getElementById('q'), hit = document.getElementById('hit');
const secs = [...document.querySelectorAll('.item')];
q.addEventListener('input', () => {
  const v = q.value.trim();
  let n = 0;
  for (const s of secs) {
    const on = !v || s.dataset.no.startsWith(v) || s.textContent.includes(v);
    s.hidden = !on; if (on) n++;
  }
  for (const h of document.querySelectorAll('main h2')) {
    let el = h.nextElementSibling, any = false;
    while (el && el.tagName === 'SECTION') { if (!el.hidden) any = true; el = el.nextElementSibling; }
    h.hidden = !any;
  }
  hit.textContent = v ? `${n} 項目` : '';
});
</script></body></html>''')

open(os.path.join(EV, 'index.html'), 'w', encoding='utf-8').write('\n'.join(out))
print(f'evidence/index.html を作成（{len(targets)}項目 / {sum(len(v) for v in files.values())}ファイル）')
