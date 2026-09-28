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
        title_size = 28
        while d.textlength(title, font=ImageFont.truetype(str(FONT), title_size)) > size[0]-64 and title_size > 15:
            title_size -= 1
        text(d, (32, 24), title, title_size)
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

# Revision 4 adds cross-panel, mixed-unit, temporal and uncertainty cases.
# Values are derived below; never fed to the model except as pixels.
im,d=canvas('Warehouse / one row = one movement / repeated key = retry')
rows=[('key','SKU','change','status'),('a','K1','+17','posted'),('b','K1','-9','posted'),('a','K1','+17','retry'),('c','K2','+25','posted'),('d','K1','-6','void'),('e','K2','-8','posted')]
table(d,rows[0],rows[1:],[45,250,455,700],row_height=53)
text(d,(45,590),'Opening: K1 = 32; K2 = 11. Reserved: K1 = 5; K2 = 7.',22)
save(im,'stock_ledger','Pohyby skladu, duplicity a rezervace','hard','event_reconciliation','Apply posted movements only, once per key. Reservations reduce available stock, not physical stock. Return k1_physical, k2_physical, total_available.',{'k1_physical':40,'k2_physical':28,'total_available':56})
im,d=canvas('Comparison of conversion rates / counts, not percentages')
rows=[('A','mobile',18,60),('A','desktop',72,90),('B','mobile',45,150),('B','desktop',48,60)]
table(d,['Variant','Channel','Successes','Trials'],rows,[45,245,490,760],row_height=70)
text(d,(45,570),'Aggregate every trial; do not average the two channel rates.',22)
save(im,'weighted_rates','Vážené sazby a zavádějící průměr','hard','statistical_chart','Compute total trials and pooled success percentage for A and B, rounding percentages to 2 decimal places. Return trials_a, trials_b, percent_a, percent_b, higher (A or B). Do not infer causation.',{'trials_a':150,'trials_b':210,'percent_a':60,'percent_b':44.29,'higher':'A'})
im,d=canvas('Release dependencies / duration in hours / arrows are prerequisites')
# Non-geometric schedule: durations explicit, multiple joins.
nodes={'A':(130,210),'B':(390,155),'C':(390,425),'D':(670,210),'E':(865,425)}
for a,b in [('A','B'),('A','C'),('B','D'),('C','D'),('C','E'),('D','E')]:
 x,y=nodes[a];u,v=nodes[b];dx,dy=u-x,v-y
 k=min(70/abs(dx) if dx else 999,50/abs(dy) if dy else 999)
 line(d,(x+k*dx,y+k*dy),(u-k*dx,v-k*dy),fill='#738294',arrow=True)
for (label,(x,y)),dur in zip(nodes.items(),[2,5,3,4,1]):
 d.rounded_rectangle((x-58,y-30,x+58,y+38),8,fill='white',outline=BLUE,width=3);text(d,(x-45,y-14),f'{label}: {dur} h',23)
text(d,(45,580),'Unlimited workers. All predecessors must finish. Start A at 0.',22)
save(im,'critical_path','Závislosti úloh, souběh a kritická cesta','hard','diagram_schedule','Return finish_e (hours from start), slack_c (maximum delay in C start without delaying E), critical_path (ordered labels).',{'finish_e':12,'slack_c':2,'critical_path':['A','B','D','E']},{'critical_path':'sequence'})
im,d=canvas('Supplier ledger / amounts after tax / credit notes negative')
rows=[('INV-71','EUR','125.50','invoice'),('CN-09','EUR','25.50','credit'),('INV-72','CZK','2500.00','invoice'),('INV-73','EUR','40.00','cancelled'),('INV-74','USD','20.00','invoice')]
table(d,['ID','Currency','Amount','Kind'],rows,[45,290,475,720],row_height=62)
text(d,(45,580),'Fixed rates: 1 EUR = 25 CZK; 1 USD = 23 CZK.',22)
save(im,'mixed_currency','Měny, dobropisy a storna','hard','document_join','Exclude cancelled rows, subtract credit notes, convert using the shown rates. Return net_czk, included_ids (any order), credit_czk (positive magnitude).',{'net_czk':5460,'included_ids':['INV-71','CN-09','INV-72','INV-74'],'credit_czk':637.5},{'included_ids':'set'})
im,d=canvas('Access review / rule: active AND (owner OR admin) AND NOT suspended')
rows=[('A','no','yes','no','no'),('B','yes','no','yes','yes'),('C','yes','no','no','no'),('D','yes','yes','no','no'),('E','yes','no','yes','no'),('F','no','no','yes','no')]
table(d,['ID','Active','Owner','Admin','Suspended'],rows,[45,220,410,600,770],row_height=61)
save(im,'access_matrix','Čtení matice a složená podmínka','hard','matrix_logic','Use only the rule in the image. Return allowed_ids (any order), denied_count, suspended_ids (any order).',{'allowed_ids':['D','E'],'denied_count':4,'suspended_ids':['B']},{'allowed_ids':'set','suspended_ids':'set'})
im,d=canvas('Train connections / all times same day / minimum transfer 12 minutes')
rows=[('T1','A','B','08:00','08:41'),('T2','B','C','08:50','09:10'),('T3','B','C','08:55','09:25'),('T4','A','C','08:10','09:35'),('T5','B','C','09:00','09:15')]
table(d,['Train','From','To','Departs','Arrives'],rows,[45,250,430,590,780],row_height=68)
save(im,'connections','Časové návaznosti a minimální přestup','hard','timetable','You can depart A at 08:00 or later. Find the earliest arrival at C with valid transfers. Return trains (ordered), arrival, transfer_minutes (0 for a direct train).',{'trains':['T1','T5'],'arrival':'09:15','transfer_minutes':19},{'trains':'sequence'})
im,d=canvas('Metrics / windows are different; do not add rates')
rows=[('api','15','3','300'),('worker','60','12','240'),('cache','30','0','180'),('billing','15','6','60')]
table(d,['Service','Window min','Errors','Requests'],rows,[45,285,555,760],row_height=73)
text(d,(45,550),'Alert if error percentage > 4% AND errors per minute >= 0.2.',23)
save(im,'windowed_metrics','Různá časová okna a kombinovaný alert','hard','metrics','Apply both thresholds, strictly greater where specified. Return alert_services (any order), api_error_percent, billing_errors_per_minute, worker_error_percent.',{'alert_services':['worker','billing'],'api_error_percent':1,'billing_errors_per_minute':.4,'worker_error_percent':5},{'alert_services':'set'})
im,d=canvas('Document versions / larger revision wins; CANCELLED removes an item')
rows=[('P-8','1','20','active'),('Q-2','4','15','active'),('P-8','3','12','active'),('R-5','2','7','active'),('Q-2','6','0','CANCELLED'),('R-5','1','18','active')]
table(d,['Item','Revision','Units','State'],rows,[45,300,540,750],row_height=58)
save(im,'revision_join','Výběr poslední revize a odstraněné položky','hard','versioned_table','For each item use only its greatest revision; exclude cancelled items. Return active_ids (any order), total_units, p8_units, removed_ids (any order).',{'active_ids':['P-8','R-5'],'total_units':19,'p8_units':12,'removed_ids':['Q-2']},{'active_ids':'set','removed_ids':'set'})
im,d=canvas('Transaction detail / sensitive field deliberately redacted')
for i,s in enumerate(['ID: PAY-204','Status: settled','Gross: 1 248.50 EUR','Fee: 12.50 EUR','Account number:']):text(d,(65,115+i*83),s,28)
d.rectangle((345,442,850,494),fill='black');text(d,(65,575),'Visible: currency EUR; destination name not shown.',24)
save(im,'redacted_document','Čitelné údaje a zákaz domýšlení skrytých','hard','uncertainty','Return id, net (gross minus fee), account_visible boolean and account_number as the literal string UNKNOWN if redacted. Do not infer hidden digits.',{'id':'PAY-204','net':1236,'account_visible':False,'account_number':'UNKNOWN'})
im,d=canvas('Deployment status / two independent panels')
text(d,(55,110),'Requested versions',27);text(d,(550,110),'Observed versions',27)
left=[('api','v4'),('worker','v7'),('billing','v3'),('cache','v2')];right=[('cache','v2'),('billing','v2'),('api','v4'),('worker','unknown')]
for i,((a,b),(c,e)) in enumerate(zip(left,right)):
 y=190+i*85;d.rectangle((45,y,460,y+62),outline=BLUE,width=2);text(d,(65,y+15),f'{a}: {b}',27);d.rectangle((530,y,950,y+62),outline=RED,width=2);text(d,(550,y+15),f'{c}: {e}',27)
save(im,'deployment_join','Spojení panelů podle identity, nesoulad a neověřený stav','hard','ui_diagnostics','Join by service name, not row position. Separate verified matches, verified mismatches and unknown observations. Return matches, mismatches, unknown as arrays of service names (any order).',{'matches':['api','cache'],'mismatches':['billing'],'unknown':['worker']},{'matches':'set','mismatches':'set','unknown':'set'})

manifest={'version':'vision-synthetic.4','provenance':{'kind':'synthetic','generator':'scripts/manual/build-vision-fixtures.py','pillow':pillow_version,'fontSha256':hashlib.sha256(FONT.read_bytes()).hexdigest()},'tasks':records}
(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'Wrote {len(records)} unique image tasks to {ROOT}')
