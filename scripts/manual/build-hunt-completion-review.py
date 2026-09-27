#!/usr/bin/env python3
"""Consolidate existing evidence for review. Never invent or import model grades."""
import argparse
import hashlib
import html
import json
import os
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
E = Path('/mnt/vi7000/intentsmith/evidence')
ROLES = ['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']
SOURCES = {}

def read(path):
    path = Path(path)
    raw = path.read_bytes()
    SOURCES[str(path)] = hashlib.sha256(raw).hexdigest()
    return json.loads(raw)

def mean(values):
    values = list(values)
    return sum(values) / len(values) if values else None

def grades(review):
    if 'grades' in review:
        return {i: [x['score'] for x in r['criteria']] for i, r in review['grades'].items()}
    return {r['id']: r['ratings'] for r in review['cases']}

def write(out, name, data):
    path = out / name
    with path.open('x') as f:
        if isinstance(data, str):
            f.write(data)
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    path.chmod(0o600)

def validate(packet, *reviews):
    args = ['node', 'scripts/verify-hunt-blind-review.mjs', '--packet', str(packet)]
    for r in reviews:
        args += ['--review', str(r)]
    return json.loads(subprocess.check_output(args, cwd=ROOT, text=True))

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--simulation', required=True, type=Path)
    a = p.parse_args()
    if not a.out.is_absolute() or not a.simulation.is_absolute():
        raise ValueError('Absolute paths required')
    a.out.mkdir(mode=0o700)
    simulation = read(a.simulation / 'simulation.json')
    assert simulation['status'] == 'SIMULATION_PASS_NOT_PRODUCTION_GO'
    snapshot = read(ROOT / 'docs/review/evidence/2026-09-25-hunt-step3-readiness.json')
    campaign = read(ROOT / 'docs/review/evidence/2026-09-25-hunt-isolated-campaign.json')
    old_packet_path = E / 'hunt-isolated-20260925/blind/packet.json'
    old_review_path = E / 'hunt-grading-opus-20260925/dr-312/review.json'
    old_packet, old_review = read(old_packet_path), read(old_review_path)
    old_key = read(E / 'hunt-isolated-20260925/restricted/blind-review-identity-key.json')
    assert old_key['packetSha256'] == SOURCES[str(old_packet_path)]
    validation = {'dr312': validate(old_packet_path, old_review_path)}
    old_identity = {x['id']: x for x in old_key['key']}
    old_grades = grades(old_review)
    historical = defaultdict(list)
    for case in old_packet['cases']:
        assert hashlib.sha256(case['response'].encode()).hexdigest() == old_identity[case['id']]['answerSha256']
        ratings = old_grades[case['id']]
        assert all(x is not None for x in ratings)
        historical[(old_identity[case['id']]['model'], case['role'])].append(mean(ratings))
    observation_rows = []
    for (model, role), values in historical.items():
        observation_rows.append(dict(model=model, role=role, cohort='DR312 / 25. 9. / .1', percent=mean(values)*100,
            evaluator='Opus, jeden vývojový posudek', responses=len(values), taskCount=8,
            accepted=False, meaning='Historická osmiúlohová sada; novější opravy jedné úlohy se sem nepřimíchávají.'))
    code = read(E / 'hunt-code-capture-20260925/technical-replay.json')
    for row in code['summaries']:
        observation_rows.append(dict(model=row['model'], role='CODE', cohort='CODE technická komponenta / 25. 9. / .1',
            percent=row['technicalMean']*100, evaluator='Spuštěné technické kontroly', responses=row['attempts'],
            taskCount=len(row['tasks']), accepted=False, meaning='Jen spustitelná komponenta; úplná známka CODE chybí.'))
    for row in campaign['selected']:
        if row['role'] == 'VISION':
            observation_rows.append(dict(model=row['model'], role='VISION', cohort='VISION / 25. 9. / .1',
                percent=row['score']*100, evaluator='Deterministické porovnání', responses=row['responses'], taskCount=row['taskCount'],
                accepted=False, meaning='69 záznamů = 23 různých odpovědí; tři shodná opakování nejsou další pozorování.'))
    packets, reviews, keys, comparisons = {}, {}, {}, {}
    for kind, folder, packet_folder in [
        ('dr','hunt-model-cleanup-v6-20260926','review-v3'),
        ('chat','hunt-chat-prod-sameday-20260926','review-pair')]:
        path = E / folder / packet_folder / 'packet.json'
        first = E / 'hunt-step3-codex-grading-20260926' / ('dr-review.json' if kind == 'dr' else 'chat-full-review.json')
        second = E / 'hunt-step3-second-grader-20260926' / kind / 'review.json'
        packets[kind] = read(path)
        reviews[kind] = [read(first),read(second)]
        keys[kind] = read(E / folder / packet_folder / 'restricted/identity-key.json')
        assert keys[kind]['packetSha256'] == SOURCES[str(path)]
        comparisons[kind] = validate(path,first,second)
        validation[kind] = comparisons[kind]
    audit = read(E / 'hunt-step3-comparison-20260926/chat-context-audit.json')
    affected = {x['caseId'] for x in audit['cases'] if any(t['missingPriorUserTurns'] for t in x['turns'])}
    for kind in ('dr','chat'):
        identity = {x['id']: x for x in keys[kind]['cases']}
        for index, review in enumerate(reviews[kind]):
            by_group = defaultdict(list)
            g = grades(review)
            for case in packets[kind]['cases']:
                by_group[(identity[case['id']]['model'],case['role'])].append((case,mean(g[case['id']])))
            for (model, role), values in by_group.items():
                observation_rows.append(dict(model=model,role=role,cohort='cleanup v6 / .1' if kind=='dr' else 'CHAT produkční / 26. 9. / .2',
                    percent=mean(v for _,v in values)*100,evaluator=['Codex','Opus'][index],responses=len(values),
                    taskCount=len({c['task'] for c,_ in values}),affectedContext=sum(c['id'] in affected for c,_ in values),
                    accepted=False,meaning='Jediná úloha, nikoli známka role.' if kind=='dr' else
                    'NEPOUŽÍT PRO POŘADÍ: audit prokázal neúplný vstup u části dialogů. Známka popisuje viděnou odpověď, ne schopnost s úplnou historií.'))
    # A new, openly exposed adjudication proposal; original reviews are immutable.
    proposed = [
        ('64616cac368d3ec571fb4e90',2,.50,'medium',
         'Obě varianty mění místo stejné deduplikace. Varianta B ponechá vadný veřejný návrhový seznam; bezpečnost mazání je řešena až dodatečně. Za tradeoff náleží částečný kredit, nikoli 85 %.',
         'Keep `getUnusedOldModels` as is.'),
        ('2b72edc92541775b5e2545b1',1,.75,'medium',
         'Správně popisuje NULL kanonického klíče, průchod filtrem i opakované DELETE. Výslovně nachází chybějící digest. Nedokládá ale celý závod ochrany při mazání a plete kanonické jméno s artefaktem. Proto mezi původními známkami, bez další penalizace téže vady v testech.',
         'It does **not** verify the digest before deletion.'),
        ('2b72edc92541775b5e2545b1',2,.50,'medium',
         'Porovnání zdroj versus caller má tradeoff, ale dvě umístění deduplikace sama neřeší různé bezpečné rozsahy. Návrh spoléhat na aktivní vazby bez doložení rollbacku není úplná bezpečná varianta.',
         'The repair must assume "active" covers the protection scope'),
        ('f6335121a6499aa0ea3737a1',2,.50,'medium',
         'Navržený getter správně odstraňuje prázdná jména a kanonické duplicity a nechává nejnovější řádek. Odpověď sama diagnostikuje nechráněný caller, ale nejmenší bezpečná oprava jej nemění. Poloviční kredit odlišuje funkční lokální opravu od splnění celé veřejné bezpečnostní hranice.',
         'It does not perform any secondary validation, deduplication, or lease checking.'),
        ('6802b9498279a8537342001e',2,.50,'high',
         'Původní Codex výtka o absenci reprodukce je chybná: odpověď mění binding mezi návrhem a DELETE a popisuje rozbitou roli. Chybí přesné samostatné testy prázdných jmen, aliasů a newest-first, proto částečný kredit podle druhého posudku.',
         'after* `getUnusedOldModels` runs but *before* the `fetch` DELETE completes.'),
    ]
    case_by_id = {x['id']:x for x in packets['dr']['cases']}
    disputes=[]
    for case_id,criterion,score,confidence,reason,quote in proposed:
        c=case_by_id[case_id]
        assert quote in c['response'], (case_id,quote)
        d=next(d for d in comparisons['dr']['disputes'] if d['id']==case_id and d['criterion']==criterion)
        disputes.append({**d,'proposedScore':score,'confidence':confidence,'proposalReason':reason,'responseQuote':quote,
            'criterionText':c['rubric'][criterion-1],'question':c['question'],'response':c['response']})
    adjudication={'status':'EXPOSED_CODEX_PROPOSAL_NOT_OPERATOR_ACCEPTED','decisionAuthority':False,
        'notIndependent':True,'simulatedUserOrOpus':False,'originalReviewsUnchanged':True,
        'policy':'Kritická chyba snižuje odpovídající kritérium; sama nevynuluje celou odpověď. Chyba sběru není nula modelu.',
        'sourcePacketSha256':reviews['dr'][0]['packetSha256'],'decisions':disputes}
    write(a.out,'adjudication-proposal.json',adjudication)
    matrix=[]
    for model in snapshot['models']:
        for role in ROLES:
            base=next(x for x in snapshot['cells'] if x['model']==model['model'] and x['role']==role)
            observations=[x for x in observation_rows if x['model']==model['model'] and x['role']==role]
            matrix.append({**base,'snapshotDate':'2026-09-25','observations':observations,'acceptedPercent':None,
                'recommendation':'N/A' if base['status']=='N/A' else 'NEPŘIŘAZOVAT AUTOMATICKY — pouze vývojová evidence',
                'scope':'Index of verified listed campaigns, not a claim that no other historical files exist'})
    result={'schemaVersion':1,'status':'REVIEW_READY_SIMULATION_PASS_REAL_NO_GO','decisionAuthority':False,
        'generatedAt':datetime.now(timezone.utc).isoformat(),'models':snapshot['models'],'matrix':matrix,
        'observations':observation_rows,'validation':validation,'chatAffectedDialogs':len(affected),
        'simulation':{'path':str(a.simulation),'checks':simulation['passCount'],'cells':len(simulation['matrix'])},
        'recommendations':[
            'Nový CHAT sběr po opravě historie; staré odpovědi neznámkovat jako opravené.',
            'Posoudit pět navržených rozsouzení D/R; nic automaticky nepřepsat.',
            'CODE porovnávat odděleně: technická komponenta není celá role.',
            'Výběr sestavy vyžaduje srovnatelnou přijatou evidenci a zákaz autorovy vlastní revize.',
            'Použít aktuální dvoumodelové kotvy k ověření nové vstupní kontroly, pak doplnit panel; nestahovat další modely před opravou kvality vstupu.'],
        'sources':SOURCES}
    write(a.out,'review-data.json',result)
    esc=html.escape
    def pct(v):return '—' if v is None else f'{v:.1f} %'
    def obs(o):return f"<p><b>{pct(o['percent'])}</b> · {esc(o['evaluator'])}<br>{esc(o['cohort'])}<br>{o['responses']} odpovědí / {o['taskCount']} úloh<br><small>{esc(o['meaning'])}</small></p>"
    table='<table><tr><th>Model</th>'+''.join(f'<th>{r}</th>' for r in ROLES)+'</tr>'
    for m in snapshot['models']:
        table+=f"<tr><th>{esc(m['model'])}</th>"
        for role in ROLES:
            cell=next(c for c in matrix if c['model']==m['model'] and c['role']==role)
            table+='<td>'+f"<b>{esc(cell['status'])}</b><br><small>základní snímek 25. 9.</small>"+''.join(obs(o) for o in cell['observations'])+'</td>'
        table+='</tr>'
    table+='</table>'
    details=''
    for d in disputes:
        details+=f"<details><summary>{d['role']} / kritérium {d['criterion']} · {d['scoreA']*100:g} % vs {d['scoreB']*100:g} % → návrh {d['proposedScore']*100:g} % · jistota {d['confidence']}</summary><p>{esc(d['proposalReason'])}</p><blockquote>{esc(d['responseQuote'])}</blockquote><p>{esc(d['criterionText'])}</p><h4>Celé zadání</h4><pre>{esc(d['question'])}</pre><h4>Celá odpověď</h4><pre>{esc(d['response'])}</pre><p>Codex: {esc(d['reasonA'])}</p><p>Opus: {esc(d['reasonB'])}</p></details>"
    sm='<table><tr><th>Fiktivní model</th>'+''.join(f'<th>{r}</th>' for r in ROLES)+'</tr>'
    for m in sorted({x['model'] for x in simulation['matrix']}):
        sm+=f'<tr><th>{m}</th>'+''.join('<td>'+pct(next(x['percent'] for x in simulation['matrix'] if x['model']==m and x['role']==r))+'</td>' for r in ROLES)+'</tr>'
    sm+='</table>'
    doc=f'''<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GPU hunt — revize dokončení</title><style>
body{{font:16px system-ui;background:#12161d;color:#e6edf4;margin:28px;line-height:1.5}}a{{color:#8dcaff}}h1,h2{{color:#edc66e}}table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border:1px solid #44505c;padding:12px;vertical-align:top;min-width:150px}}th{{background:#202936;position:sticky;top:0}}td p{{border-top:1px solid #44505c;padding-top:10px}}small{{color:#b6c2cf}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#1c2530;padding:16px}}details{{border:1px solid #44505c;padding:14px;margin:12px 0}}summary{{cursor:pointer}}.warning{{padding:18px;background:#382c19;border-left:5px solid #e5b759}}.scroll{{overflow:auto}}nav{{display:flex;gap:22px}}</style>
<h1>GPU hunt: dokončená simulace, skutečná evidence k revizi</h1><nav><a href="#real">Skutečné výsledky</a><a href="#disputes">Pět rozsouzení</a><a href="#simulation">Simulace všech rolí</a><a href="review-data.json">Zdroje a hashe</a></nav>
<p class="warning"><b>SIMULACE PASS / REÁLNÉ AUTOMATICKÉ ROZHODOVÁNÍ NO-GO.</b> Tento dokument nevytváří známky uživatele ani Opuse. Nevznikl nový sběr modelových odpovědí. Posudky se neslévají a žádný model se nemazal ani nepřepínal.</p>
<h2 id="real">Matice skutečně dohledaných výsledků</h2><p>10 modelů × 7 rolí. U procent je vždy hodnotitel, rozsah a kampaň. Žádné procento není přijatá celková známka role. Základní stav pokrytí je označený snímek z 25. 9.; novější posudky jsou pod ním jako oddělená pozorování. Starý draft CHAT panel všech 10 modelů není novým produkčním sběrem.</p><p>312 D/R odpovědí má doložený Opusův posudek. Novější cleanup obsahuje 24 odpovědí se dvěma posudky, ale měří jednu úlohu. Produkční CHAT má dva posudky všech 80 dialogů; <b>{len(affected)} dialogů nedostalo všechny dřívější uživatelské vstupy</b>. Jejich procenta nepoužívat pro pořadí.</p><div class="scroll">{table}</div>
<h2 id="disputes">Návrh rozsouzení pěti D/R kritérií</h2><p>Moje nové, otevřeně neslepé posouzení po přečtení obou důvodů a úplných odpovědí. Je to návrh k revizi, nikoli třetí nezávislý posudek. Původní známky zůstávají beze změny. U CHATu má přednost oprava vstupu a nový sběr před rozsouzením poškozených dialogů.</p>{details}
<h2 id="simulation">Celý postup na fiktivních modelech</h2><p><b>{simulation['passCount']} kontrol prošlo; 70 buněk, z toho 6 N/A.</b> Skutečný kód: ukládání, dvojí hodnotitel, spory, přejímka, read model a volba sestavy. Odpovědi, hodnotitelé a provozní výsledky jsou stuby. CODE/VISION orákula zde nejsou spouštěna; CHAT používá stávající smíšenou produkční sadu, nikoli nový vícekolový profil.</p><div class="scroll">{sm}</div><h3>Simulovaný návrh rolí</h3><pre>{esc(json.dumps(simulation['portfolio']['proposed']['bindings'],indent=2))}</pre><p>Simulované přepnutí a rollback jsou pouze virtuální transakce. Neověřují živý binding writer. Všechny provozní přejímky v exportovaných simulačních DB byly po zkoušce zneplatněny.</p>
<h2>Další reálný postup</h2><ol>{''.join('<li>'+esc(x)+'</li>' for x in result['recommendations'])}</ol><p>Kompletní strojový podklad: <a href="review-data.json">review-data.json</a>. Rozsouzení: <a href="adjudication-proposal.json">adjudication-proposal.json</a>.</p></html>'''
    write(a.out,'REVIEW.html',doc)
    write(a.out,'sources.json',SOURCES)
    print(json.dumps({'status':result['status'],'matrixCells':len(matrix),'observations':len(observation_rows),'dispositions':len(disputes),'output':str(a.out)}))

if __name__=='__main__':
    main()
