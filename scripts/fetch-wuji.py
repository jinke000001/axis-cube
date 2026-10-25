"""Fetch the pinned MIT hand assets; validate Git blob hashes before saving."""
import concurrent.futures, hashlib, json, pathlib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'scripts/wuji-manifest.json').read_text())
def fetch(item):
    path = item['path']
    target = ROOT / 'public/models/wuji' / path
    def valid(data):
        return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == item['sha']
    if target.exists() and valid(target.read_bytes()):
        return
    url = f"https://raw.githubusercontent.com/{manifest['repository']}/{manifest['commit']}/{path}"
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read()
    if not valid(data):
        raise ValueError(f'Hash mismatch: {path}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(fetch, manifest['files']))
print(f"Verified {len(manifest['files'])} assets at {manifest['commit']}")
