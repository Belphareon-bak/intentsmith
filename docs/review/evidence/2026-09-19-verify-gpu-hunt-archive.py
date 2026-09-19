#!/usr/bin/env python3
"""Verify archive custody without extracting or executing archive contents."""
import argparse,json,hashlib,tarfile,pathlib
p=argparse.ArgumentParser();p.add_argument('receipt');a=p.parse_args();receipt=json.load(open(a.receipt));archive=pathlib.Path(receipt['archive'])
def digest(stream):
 h=hashlib.sha256();size=0
 for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk);size+=len(chunk)
 return h.hexdigest(),size
with archive.open('rb') as f:h,size=digest(f)
assert h==receipt['sha256'] and size==receipt['bytes'],'Archive hash/size mismatch'
observed={};seen=set();snapshots=[];manifest=None
# Sequential reading avoids repeatedly decompressing the same gzip prefix.
with tarfile.open(archive,'r|gz') as t:
 for m in t:
  assert m.name not in seen,'Duplicate archive member';seen.add(m.name)
  assert m.isfile() and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts,'Unsafe archive member'
  if m.name=='manifest.json':
   data=t.extractfile(m).read();assert hashlib.sha256(data).hexdigest()==receipt['manifestSha256'],'Manifest hash mismatch';manifest=json.loads(data)
  elif m.name.startswith('snapshots/'):
   data=t.extractfile(m).read();observed[m.name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)};snapshots.append(json.loads(data))
  else:
   h,size=digest(t.extractfile(m));observed[m.name]={'sha256':h,'bytes':size}
assert manifest is not None and observed==manifest['files'],'Missing, extra or changed archive file'
references=0
for snapshot in snapshots:
 for relative,e in snapshot['entries'].items():
  assert not relative.startswith('/') and '..' not in pathlib.PurePosixPath(relative).parts
  if e['kind']=='symlink':assert isinstance(e['target'],str);continue
  assert e['kind']=='file'
  blob=manifest['files']['blobs/sha256/'+e['sha256']];assert blob['sha256']==e['sha256'] and blob['bytes']==e['bytes'];references+=1
assert len(manifest['files'])==receipt['filesVerified']
print(json.dumps({'status':'PASS','archiveSha256':receipt['sha256'],'filesVerified':len(manifest['files']),'workspaceFileReferencesVerified':references,'extracted':False,'verifierSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}))
