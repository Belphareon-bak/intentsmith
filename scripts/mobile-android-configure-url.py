#!/usr/bin/env python3
"""Zapíše adresu gateway do konfigurace Capacitoru a do síťové politiky Androidu.

Volá se z `scripts/mobile-android.sh` a existuje jako samostatný soubor
schválně: obě místa musí říkat totéž a rozejít se nesmějí.

  * `capacitor.config.json` → `server.url` říká, **kam** se aplikace připojí.
  * `network_security_config.xml` → seznam domén říká, kam smí **bez TLS**.

Kdyby se rozešly, aplikace by se tvářila, že se připojuje, a Android by jí to
mlčky zakázal — což je nejhorší druh selhání, protože nemá chybovou hlášku.
"""
import json
import os
import re
import sys

app_dir = os.environ['APP_DIR']
android_dir = os.environ['ANDROID_DIR']
url = os.environ['IS_URL']
host = os.environ['IS_HOST']

config_path = os.path.join(app_dir, 'capacitor.config.json')
with open(config_path, encoding='utf-8') as handle:
    config = json.load(handle)
config.setdefault('server', {})['url'] = url
with open(config_path, 'w', encoding='utf-8') as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write('\n')

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
domains = sorted({'127.0.0.1', 'localhost', host})
rendered = ''.join(
    '\n        <domain includeSubdomains="false">%s</domain>' % domain
    for domain in domains)

xml = xml[:block.start(2)] + rendered + xml[block.end(2):]
with open(policy_path, 'w', encoding='utf-8') as handle:
    handle.write(xml)

print('  · %s → capacitor.config.json + network_security_config.xml' % url)
