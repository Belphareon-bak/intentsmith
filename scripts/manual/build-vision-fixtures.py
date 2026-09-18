#!/usr/bin/env python3
"""Build committed synthetic VISION fixtures; Pillow is only a build dependency.

The model receives pixels + a question, never the manifest/oracle. No network,
private screenshots or stochastic drawing. Rebuild only when deliberately
versioning the suite. The manifest records renderer and font provenance.
"""
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[2] / 'src/eval/fixtures/vision'
ROOT.mkdir(parents=True, exist_ok=True)
FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
INK, BLUE, RED, GREEN = '#172538', '#2167c7', '#d62f36', '#23823b'
records = []


def canvas(title, size=(1000, 720)):
    im = Image.new('RGB', size, 'white')
    d = ImageDraw.Draw(im)
    if title:
        text(d, (32, 24), title, 28)
        d.line((32, 74, size[0]-32, 74), fill='#b6c3d2', width=2)
    return im, d


def text(d, xy, s, size=23, fill=INK):
    d.text(xy, str(s), font=ImageFont.truetype(str(FONT), size), fill=fill)


def line(d, a, b, fill=INK, width=3, arrow=False):
    d.line((a, b), fill=fill, width=width)
    if arrow:
        angle = math.atan2(b[1]-a[1], b[0]-a[0])
        points = [b] + [(b[0]-16*math.cos(angle+s), b[1]-16*math.sin(angle+s)) for s in (-.45, .45)]
        d.polygon(points, fill=fill)


def table(d, headers, rows, xs, y=140, row_height=60):
    for i, row in enumerate([headers] + rows):
        top = y + i*row_height
        d.rectangle((xs[0]-12, top, 965, top+row_height), fill='#dce7f4' if i == 0 else ('#f0f4f8' if i % 2 else 'white'))
        for x, value in zip(xs, row):
            text(d, (x, top+15), value, 21)
        d.line((xs[0]-12, top+row_height, 965, top+row_height), fill='#9daec2')


def save(im, name, label, difficulty, skill, question, expected, rules=None):
    path = ROOT / (name + '.png')
    im.save(path, optimize=False, compress_level=9)
    schema = {k: ('array of strings' if isinstance(v, list) else 'boolean' if isinstance(v, bool) else 'number' if isinstance(v, (int, float)) else 'string') for k, v in expected.items()}
    records.append(dict(name='vision_'+name, image=path.name, label=label, difficulty=difficulty,
                        skill=skill, question=question+' Return ONLY a JSON object with exactly these fields and types: '+json.dumps(schema)+'.',
                        expected=expected, rules=rules or {}, width=im.width, height=im.height,
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest()))


# Basic visual perception: three independent stimuli, no text revealing answers.
im = Image.new('RGB', (480, 360), RED)
save(im, 'color', 'Barva a jednolitost plochy', 'basic', 'color', 'Name the dominant color in English. Is the entire image uniform?', {'color':'red', 'uniform':True})
im, d = canvas('')
for x, y, color in [(140,150,RED),(430,190,GREEN),(700,125,BLUE),(240,420,RED),(670,460,RED)]:
    d.ellipse((x,y,x+100,y+100), fill=color)
save(im, 'count', 'Počet objektů podle barvy', 'basic', 'counting', 'Count all circles, red circles, and blue circles. List the distinct colors in English; order does not matter.', {'total':5,'red':3,'blue':1,'colors':['red','green','blue']}, {'colors':'set'})
im, d = canvas('')
d.ellipse((290,140,710,560), outline='black', width=42)
save(im, 'ring', 'Tvar, popředí a pozadí', 'basic', 'shape', 'Name the shape (choose ring, filled disk, triangle or square), foreground color and background color in English.', {'shape':'ring','foreground':'black','background':'white'}, {'shape':{'aliases':['circle','circular ring']}})

# Intermediate: spatial grounding, ordinal comparison, OCR and chart reading.
im, d = canvas('Object layout')
for label, x, y in [('A',130,160),('B',430,160),('C',730,160),('D',430,440)]:
    d.rounded_rectangle((x,y,x+120,y+100), 12, fill='#dce7f4', outline=BLUE, width=3)
    text(d,(x+44,y+30),label,32)
save(im,'spatial','Prostorové vztahy mezi objekty','intermediate','spatial','Which label is directly below B, which is directly left of B, and which is directly right of B?',{'below':'D','left':'A','right':'C'})
im, d = canvas('Compare visible rectangle areas')
for label,x,w,h in [('P',100,110,110),('Q',330,180,240),('R',670,220,160)]:
    d.rectangle((x,450-h,x+w,450),fill=BLUE)
    text(d,(x+35,480),label,30)
save(im,'area','Řazení objektů podle plochy','intermediate','size','List rectangle labels from smallest to largest visible area. Also name the largest.',{'order':['P','R','Q'],'largest':'Q'},{'order':'sequence'})
im, d = canvas('FAKTURA / INVOICE')
for i,s in enumerate(['Číslo: CZ-2026-0418','Dodavatel: Žlutý most s.r.o.','Datum vystavení: 18. 09. 2026','Datum splatnosti: 02. 10. 2026','Celkem k úhradě: 12 480,50 Kč','Variabilní symbol: 20260418']):
    text(d,(60,120+i*78),s,30)
save(im,'invoice','České OCR a rozlišení dat faktury','intermediate','ocr','Read invoice ID, supplier (preserve Czech accents), due date as YYYY-MM-DD, and total as a JSON number in CZK. Do not confuse issue date with due date.',{'id':'CZ-2026-0418','supplier':'Žlutý most s.r.o.','due':'2026-10-02','total':12480.5})
im, d = canvas('Dispatches by depot')
depots = [('A',60),('B',35),('C',80),('D',50)]
for value in range(0,101,20):
    y=590-value*4
    line(d,(100,y),(940,y),'#cdd7e3',1); text(d,(42,y-14),value,20)
for i,(label,value) in enumerate(depots):
    x=170+i*190; d.rectangle((x,590-value*4,x+100,590),fill=BLUE); text(d,(x+35,620),label)
save(im,'bars','Odečtení a porovnání hodnot grafu','intermediate','chart','Read values for B and C, name the highest depot, and compute C minus B. Read the vertical axis.',{'b':35,'c':80,'highest':'C','difference':45})

# Hard: cross-row constraints, multiple series, graph paths, UI inconsistency,
# and document reconciliation. All expected answers derive from pictured data.
im, d = canvas('Orders / prices in EUR / shipping excluded')
rows=[('A17','East',3,12,'paid'),('B28','West',5,8,'paid'),('C39','East',4,15,'unpaid'),('D40','East',2,25,'paid'),('E51','West',6,9,'unpaid'),('F62','East',5,7,'paid')]
table(d,['Order','Region','Qty','Unit EUR','Status'],rows,[45,230,410,570,780])
eligible=[r for r in rows if r[1]=='East' and r[4]=='paid']
save(im,'orders','Filtrování tabulky a vážený součet','hard','table','Select only paid orders in East. Return their IDs (any order), sum of quantities, and total price (quantity times unit price, summed). Exclude every unpaid order.',{'ids':[r[0] for r in eligible],'quantity':sum(r[2] for r in eligible),'total':sum(r[2]*r[3] for r in eligible)},{'ids':'set'})
im, d = canvas('Weekly load (units)')
series={'Blue':[20,50,40,80,60], 'Red':[60,30,50,40,70]}
for value in range(0,101,20):
    y=580-value*4; line(d,(110,y),(920,y),'#cdd7e3',1); text(d,(50,y-14),value,20)
for label,color in [('Blue',BLUE),('Red',RED)]:
    points=[(150+i*175,580-v*4) for i,v in enumerate(series[label])]
    d.line(points,fill=color,width=5)
    for x,y in points: d.ellipse((x-7,y-7,x+7,y+7),fill=color)
for i in range(5): text(d,(130+i*175,610),'W'+str(i+1))
text(d,(400,95),'Blue',24,BLUE); text(d,(570,95),'Red',24,RED)
save(im,'lines','Více řad grafu a podmíněné porovnání','hard','multi_series','Use values at weekly markers (not interpolated crossings). List weeks when Blue is strictly above Red, give the week of the largest absolute gap and its size, and the Blue value at W3.',{'weeks':['W2','W4'],'largest_gap_week':'W1','gap':40,'blue_w3':40},{'weeks':'set'})
# W1 and W4 tie at 40: make the question explicitly request earliest week.
records[-1]['question']=records[-1]['question'].replace('the week of the largest absolute gap','the earliest week of the largest absolute gap')
im, d = canvas('Directed routes / each edge has a cost')
nodes={'S':(100,360),'A':(370,180),'B':(370,540),'C':(650,180),'T':(890,360)}
edges=[('S','A',4),('S','B',2),('A','C',3),('B','C',2),('B','T',9),('C','T',1)]
for a,b,cost in edges:
    start,end=nodes[a],nodes[b]; dx,dy=end[0]-start[0],end[1]-start[1]; length=math.hypot(dx,dy)
    p=(start[0]+40*dx/length,start[1]+40*dy/length); q=(end[0]-40*dx/length,end[1]-40*dy/length)
    line(d,p,q,arrow=True); mx,my=(p[0]+q[0])/2,(p[1]+q[1])/2
    d.rectangle((mx-17,my-21,mx+20,my+20),fill='white'); text(d,(mx-10,my-18),cost,28)
for label,(x,y) in nodes.items():
    d.ellipse((x-38,y-38,x+38,y+38),fill='#dce7f4',outline=BLUE,width=3); text(d,(x-12,y-19),label,28)
save(im,'routes','Směrový diagram a nejlevnější cesta','hard','diagram','Find the minimum total cost path from S to T, respecting arrow directions. Return the ordered node labels, total cost, and number of edges on that path.',{'path':['S','B','C','T'],'cost':5,'edges':3},{'path':'sequence'})
im, d = canvas('Synthetic service dashboard — diagnostic fixture')
d.rectangle((28,100,970,174),fill='#dce7f4'); text(d,(45,120),'Filter: environment = prod     Header: 4 healthy',25)
services=[('api','prod','healthy'),('worker','prod','degraded'),('billing','stage','healthy'),('search','prod','healthy'),('cache','prod','healthy')]
table(d,['Service','Environment','Status'],services,[50,380,700],y=210)
save(im,'dashboard','Chyby ve filtrovaném přehledu služeb','hard','ui_diagnostics','The filter should show prod services only. Identify all displayed rows that violate the filter. Among prod rows, count healthy services, name the non-healthy service, and compute how much the header healthy count overstates the correct prod count.',{'wrong_rows':['billing'],'healthy_prod':3,'non_healthy':'worker','overstatement':1},{'wrong_rows':'set'})
im,d=canvas('Invoice reconciliation / all amounts EUR / no rounding needed')
items=[('Cable',4,15,60),('Adapter',3,20,80),('Stand',2,35,70)]
table(d,['Item','Qty','Unit EUR','Printed total'],items,[45,340,520,730])
for i,s in enumerate(['Printed subtotal: 210.00','Discount: 10% of corrected subtotal','Tax: 20% after discount','Printed final total: 226.80']): text(d,(60,430+i*56),s,25)
subtotal=sum(r[1]*r[2] for r in items)
save(im,'reconciliation','Kontrola dokladu včetně slevy a daně','hard','document_reasoning','Find line items whose printed total differs from quantity times unit price. Correct the subtotal, apply the stated discount, then tax. Return incorrect item names (any order), corrected subtotal, corrected final total and printed final total minus corrected final total.',{'incorrect':['Adapter'],'subtotal':subtotal,'final':round(subtotal*.9*1.2,2),'overcharge':round(226.8-subtotal*.9*1.2,2)},{'incorrect':'set'})

manifest={'version':'vision-synthetic.3','provenance':{'kind':'synthetic','generator':'scripts/manual/build-vision-fixtures.py','pillow':pillow_version,'fontSha256':hashlib.sha256(FONT.read_bytes()).hexdigest()},'tasks':records}
(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'Wrote {len(records)} unique image tasks to {ROOT}')
