#!/usr/bin/env python3
"""Vygeneruje CSS motivů Studia 2.0 (design/tokens.css). Prototyp je vkládá do
své šablony přes prototype/build.py.

Palety jsou převzaté z původního IDE (chat-panel-module.js: _C_DEFAULT, _C_STUDIO,
_C_CLEAN, _brandLightC, _studioLightC, _cleanLightC, _C_THEMES.matrix/japanese/midnight,
_PRO_GLASS, _accentPalettes, _bgPresets). Nocturne je navíc – barvy rodiny
ShellSmith/SystemSmith.

Kontrast: tam, kde by původní „faint" text na pozadí vyšel pod 4.5:1, je --faint
posunutý k čitelnější hodnotě. Ostatní barvy jsou beze změny.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# URL tapet platí pro plátno prototypu (claude.ai). Rozšíření intentsmith-studio2
# místo nich použije přibalené zmenšené obrázky (THEMES §4).
ASSETS = {
    'matrix': '/_blob/9dbb1ae17f815578b98d0e741e47ab32',
    'japanese': '/_blob/d2e2c945e2d11d5487be35dda05bfe01',
    'midnight': '/_blob/e27c2685f7e186e767743061886661e6',
}


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hx(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)


def mix(a, b, t):
    a, b = rgb(a), rgb(b)
    return hx(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))


def trip(h):
    return ' '.join(str(v) for v in rgb(h))


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def readable(fg, backgrounds, alt):
    # Sidebar, cards and chat bubbles use s0..s2; faint text must be legible on all.
    chosen = fg if all(contrast(fg, bg) >= 4.5 for bg in backgrounds) else alt
    if not all(contrast(chosen, bg) >= 4.5 for bg in backgrounds):
        raise ValueError('faint palette lacks 4.5:1 contrast on a primary surface')
    return chosen


def on_color(h):
    return '#17120a' if lum(h) > 0.35 else '#ffffff'


# s0..s5 = bg0..bg5 z původního IDE, tx = tx1, dm = tx2, faint = tx4 (nebo čitelnější náhrada)
THEMES = {
    'intentsmith-dark': dict(s=['#09090b', '#141416', '#1b1b1e', '#232326', '#2d2c30', '#38373c'], tx='#f4f1ea', dm='#b9b2a7', faint='#8c7d67',
                             bd1='rgba(231,194,122,0.08)', bd2='rgba(231,194,122,0.15)', acc='#d4a85f', acct='#e7c27a', accd='#9b6b32', fg='#17120a', asa=0.12,
                             ok='#5ecf91', warn='#fbbf24', bad='#f87171', info='#60a5fa', violet='#a78bfa', cyan='#22d3ee'),
    'intentsmith-light': dict(s=['#f7f4ee', '#f0ebe2', '#e8e1d6', '#ddd4c7', '#d0c4b4', '#c0b29f'], tx='#211d17', dm='#5c5348', faint='#665f55',
                              bd1='rgba(83,61,30,0.10)', bd2='rgba(83,61,30,0.18)', acc='#d4a85f', acct='#8a5c22', accd='#9b6b32', fg='#17120a', asa=0.2,
                              ok='#1f7a4a', warn='#8a6206', bad='#b3261e', info='#1f5fcf', violet='#6a45c9', cyan='#0e7490'),
    'studio-dark': dict(s=['#090d11', '#0d1319', '#121b23', '#1b2232', '#2a3343', '#384257'], tx='#e9edf4', dm='#bcc6d5', faint='#7f8ca1',
                        bd1='rgba(151,177,221,0.12)', bd2='rgba(151,177,221,0.24)', acc='#8170ef', acct='#c0b8ff', accd='#5342ad', fg='#ffffff', asa=0.18,
                        ok='#42dca3', warn='#e8bc59', bad='#ee7c8e', info='#5aaafa', violet='#ae96ff', cyan='#58d3df'),
    'studio-light': dict(s=['#f0f3fa', '#e7edf8', '#dce4f2', '#cdd8ed', '#bfcee6', '#adbfdc'], tx='#18213b', dm='#455577', faint='#536487',
                         bd1='rgba(65,87,136,0.12)', bd2='rgba(65,87,136,0.24)', acc='#8170ef', acct='#5342ad', accd='#5342ad', fg='#ffffff', asa=0.16,
                         ok='#12805a', warn='#8a6206', bad='#b4233f', info='#1f5fcf', violet='#6a45c9', cyan='#0e7490'),
    'clean-dark': dict(s=['#0c0c0f', '#111114', '#18181c', '#1f2025', '#27282e', '#2f3038'], tx='#ececef', dm='#a1a1aa', faint='#71717a',
                       bd1='rgba(255,255,255,0.06)', bd2='rgba(255,255,255,0.10)', acc='#22c55e', acct='#4ade80', accd='#16a34a', fg='#ffffff', asa=0.08,
                       ok='#22c55e', warn='#fbbf24', bad='#f87171', info='#60a5fa', violet='#a78bfa', cyan='#22d3ee'),
    'clean-light': dict(s=['#f5f5f7', '#eaeaec', '#e0e0e3', '#d4d4d8', '#c8c8cc', '#bbbbc0'], tx='#18181b', dm='#52525b', faint='#5f5f68',
                        bd1='rgba(0,0,0,0.08)', bd2='rgba(0,0,0,0.15)', acc='#22c55e', acct='#15803d', accd='#16a34a', fg='#ffffff', asa=0.12,
                        ok='#15803d', warn='#8a6206', bad='#b91c1c', info='#1d4ed8', violet='#6d28d9', cyan='#0e7490'),
    'matrix': dict(s=['#010208', '#020410', '#040818', '#06101e', '#0a1428', '#0e1a32'], tx='#b0ffb0', dm='#5fb57a', faint='#3f9a5e',
                   bd1='rgba(0,255,106,0.10)', bd2='rgba(0,255,106,0.22)', acc='#00ff6a', acct='#66ffaa', accd='#00a845', fg='#02140a', asa=0.10,
                   ok='#22c55e', warn='#ffaa00', bad='#ff4444', info='#44aaff', violet='#bb66ff', cyan='#00ffcc',
                   glass=['#020410', '#040818', '#06101e', '#0a1428'], dimc='#010208',
                   font='"Share Tech Mono","JetBrains Mono",monospace', mono='"Share Tech Mono","JetBrains Mono",monospace',
                   overlay='repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,106,0.02) 2px,rgba(0,255,106,0.02) 4px)'),
    'japanese': dict(s=['#050304', '#0a0406', '#120810', '#1c0c12', '#28121a', '#341822'], tx='#f5e8e8', dm='#b07070', faint='#a05a5a',
                     bd1='rgba(220,38,38,0.15)', bd2='rgba(220,38,38,0.32)', acc='#dc2626', acct='#f87171', accd='#991b1b', fg='#ffffff', asa=0.12,
                     ok='#4ade80', warn='#fbbf24', bad='#f87171', info='#60a5fa', violet='#a78bfa', cyan='#22d3ee',
                     glass=['#0a0406', '#120810', '#1c0c12', '#28121a'], dimc='#050304',
                     font='"Zen Kaku Gothic Antique","Noto Sans JP",sans-serif', mono='"JetBrains Mono","Fira Code",monospace',
                     overlay='radial-gradient(ellipse 80% 40% at 50% 90%,rgba(180,20,20,0.15),transparent 70%),radial-gradient(ellipse 50% 20% at 30% 70%,rgba(255,30,30,0.08),transparent)'),
    'midnight': dict(s=['#030712', '#060a18', '#0a1026', '#101838', '#16204a', '#1c285c'], tx='#d8e8ff', dm='#8aa4cc', faint='#6888b8',
                     bd1='rgba(100,160,255,0.12)', bd2='rgba(100,160,255,0.25)', acc='#60a5fa', acct='#93c5fd', accd='#1d4ed8', fg='#04131f', asa=0.12,
                     ok='#4ade80', warn='#fcd34d', bad='#fb7185', info='#60a5fa', violet='#a78bfa', cyan='#22d3ee',
                     glass=['#060a18', '#0a1026', '#101838', '#16204a'], dimc='#030712',
                     font='"Inter","Plus Jakarta Sans",sans-serif', mono='"JetBrains Mono","Fira Code",monospace',
                     overlay='radial-gradient(ellipse 60% 30% at 55% 90%,rgba(40,80,200,0.12),transparent 60%),radial-gradient(ellipse 40% 20% at 70% 20%,rgba(100,60,200,0.08),transparent)'),
    'nocturne-dark': dict(s=['#0f141a', '#141b23', '#1a232d', '#1f2a35', '#243140', '#2c3b4c'], tx='#c8d3e0', dm='#8a99ab', faint='#74828f',
                          bd1='#1b2530', bd2='#243140', acc='#e3a857', acct='#e3a857', accd='#b07f36', fg='#1d1406', asa=0.14,
                          ok='#63d68a', warn='#f2c14e', bad='#ff6b73', info='#5fa8ff', violet='#c58cf5', cyan='#4fd6be'),
    'nocturne-light': dict(s=['#f4f1ec', '#fbf9f6', '#f1ede7', '#e7e2da', '#ddd6cc', '#d3ccc1'], tx='#2c3038', dm='#5a616c', faint='#666d77',
                           bd1='#e1dbd2', bd2='#d3ccc1', acc='#8f5b0c', acct='#8f5b0c', accd='#6b440a', fg='#ffffff', asa=0.12,
                           ok='#1f7a3f', warn='#8a6206', bad='#b3261e', info='#1f5fcf', violet='#7a3fc2', cyan='#0d7a70'),
}

CLEAN_ACCENTS = [('#22c55e', '#4ade80', '#16a34a'), ('#3b82f6', '#60a5fa', '#2563eb'), ('#8b5cf6', '#a78bfa', '#7c3aed'), ('#ec4899', '#f472b6', '#db2777'),
                 ('#f97316', '#fb923c', '#ea580c'), ('#ffffff', '#e4e4e7', '#a1a1aa'), ('#ef4444', '#f87171', '#dc2626'), ('#06b6d4', '#22d3ee', '#0891b2')]
CLEAN_BG = {1: '#14141e', 2: '#0c1525'}


def theme_rule(name, t):
    s = t['s']
    faint = readable(t['faint'], s[:3], t['dm'])
    parts = [f'--s{i}:{c}' for i, c in enumerate(s)]
    parts += [f"--tx:{t['tx']}", f"--dm:{t['dm']}", f'--faint:{faint}', f"--bd1:{t['bd1']}", f"--bd2:{t['bd2']}",
              f"--accF:{t['acc']}", f"--acct:{t['acct']}", f"--accD:{t['accd']}", f"--accR:{trip(t['acc'])}", f"--acc-fg:{t['fg']}", f"--asa:{t['asa']}",
              f"--ok:{t['ok']}", f"--warn:{t['warn']}", f"--bad:{t['bad']}", f"--info:{t['info']}", f"--violet:{t['violet']}", f"--cyan:{t['cyan']}"]
    if 'glass' in t:
        parts += [f'--g{i}:{trip(c)}' for i, c in enumerate(t['glass'])]
        parts += [f"--gdim:{trip(t['dimc'])}", f"--font-ui:{t['font']}", f"--font-mono:{t['mono']}"]
    out = ['.th-%s{%s}' % (name, ';'.join(parts))]
    if 'glass' in t:
        url = ASSETS[name]
        out.append('.ide.th-%s{background:linear-gradient(rgb(var(--gdim) / var(--bdim)),rgb(var(--gdim) / var(--bdim))),url(%s) center/cover no-repeat}' % (name, url))
        out.append('.ide.th-%s::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:%s;opacity:.7}' % (name, t['overlay']))
        out.append('.mini.th-%s{background:linear-gradient(rgb(var(--gdim) / .3),rgb(var(--gdim) / .3)),url(%s) center/cover no-repeat}' % (name, url))
    return out


def build():
    css = []
    for name, t in THEMES.items():
        css += theme_rule(name, t)
    for i, (a, txt, d) in enumerate(CLEAN_ACCENTS):
        css.append('.ide.cacc-%d{--accF:%s;--acct:%s;--accD:%s;--accR:%s;--acc-fg:%s}' % (i, a, txt, d, trip(a), on_color(a)))
        css.append('.ide.light.cacc-%d{--acct:%s}' % (i, d if a != '#ffffff' else '#3f3f46'))
    for i, base in CLEAN_BG.items():
        steps = [base] + [mix(base, '#ffffff', f) for f in (0.04, 0.08, 0.13, 0.18, 0.24)]
        css.append('.ide.cbg-%d{%s}' % (i, ';'.join('--s%d:%s' % (k, c) for k, c in enumerate(steps))))
    for v in range(0, 101, 10):
        css.append('.ti-%d{--tip:%.1f%%;--tb:%.1f%%}' % (v, 78 + v * 0.22, v * 0.16))
    for v in range(10, 101, 10):
        css.append('.ai-%d{--aip:%d%%;--aia:%.2f}' % (v, v, v / 100))
    for v in range(10, 101, 10):
        css.append('.pa-%d{--pa:%.2f}' % (v, v / 100))
    for v in range(0, 101, 10):
        css.append('.ta-%d{--ta:%.2f}' % (v, v / 100))
    for v in range(0, 81, 10):
        css.append('.bd-%d{--bdim:%.2f}' % (v, v / 100))
    return '\n'.join(css)


if __name__ == '__main__':
    (HERE / 'tokens.css').write_text('/* Vygenerováno z build-theme-css.py – motivy Studia 2.0 */\n' + build() + '\n', encoding='utf-8')
    print('tokens.css zapsán')
