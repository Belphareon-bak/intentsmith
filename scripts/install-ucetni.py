#!/usr/bin/env python3
"""Install only the private accountant runtime and launchers; never edit shell rc."""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import urllib.request

repo = Path(__file__).resolve().parent.parent
home = Path.home()
runtime = home/'.local/share/ucetni'
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
if runtime.is_symlink() or runtime.stat().st_uid != os.getuid():
    raise SystemExit('Unsafe runtime directory')
runtime.chmod(0o700)
for program in ['node', 'pdftotext', 'pdftoppm']:
    if not shutil.which(program):
        raise SystemExit('Missing prerequisite: '+program)
if not (runtime/'venv/bin/python').exists():
    subprocess.run([sys.executable,'-m','venv',str(runtime/'venv')],check=True)
print('Instaluji lokální OCR/PDF závislosti z PyPI; účetní podklady se neodesílají.', flush=True)
subprocess.run([str(runtime/'venv/bin/pip'),'install','-r',str(repo/'src/accounting/requirements.txt')],check=True)
tessdata=runtime/'tessdata';tessdata.mkdir(exist_ok=True)
for lang,digest in {'ces':'934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b','eng':'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'}.items():
    target=tessdata/(lang+'.traineddata')
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==digest:
        continue
    data=urllib.request.urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/'+lang+'.traineddata',timeout=30).read(12*1024*1024)
    if hashlib.sha256(data).hexdigest()!=digest:
        raise SystemExit('OCR model hash mismatch')
    target.write_bytes(data)
bindir=home/'.local/bin';bindir.mkdir(parents=True,exist_ok=True)
marker='# Managed by IntentSmith ucetni CLI\n'
for name in ['ucetni','uct']:
    target=bindir/name
    if target.is_symlink() or target.exists() and marker not in target.read_text():
        raise SystemExit('Refusing to overwrite foreign launcher '+str(target))
    target.write_text('#!/bin/sh\n'+marker+'exec '+shlex.quote(shutil.which('node'))+' '+shlex.quote(str(repo/'bin/ucetni.js'))+' "$@"\n')
    target.chmod(0o755)
print('Připraveno: ucetni a zkratka uct. Spusť ucetni --help.')
