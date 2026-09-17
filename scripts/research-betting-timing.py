#!/usr/bin/env python3
"""Descriptive paired timing audit; pre-closing CSV prices are NOT opening odds.
Reads the existing specialist cache; no network, model activation or betting.
"""
import argparse, csv, datetime as dt, hashlib, io, json, math, random, sqlite3
from collections import defaultdict
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('output');a=p.parse_args()
target=Path(a.output)
if target.exists(): raise SystemExit('Output must be new')
conn=sqlite3.connect('file:'+str(Path(a.database).resolve())+'?mode=ro',uri=True)
rows=conn.execute("SELECT o.resource,o.retrieved_at,o.sha256,b.content FROM betting_observations o JOIN betting_blobs b USING(sha256) WHERE o.resource LIKE 'football-data:mmz4281/%' ORDER BY o.retrieved_at,o.id").fetchall()
sources={r[0]:r for r in rows}; evidence=[]; pairs=[]; seen=set(); rejected=defaultdict(int)
for resource,observed,sha,raw in sources.values():
    assert hashlib.sha256(raw).hexdigest()==sha
    evidence.append(dict(resource=resource,observedAt=observed,sha256=sha))
    for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        try:
            date=dt.datetime.strptime(row['Date'],'%d/%m/%Y').date()
            key=(row['Div'],row['Date'],row['HomeTeam'],row['AwayTeam'])
            if key in seen: rejected['duplicate']+=1;continue
            if row['FTR'] not in ['H','D','A']: rejected['unsettled']+=1;continue
            early=[float(row['B365'+k]) for k in ['H','D','A']]
            close=[float(row['B365C'+k]) for k in ['H','D','A']]
            if any(not math.isfinite(o) or not 1<o<=1000 for o in early+close):raise ValueError()
            booksums=[sum(1/o for o in odds) for odds in [early,close]]
            if any(not 1<=s<=1.3 for s in booksums):rejected['booksum']+=1;continue
            seen.add(key);y=['H','D','A'].index(row['FTR']);ps=[[1/o/s for o in odds] for odds,s in zip([early,close],booksums)]
            loss=[-math.log(v[y]) for v in ps];brier=[sum((v[i]-(i==y))**2 for i in range(3)) for v in ps]
            fav=min(range(3),key=lambda i:early[i]);roi=[(odds[fav] if fav==y else 0)-1 for odds in [early,close]]
            pairs.append(dict(league=row['Div'],date=str(date),week=str(date-dt.timedelta(days=date.weekday())),early=early,close=close,loss=loss,brier=brier,roi=roi))
        except (ValueError,KeyError,TypeError):rejected['missing_or_invalid']+=1
if not pairs:raise SystemExit('No paired B365 pre-closing/closing data')
def stats(sample):
    n=len(sample);moves=[e-c for r in sample for e,c in zip(r['early'],r['close'])]
    return dict(matches=n,earlyHigher=sum(x>1e-10 for x in moves),closingHigher=sum(x< -1e-10 for x in moves),equal=sum(abs(x)<=1e-10 for x in moves),
                meanLogLoss=[sum(r['loss'][i] for r in sample)/n for i in range(2)],meanBrier=[sum(r['brier'][i] for r in sample)/n for i in range(2)],
                earlySelectedFavouriteROI=[sum(r['roi'][i] for r in sample)/n for i in range(2)])
groups=defaultdict(list)
for r in pairs:groups[r['week']].append(r['loss'][1]-r['loss'][0])
blocks=[(sum(v),len(v)) for v in groups.values()];randomizer=random.Random(12092026);boot=[]
for _ in range(2000):
    drawn=[randomizer.choice(blocks) for _ in blocks];boot.append(sum(x[0] for x in drawn)/sum(x[1] for x in drawn))
boot.sort();report=dict(method='paired-B365-preclose-close-v1',labels=['pre-closing observed CSV','closing CSV'],sourceDateRange=[min(r['date'] for r in pairs),max(r['date'] for r in pairs)],
    sources=evidence,aggregate=stats(pairs),byLeague={l:stats([r for r in pairs if r['league']==l]) for l in sorted({r['league'] for r in pairs})},
    closingMinusEarlyLogLossCI95=[boot[49],boot[1949]],weekBlocks=len(blocks),bootstrapReplicates=2000,rejections=dict(rejected),
    limitations=['First CSV sample is not actual opening time; collection ages/hours-to-kickoff are unknown.', 'Descriptive comparison; no fitted timing strategy, no claim these returns are attainable today.', 'Closing odds cannot be used as an online input before closing. Historical observations downloaded later do not establish original as-of availability.', 'Single bookmaker Bet365, not Fortuna; retrospective audit is not a validated edge in the current Czech feed.'])
target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['sourceDateRange','aggregate','closingMinusEarlyLogLossCI95','weekBlocks']},indent=2))
