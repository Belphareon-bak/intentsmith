#!/usr/bin/env python3
"""Poskládá prototype/project/Main.dc.html (artboard plátna, necommituje se) ze
šablony src/main.template.html, skriptu src/main.js a motivů z ../design."""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('themes', HERE.parent / 'design' / 'build-theme-css.py')
themes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(themes)

tpl = (HERE / 'src' / 'main.template.html').read_text(encoding='utf-8')
js = (HERE / 'src' / 'main.js').read_text(encoding='utf-8')
assert '/*SCRIPT*/' in tpl and '/*THEMES*/' in tpl
css = themes.build()
out = tpl.replace('/*SCRIPT*/', js.rstrip('\n')).replace('/*THEMES*/', css)
(HERE / 'project').mkdir(exist_ok=True)
(HERE / 'project' / 'Main.dc.html').write_text(out, encoding='utf-8')
(HERE.parent / 'design' / 'tokens.css').write_text('/* Vygenerováno z build-theme-css.py – motivy prototypu IDE 2.0 */\n' + css + '\n', encoding='utf-8')
print('Main.dc.html:', len(out), 'znaků')
