#!/usr/bin/env python3
"""Local bounded decoder/validator/renderer. No network and no shell execution."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import subprocess
import sys
import zipfile

resource.setrlimit(resource.RLIMIT_CPU, (100, 110))
resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024,) * 2)
os.environ['OMP_THREAD_LIMIT'] = '1'
ROOT = Path(__file__).resolve().parent
MAX_BYTES = 24 * 1024 * 1024


def xml_root(data):
    from lxml import etree
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML_ENTITY_FORBIDDEN')
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False))


def xml_info(data):
    from lxml import etree
    root = xml_root(data)
    local = lambda x: etree.QName(x).localname
    forms = [x for x in root if local(x) in ['DPHKH1', 'DPHDP3', 'DPFDP7']]
    if local(root) in ['OSVC','prehledOSVC']:
        forms = [root]
    result = []
    attachments = []
    for form in forms:
        fields = []
        for el in form.iter():
            if local(el) in ['ObecnaPriloha', 'img']:
                encoded = el.text or el.get('base64data', '')
                if len(encoded) > MAX_BYTES * 2:
                    raise ValueError('ATTACHMENT_TOO_LARGE')
                try:
                    raw = base64.b64decode(re.sub(r'\s+', '', encoded), validate=True)
                    if raw.startswith(b'%PDF-') and len(raw) <= MAX_BYTES:
                        attachments.append({'name': Path(el.get('jm_souboru', el.get('nazev', 'priloha.pdf'))).name, 'data': base64.b64encode(raw).decode()})
                except ValueError:
                    pass
                continue
            if el.attrib or (el.text or '').strip():
                fields.append({'tag': local(el), 'attributes': dict(el.attrib), 'text': (el.text or '').strip()[:1000]})
        result.append({'form': local(form), 'fields': fields})
    return {'forms': result, 'attachments': attachments}


def ocr(image, tessdata, psm=3):
    import tesserocr
    image = image.convert('RGB')
    if max(image.size) > 3200:
        image.thumbnail((3200, 3200))
    with tesserocr.PyTessBaseAPI(path=tessdata, lang='ces+eng', psm=psm) as api:
        api.SetImage(image)
        text = api.GetUTF8Text()
        confidence = api.MeanTextConf() / 100
    return text, confidence


def enhanced_ocr(image, tessdata):
    from PIL import ImageOps, ImageFilter
    image = ImageOps.autocontrast(ImageOps.grayscale(image))
    width = max(image.width, 1000)
    image = image.resize((width, round(image.height*width/image.width))).filter(ImageFilter.UnsharpMask(radius=1.5, percent=120, threshold=3))
    return ocr(image, tessdata, 6)


def decode(data, name, tessdata, grid=None):
    if len(data) > MAX_BYTES:
        raise ValueError('FILE_TOO_LARGE')
    if data.startswith(b'%PDF-'):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted or len(reader.pages) > 60:
            raise ValueError('PDF_ENCRYPTED_OR_TOO_MANY_PAGES')
        # Poppler preserves column layout used by Fakturoid invoices.
        p = subprocess.run(['pdftotext', '-layout', '-', '-'], input=data, capture_output=True, timeout=20, check=True)
        texts = p.stdout.decode('utf-8').split('\f')[:len(reader.pages)]
        pages = []
        for i, text in enumerate(texts):
            if len(text.strip()) < 30:
                # Render only this page locally. Poppler writes no user files.
                rendered = subprocess.run(['pdftoppm', '-f', str(i+1), '-l', str(i+1), '-singlefile', '-scale-to', '2400', '-png', '-'], input=data, capture_output=True, timeout=25, check=True).stdout
                from PIL import Image
                text, confidence = ocr(Image.open(io.BytesIO(rendered)), tessdata)
                pages.append({'page': i+1, 'text': text, 'method': 'tesseract', 'confidence': confidence})
            else:
                pages.append({'page': i+1, 'text': text, 'method': 'pdf-text', 'confidence': None})
        return {'type': 'pdf', 'pages': pages}
    if data.lstrip().startswith(b'<?xml') or data.lstrip().startswith((b'<Pisemnost', b'<OSVC', b'<prehledOSVC')):
        return {'type': 'xml', **xml_info(data), 'pages': []}
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    Image.MAX_IMAGE_PIXELS = 24_000_000
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    if im.width * im.height > 24_000_000:
        raise ValueError('IMAGE_TOO_LARGE')
    full_text, full_conf = ocr(im, tessdata, 11)
    # Multiple receipt headings trigger a proposed grid. Every image import
    # requires coverage review; a proposed split is never accepted as complete.
    proposal = grid
    if proposal is None and len(re.findall(r'(?:doklad|dokladu|Datum)', full_text, re.I)) >= 6 and im.height / im.width > 1.6:
        proposal = [3, 2]
    if proposal:
        cols, rows = proposal
        if not all(isinstance(n, int) and 1 <= n <= 6 for n in proposal) or cols * rows > 20:
            raise ValueError('GRID_INVALID')
    else:
        cols, rows = 1, 1
    pages = []
    for col in range(cols):
        for row in range(rows):
            box = [round(col * im.width / cols), round(row * im.height / rows), round((col+1) * im.width / cols), round((row+1) * im.height / rows)]
            text, confidence = ocr(im.crop(tuple(box)), tessdata)
            enhanced, enhanced_confidence = enhanced_ocr(im.crop(tuple(box)), tessdata)
            pages.append({'page': 1, 'region': box, 'text': text, 'confidence': confidence, 'method': 'tesseract', 'alternatives': [{'text': enhanced, 'confidence': enhanced_confidence, 'method': 'tesseract-enhanced'}]})
    return {'type': 'image', 'size': list(im.size), 'proposedGrid': [cols, rows], 'coverageReviewRequired': True, 'fullText': full_text, 'pages': pages}


def unpack(data):
    result = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        if len(infos) > 100 or sum(i.file_size for i in infos) > 96 * 1024 * 1024:
            raise ValueError('ZIP_LIMIT_EXCEEDED')
        names = set()
        for i in infos:
            p = PurePosixPath(i.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in i.filename or re.match(r'^[A-Za-z]:', i.filename) or '\x00' in i.filename or (i.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('ZIP_UNSAFE_PATH')
            if i.is_dir():
                continue
            if i.filename in names or i.file_size > MAX_BYTES or (i.compress_size and i.file_size/i.compress_size > 200):
                raise ValueError('ZIP_UNSAFE_ENTRY')
            names.add(i.filename)
            raw = z.read(i)
            if p.suffix.lower() not in ['.pdf', '.xml', '.heic', '.jpg', '.jpeg', '.png', '.txt', '.csv', '.ics', '.json']:
                raise ValueError('ZIP_UNSUPPORTED_ENTRY: ' + p.name)
            result.append({'name': i.filename, 'data': base64.b64encode(raw).decode()})
    return result


def validate(forms):
    from lxml import etree
    sources = json.loads((ROOT/'schemas/sources.json').read_text())
    class PinnedResolver(etree.Resolver):
        def resolve(self, url, pubid, context):
            name = Path(url).name
            candidate = ROOT/'schemas'/name
            if name != 'baseTypes2.xsd':
                raise ValueError('SCHEMA_IMPORT_FORBIDDEN')
            raw = candidate.read_bytes()
            if not any(x['form'] == name and x['sha256'] == hashlib.sha256(raw).hexdigest() for x in sources):
                raise ValueError('SCHEMA_IMPORT_HASH_CHANGED')
            return self.resolve_string(raw, context)
    results = []
    for form in forms:
        name = form['schema']
        if '/' in name or '\\' in name or not name.endswith('.xsd'):
            raise ValueError('SCHEMA_INVALID')
        path = ROOT/'schemas'/name
        raw = path.read_bytes()
        if not any(x['sha256'] == hashlib.sha256(raw).hexdigest() for x in sources):
            raise ValueError('SCHEMA_HASH_CHANGED')
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        parser.resolvers.add(PinnedResolver())
        schema = etree.XMLSchema(etree.fromstring(raw, parser))
        tree = xml_root(form['xml'].encode())
        ok = schema.validate(tree)
        results.append({'name': form['name'], 'valid': ok, 'schemaSha256': hashlib.sha256(raw).hexdigest(), 'errors': [str(x) for x in schema.error_log][:15]})
    return results


def pdf(title, lines):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.utils import simpleSplit
    from reportlab.lib.pagesizes import A4
    font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    pdfmetrics.registerFont(TTFont('CZ', font))
    out = io.BytesIO(); c = canvas.Canvas(out, pagesize=A4); c.setTitle(title)
    y = 800
    for line in [title, '', *lines]:
        for part in simpleSplit(str(line), 'CZ', 10, 510):
            if y < 45:
                c.showPage(); y = 800
            c.setFont('CZ', 10); c.drawString(40, y, part); y -= 15
    c.save()
    return out.getvalue()


def ozp_pdf(fields):
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    # Flatten values into the official blank form; do not rely on viewer JS.
    template = ROOT/'templates/ozp-2025.pdf'
    meta = json.loads((ROOT/'templates/sources.json').read_text())[0]
    if hashlib.sha256(template.read_bytes()).hexdigest() != meta['sha256']:
        raise ValueError('PDF_TEMPLATE_HASH_CHANGED')
    r = PdfReader(template); writer = PdfWriter()
    pdfmetrics.registerFont(TTFont('CZ', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
    for page in r.pages:
        out=io.BytesIO(); can=canvas.Canvas(out, pagesize=(float(page.mediabox.width),float(page.mediabox.height)))
        for ref in page.get('/Annots', []):
            el=ref.get_object(); parent=el.get('/Parent'); parent=parent.get_object() if parent else el
            name=el.get('/T',parent.get('/T'))
            if name not in fields:
                continue
            x1,y1,x2,y2=map(float,el['/Rect']); value=str(fields[name])
            if el.get('/FT',parent.get('/FT')) == '/Btn':
                states=el.get('/AP',{}).get('/N',{})
                if '/'+value in states:
                    can.setFont('CZ',9);can.drawString(x1+1,y1+1,'X')
                continue
            size=min(10,max(5,(x2-x1-4)/max(len(value),1)*1.7));can.setFont('CZ',size);can.drawString(x1+2,y1+max(2,(y2-y1-size)/2),value)
        can.save(); page.merge_page(PdfReader(out).pages[0]);
        if '/Annots' in page:
            del page['/Annots']
        writer.add_page(page)
    out=io.BytesIO();writer.write(out);return out.getvalue()


def main(req):
    op=req['operation']
    if op=='decode':
        data=base64.b64decode(req['data'],validate=True)
        if req['name'].lower().endswith('.zip'):
            return {'type':'zip','members':unpack(data)}
        if req['name'].lower().endswith(('.txt','.csv','.ics','.json')):
            return {'type':'text','pages':[{'page':1,'text':data.decode('utf-8-sig'),'method':'text','confidence':None}]}
        return decode(data,req['name'],req['tessdata'],req.get('grid'))
    if op=='validate':
        return validate(req['forms'])
    if op=='pdf':
        return {'data':base64.b64encode(pdf(req['title'],req['lines'])).decode()}
    if op=='ozp_pdf':
        return {'data':base64.b64encode(ozp_pdf(req['fields'])).decode()}
    if op=='pdf_pages':
        from pypdf import PdfReader
        return {'pages':len(PdfReader(io.BytesIO(base64.b64decode(req['data'],validate=True))).pages)}
    if op=='preview':
        from PIL import Image, ImageOps
        import pillow_heif
        pillow_heif.register_heif_opener()
        data=base64.b64decode(req['data'],validate=True)
        if data.startswith(b'%PDF-'):
            page=int(req.get('page',1))
            if page<1 or page>60: raise ValueError('PAGE_INVALID')
            raw=subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1600','-png','-'],input=data,capture_output=True,timeout=25,check=True).stdout
            im=Image.open(io.BytesIO(raw))
        else:
            Image.MAX_IMAGE_PIXELS=24_000_000
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
            if req.get('region'): im=im.crop(tuple(req['region']))
        im.thumbnail((1600,2000));out=io.BytesIO();im.convert('RGB').save(out,'PNG')
        return {'data':base64.b64encode(out.getvalue()).decode()}
    if op=='source_pdf':
        data=base64.b64decode(req['data'],validate=True)
        if len(data)>MAX_BYTES:
            raise ValueError('FILE_TOO_LARGE')
        if req['type']=='image':
            from PIL import Image, ImageOps
            import pillow_heif
            from reportlab.pdfgen import canvas
            from reportlab.lib.utils import ImageReader
            pillow_heif.register_heif_opener()
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB')
            if im.width*im.height>24_000_000:
                raise ValueError('IMAGE_TOO_LARGE')
            out=io.BytesIO();can=canvas.Canvas(out,pagesize=(595,842));scale=min(555/im.width,802/im.height)
            can.drawImage(ImageReader(im),20,842-20-im.height*scale,width=im.width*scale,height=im.height*scale);can.save();data=out.getvalue()
        elif req['type']=='text':
            data=pdf('Opis textového podkladu: '+req['name'],data.decode('utf-8-sig').splitlines())
        else:
            raise ValueError('EVIDENCE_FORMAT_UNSUPPORTED')
        return {'data':base64.b64encode(data).decode()}
    if op=='zip':
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            for entry in req['files']:
                p=PurePosixPath(entry['name'])
                if p.is_absolute() or '..' in p.parts or '\\' in entry['name']:
                    raise ValueError('ZIP_UNSAFE_PATH')
                z.writestr(entry['name'],base64.b64decode(entry['data'],validate=True))
        return {'data':base64.b64encode(out.getvalue()).decode()}
    raise ValueError('UNKNOWN_OPERATION')


if __name__=='__main__':
    try:
        req=json.loads(sys.stdin.buffer.read(150*1024*1024))
        print(json.dumps(main(req),ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__,'message':str(exc)[:1000]},ensure_ascii=False))
        sys.exit(2)
