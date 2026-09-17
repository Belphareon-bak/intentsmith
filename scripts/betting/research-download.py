#!/usr/bin/env python3
"""Operator research acquisition; never invoked by the specialist package."""
import argparse, datetime as dt, hashlib, json, pathlib, time, urllib.request
p=argparse.ArgumentParser();p.add_argument('output');a=p.parse_args()
root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True)
paths=[f'mmz4281/{y:02d}{(y+1):02d}/{league}.csv' for y in range(16,27) for league in ['E0','D1','I1','SP1','F1']]+['fixtures.csv']
manifest=[]
for remote in paths:
 name=remote.replace('/','_'); dest=root/name; meta=root/(name+'.json')
 if dest.exists() and meta.exists():manifest.append(json.loads(meta.read_text()));continue
 url='https://www.football-data.co.uk/'+remote
 req=urllib.request.Request(url,headers={'User-Agent':'IntentSmith-betting-research/1.0','Accept':'text/csv'})
 with urllib.request.urlopen(req,timeout=30) as res:
  data=res.read(4_000_001)
  if len(data)>4_000_000 or b'HomeTeam' not in data[:3000]:raise ValueError('Invalid data '+url)
  record={'url':url,'file':name,'retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'lastModified':res.headers.get('Last-Modified'),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
 dest.write_bytes(data);meta.write_text(json.dumps(record,indent=2)+'\n');manifest.append(record)
 print(name,len(data),flush=True);time.sleep(0.75)
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
