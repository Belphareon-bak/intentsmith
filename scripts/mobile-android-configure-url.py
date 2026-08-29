#!/usr/bin/env python3
"""Zapíše adresu gateway do vygenerovaného assetu a síťové politiky Androidu.

Volá se z `scripts/mobile-android.sh` a existuje jako samostatný soubor
schválně: obě místa musí říkat totéž a rozejít se nesmějí.

  * `assets/public/runtime-config.js` říká, **kam** API klient míří.
  * `network_security_config.xml` → seznam domén říká, kam smí **bez TLS**.

Kdyby se rozešly, aplikace by se tvářila, že se připojuje, a Android by jí to
mlčky zakázal — což je nejhorší druh selhání, protože nemá chybovou hlášku.
"""
import json
import os
import re
import sys
from urllib.parse import urlsplit

app_dir = os.environ['APP_DIR']
android_dir = os.environ['ANDROID_DIR']
url = os.environ['IS_URL']
parsed = urlsplit(url)
if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
        or parsed.username or parsed.password or parsed.query or parsed.fragment
        or parsed.path not in {'', '/'}):
    sys.exit('gateway URL musí být čistý http(s) origin bez credentials/path/query/fragment')
if parsed.hostname in {'0.0.0.0', '::'}:
    sys.exit('gateway URL nesmí používat wildcard adresu')
host = parsed.hostname

runtime_path = os.path.join(
    android_dir, 'app/src/main/assets/public/runtime-config.js')
if not os.path.isfile(runtime_path):
    sys.exit('chybí vygenerované assets/public; spusť nejdřív `cap sync android`')
with open(runtime_path, 'w', encoding='utf-8') as handle:
    handle.write('// Generated for this Android artifact; do not edit.\n')
    handle.write('globalThis.IntentSmithRuntimeConfig = Object.freeze({\n')
    handle.write('  gatewayUrl: %s,\n' % json.dumps(url, ensure_ascii=False))
    handle.write("  transportMode: 'legacy-m1-dev',\n")
    handle.write('  remoteCore: Object.freeze({\n')
    handle.write("    descriptorDigest: 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',\n")
    handle.write("    adapterManifestDigest: 'sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52',\n")
    handle.write('  }),\n')
    handle.write('});\n')

# The reviewed source CSP is deliberately broad enough for the browser/PWA
# development server.  A signed Android artifact has one build-pinned gateway,
# so its generated HTML must permit exactly that origin rather than every
# HTTPS host.  This is a generated asset; the tracked source stays immutable.
index_path = os.path.join(android_dir, 'app/src/main/assets/public/index.html')
if not os.path.isfile(index_path):
    sys.exit('chybí vygenerované assets/public/index.html')
with open(index_path, encoding='utf-8') as handle:
    index_html = handle.read()
connect_pattern = r"connect-src\s+[^;\"]+"
if len(re.findall(connect_pattern, index_html)) != 1:
    sys.exit('index.html nemá právě jednu očekávanou connect-src CSP direktivu')
connect_directive = "connect-src 'self' %s" % url.rstrip('/')
index_html = re.sub(connect_pattern, connect_directive, index_html, count=1)
with open(index_path, 'w', encoding='utf-8') as handle:
    handle.write(index_html)

policy_path = os.path.join(android_dir, 'app/src/main/res/xml/network_security_config.xml')
with open(policy_path, encoding='utf-8') as handle:
    xml = handle.read()

block = re.search(
    r'(<domain-config cleartextTrafficPermitted="true">)(.*?)(\s*</domain-config>)',
    xml, re.S)
if not block:
    sys.exit('network_security_config.xml nemá očekávaný domain-config blok')

# Loopback zůstává vždy — build s VPN adresou nesmí rozbít kabel, protože
# telefon se k němu vrací pokaždé, když tunel spadne.
domains = {'127.0.0.1', 'localhost'}
if parsed.scheme == 'http':
    domains.add(host)
rendered = ''.join(
    '\n        <domain includeSubdomains="false">%s</domain>' % domain
    for domain in sorted(domains))

xml = xml[:block.start(2)] + rendered + xml[block.end(2):]
with open(policy_path, 'w', encoding='utf-8') as handle:
    handle.write(xml)

print('  · %s → generated runtime-config.js + exact CSP + network_security_config.xml' % url)
