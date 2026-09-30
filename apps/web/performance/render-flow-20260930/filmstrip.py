import base64, json, sys
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent/sys.argv[1]
trace=json.loads((root/'trace.json').read_text())['traceEvents']
anchor=next((e['ts'] for e in trace if e.get('name')=='flow.nativeCluster.beforeClick'), min(e['ts'] for e in trace if 'ts' in e))
frames=[e for e in trace if e.get('name')=='Screenshot' and e.get('args',{}).get('snapshot')]
output=root/'frames';output.mkdir()
rows=[]
for i,e in enumerate(frames):
 p=output/f'{i:03d}.jpg';p.write_bytes(base64.b64decode(e['args']['snapshot']))
 rows.append({'index':i,'relativeMs':(e['ts']-anchor)/1000,'path':f'frames/{p.name}'})
(root/'filmstrip.json').write_text(json.dumps({'scope':'CDP diagnostic filmstrip. Adaptive screenshots, no continuous video; trace instrumentation and mock SDK. Black gaps between captured frames are unobserved.','frames':rows,'gapsMs':[b['relativeMs']-a['relativeMs'] for a,b in zip(rows,rows[1:])]},indent=2)+'\n')
if rows:
 chosen=rows if len(rows)<=12 else [rows[round(i*(len(rows)-1)/11)] for i in range(12)]
 sheet=Image.new('RGB',(960,220*((len(chosen)+2)//3)),'#151515');draw=ImageDraw.Draw(sheet)
 for j,r in enumerate(chosen):
  img=Image.open(root/r['path']);img.thumbnail((316,192));x=(j%3)*320;y=(j//3)*220
  sheet.paste(img,(x,y+24));draw.text((x+4,y+5),f"{r['index']}  {r['relativeMs']:+.1f} ms",fill='white')
 sheet.save(root/'filmstrip.png')
 data=json.dumps(rows)
 html='<!doctype html><meta charset="utf-8"><title>Local diagnostic filmstrip</title><style>body{background:#181818;color:#eee;font:16px system-ui;margin:24px}img{max-width:95vw;max-height:75vh;display:block}input{width:80vw}p{max-width:950px}</style><h1>CDP diagnostic frames</h1><p>Adaptive screenshot capture with trace overhead and simulated map SDK. Intervals between frames are unobserved. No continuous-video or physical-display proof.</p><input id="range" type="range" min="0" max="'+str(max(0,len(rows)-1))+'" value="0"><p id="label"></p><img id="frame"><script>const frames='+data+';const range=document.getElementById("range");function show(){const r=frames[Number(range.value)];if(!r)return;document.getElementById("frame").src=r.path;document.getElementById("label").textContent=`Frame ${r.index} / ${frames.length-1}, ${r.relativeMs.toFixed(1)} ms from diagnostic mark`;}range.oninput=show;document.onkeydown=e=>{if(e.key==="ArrowRight")range.value=Number(range.value)+1;if(e.key==="ArrowLeft")range.value=Number(range.value)-1;show();};show();</script>'
 (root/'filmstrip.html').write_text(html)
print(json.dumps({'frames':len(rows),'output':str(root/'filmstrip.json')}))
