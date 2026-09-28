#!/usr/bin/env bash
# Explicit operator installation; the updater only reports releases.
# Requires root authentication. Keeps the previous service configuration for rollback.
set -euo pipefail
[[ $# == 2 && $EUID == 0 ]] || { echo 'Usage (as root): install-ollama-evaluation-provider.sh PATCHED_BINARY UPSTREAM_ARCHIVE' >&2; exit 2; }
provider_binary=$(realpath -- "$1")
provider_archive=$(realpath -- "$2")
printf '%s  %s\n' 2b98fceffbc6d5d97a6e96ddfd46c597cee4fa06a03d740fdb74dd9a34ff0f92 "$provider_binary" | sha256sum --check
printf '%s  %s\n' e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b "$provider_archive" | sha256sum --check
[[ $(uname -m) == x86_64 ]] || exit 2
python3 - <<'PY'
import json,urllib.request,subprocess
r=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/ps', timeout=5))
assert r['models']==[], 'Ollama is busy; retry after interactive work finishes'
p=subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader,nounits'],text=True)
assert not p.strip(), 'GPU has active compute work'
PY
install -d -m 755 /opt/intentsmith/ollama
provider_destination=/opt/intentsmith/ollama/0.34.2-intentsmith.1
[[ ! -e "$provider_destination" ]] || { echo 'Destination already exists; inspect it before retrying.' >&2; exit 1; }
provider_staging=$(mktemp -d /opt/intentsmith/ollama/.install-XXXXXX)
provider_dropin=/etc/systemd/system/ollama.service.d/50-intentsmith-response-digest.conf
[[ -f "$provider_dropin" ]] || { echo 'Expected previous response-digest drop-in is missing.' >&2; exit 1; }
cp -- "$provider_dropin" "$provider_staging/previous-service.conf"
cp -a -- /usr/local/bin/ollama "$provider_staging/previous-client"
rollback() {
  local result=$?
  if [[ -f "$provider_destination/previous-service.conf" ]]; then
    cp -- "$provider_destination/previous-service.conf" "$provider_dropin"
    cp -a --remove-destination -- "$provider_destination/previous-client" /usr/local/bin/ollama
    systemctl daemon-reload
    systemctl restart ollama.service
  fi
  echo "Installation failed; previous provider configuration restored (exit $result)." >&2
  exit "$result"
}
trap rollback ERR
tar --zstd --no-same-owner -xf "$provider_archive" -C "$provider_staging"
install -m 755 -- "$provider_binary" "$provider_staging/bin/ollama"
chown -R root:root "$provider_staging"
chmod 755 "$provider_staging"
mv -- "$provider_staging" "$provider_destination"
cat > "$provider_dropin" <<'CONFIG'
[Service]
ExecStart=
ExecStart=/opt/intentsmith/ollama/0.34.2-intentsmith.1/bin/ollama serve
Environment="OLLAMA_HOST=127.0.0.1:11434"
CONFIG
systemctl daemon-reload
systemctl restart ollama.service
python3 - <<'PY'
import json,urllib.request,time
base='http://127.0.0.1:11434'
for i in range(60):
 try:
  version=json.load(urllib.request.urlopen(base+'/api/version',timeout=2))['version']
  break
 except Exception:
  if i==59: raise
  time.sleep(.5)
assert version=='0.34.2-intentsmith.1',version
models=json.load(urllib.request.urlopen(base+'/api/tags',timeout=5))['models']
assert models, 'Existing model inventory disappeared'
m=models[0]
req=urllib.request.Request(base+'/api/chat',data=json.dumps({'model':m['name'],'messages':[],'keep_alive':0,'stream':False}).encode(),headers={'Content-Type':'application/json'})
r=json.load(urllib.request.urlopen(req,timeout=10))
assert r['digest'].removeprefix('sha256:')==m['digest'].removeprefix('sha256:')
assert r['provider_version']==version
print(json.dumps({'status':'INSTALLED','providerVersion':version,'digestProof':'PASS','inventoryCount':len(models)}))
PY
ln -sfn -- "$provider_destination/bin/ollama" /usr/local/bin/ollama
trap - ERR
printf 'Rollback: restore %s/previous-service.conf to %s, daemon-reload, restart ollama.service\n' "$provider_destination" "$provider_dropin"
