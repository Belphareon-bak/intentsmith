#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════════
# C3-Agent — PDF Export (A5)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Generates styled PDF from conversation turns.
# Called from Node.js via: python3 pdf-exporter.py <input.json> <output.pdf>
#
# Input JSON: { "title": "...", "turns": [{"role":"user","content":"..."},...], "lang": "cs" }
# Output: PDF file with Czech character support (DejaVu font)
#
# ═══════════════════════════════════════════════════════════════════════════════

import json
import sys
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ─── Font Registration (Czech/Slovak diacritics support) ──────────────────────

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
FONT_PATHS = {
    'DejaVu': os.path.join(FONT_DIR, 'DejaVuSans.ttf'),
    'DejaVu-Bold': os.path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
    'DejaVu-Italic': os.path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf'),
    'DejaVu-BoldItalic': os.path.join(FONT_DIR, 'DejaVuSans-BoldOblique.ttf'),
    'DejaVu-Mono': os.path.join(FONT_DIR, 'DejaVuSansMono.ttf'),
}

def register_fonts():
    for name, path in FONT_PATHS.items():
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
        else:
            # Fallback: try Liberation fonts
            alt = path.replace('dejavu', 'liberation').replace('DejaVu', 'Liberation')
            if os.path.exists(alt):
                pdfmetrics.registerFont(TTFont(name, alt))

register_fonts()

# ─── Colors ───────────────────────────────────────────────────────────────────

C3_BLUE      = HexColor('#2563EB')
C3_DARK      = HexColor('#1E293B')
C3_GRAY      = HexColor('#64748B')
C3_LIGHT_BG  = HexColor('#F1F5F9')
USER_BG      = HexColor('#EFF6FF')
ASST_BG      = HexColor('#F0FDF4')
USER_ACCENT  = HexColor('#3B82F6')
ASST_ACCENT  = HexColor('#22C55E')

# ─── Styles ───────────────────────────────────────────────────────────────────

def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'C3Title',
        parent=styles['Title'],
        fontName='DejaVu-Bold',
        fontSize=18,
        textColor=C3_DARK,
        spaceAfter=6,
        alignment=TA_LEFT,
    ))

    styles.add(ParagraphStyle(
        'C3Subtitle',
        parent=styles['Normal'],
        fontName='DejaVu',
        fontSize=9,
        textColor=C3_GRAY,
        spaceAfter=16,
    ))

    styles.add(ParagraphStyle(
        'C3UserLabel',
        parent=styles['Normal'],
        fontName='DejaVu-Bold',
        fontSize=9,
        textColor=USER_ACCENT,
        spaceBefore=12,
        spaceAfter=2,
    ))

    styles.add(ParagraphStyle(
        'C3AssistantLabel',
        parent=styles['Normal'],
        fontName='DejaVu-Bold',
        fontSize=9,
        textColor=ASST_ACCENT,
        spaceBefore=12,
        spaceAfter=2,
    ))

    styles.add(ParagraphStyle(
        'C3UserContent',
        parent=styles['Normal'],
        fontName='DejaVu',
        fontSize=10,
        textColor=C3_DARK,
        leftIndent=8,
        spaceAfter=4,
        leading=14,
    ))

    styles.add(ParagraphStyle(
        'C3AssistantContent',
        parent=styles['Normal'],
        fontName='DejaVu',
        fontSize=10,
        textColor=C3_DARK,
        leftIndent=8,
        spaceAfter=4,
        leading=14,
    ))

    styles.add(ParagraphStyle(
        'C3Footer',
        parent=styles['Normal'],
        fontName='DejaVu',
        fontSize=7,
        textColor=C3_GRAY,
        alignment=TA_CENTER,
    ))

    return styles


# ─── Helpers ──────────────────────────────────────────────────────────────────

def escape_xml(text):
    """Escape XML special characters for reportlab Paragraph."""
    return (text
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;'))


def text_to_paragraphs(text, style):
    """Convert text with newlines into multiple Paragraph objects."""
    paragraphs = []
    # Split on double newlines (paragraph breaks) first
    blocks = text.split('\n\n')
    for i, block in enumerate(blocks):
        # Within a block, replace single newlines with <br/>
        lines = block.strip()
        if not lines:
            continue
        safe = escape_xml(lines).replace('\n', '<br/>')
        paragraphs.append(Paragraph(safe, style))
        if i < len(blocks) - 1:
            paragraphs.append(Spacer(1, 4))
    return paragraphs


# ─── Labels ───────────────────────────────────────────────────────────────────

LABELS = {
    'cs': {
        'user': '👤 Uživatel',
        'assistant': '🤖 Asistent',
        'exported': 'Exportováno z C3-Agent',
        'turns': 'zpráv',
    },
    'en': {
        'user': '👤 User',
        'assistant': '🤖 Assistant',
        'exported': 'Exported from C3-Agent',
        'turns': 'messages',
    },
}

# ─── Document Builder ─────────────────────────────────────────────────────────

def build_pdf(data, output_path):
    title = data.get('title', 'C3 Conversation')
    turns = data.get('turns', [])
    lang = data.get('lang', 'cs')
    labels = LABELS.get(lang, LABELS['en'])

    styles = build_styles()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20*mm,
        rightMargin=20*mm,
        topMargin=20*mm,
        bottomMargin=20*mm,
        title=title,
        author='C3-Agent',
        subject='Chat Export',
    )

    story = []

    # ─── Header ───────────────────────────────────────────────────────────
    story.append(Paragraph(escape_xml(title), styles['C3Title']))

    now = datetime.now().strftime('%d. %m. %Y %H:%M' if lang == 'cs' else '%Y-%m-%d %H:%M')
    subtitle = f"{labels['exported']} • {now} • {len(turns)} {labels['turns']}"
    story.append(Paragraph(subtitle, styles['C3Subtitle']))

    story.append(HRFlowable(
        width='100%', thickness=1, color=HexColor('#E2E8F0'),
        spaceAfter=8, spaceBefore=4,
    ))

    # ─── Turns ────────────────────────────────────────────────────────────
    for turn in turns:
        role = turn.get('role', 'user')
        content = turn.get('content', '')

        if role == 'user':
            story.append(Paragraph(labels['user'], styles['C3UserLabel']))
            story.extend(text_to_paragraphs(content, styles['C3UserContent']))
        else:
            story.append(Paragraph(labels['assistant'], styles['C3AssistantLabel']))
            story.extend(text_to_paragraphs(content, styles['C3AssistantContent']))

        # Subtle separator between turns
        story.append(HRFlowable(
            width='60%', thickness=0.5, color=HexColor('#E2E8F0'),
            spaceAfter=4, spaceBefore=4,
        ))

    # ─── Footer ───────────────────────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(Paragraph(
        f'C3-Agent • {now}',
        styles['C3Footer'],
    ))

    # ─── Build ────────────────────────────────────────────────────────────
    doc.build(story)
    return os.path.getsize(output_path)


# ─── CLI Entry Point ──────────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    size = build_pdf(data, output_path)
    # Output JSON result for Node.js caller
    print(json.dumps({'size': size, 'path': output_path}))
