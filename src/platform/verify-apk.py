"""Verify packaged frozen web assets and exclude private signing material."""
import hashlib
import json
import os
import pathlib
import re
import sys
import zipfile

apk = pathlib.Path(sys.argv[1])
candidate = json.loads(pathlib.Path(sys.argv[2]).read_text())
if candidate.get("schema") != 1 or not isinstance(candidate.get("files"), dict) or "index.html" not in candidate["files"]:
    raise SystemExit("Invalid frozen candidate manifest.")
for path, digest in candidate["files"].items():
    if not path or path.startswith("/") or "\\" in path or "\0" in path or any(part in ("", ".", "..") for part in path.split("/")) or not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest):
        raise SystemExit("Invalid candidate asset path or hash.")
manifest_digest = hashlib.sha256(json.dumps(candidate["files"], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
if manifest_digest != candidate.get("digest"):
    raise SystemExit("Candidate file manifest does not match its digest.")
private_key = pathlib.Path(sys.argv[3]).read_bytes()
secret = os.environ["AXIS_VERIFY_SIGNING_PASSWORD"].encode()
private_hash = hashlib.sha256(private_key).digest()
with zipfile.ZipFile(apk) as archive:
    empty_digest = hashlib.sha256(b"").hexdigest()
    allowed_generated = {"cordova.js": empty_digest, "cordova_plugins.js": empty_digest}
    public_names = [name for name in archive.namelist() if name.startswith("assets/public/") and not name.endswith("/")]
    if len(public_names) != len(set(public_names)):
        raise SystemExit("Duplicate public assets were detected in the APK.")
    for name in public_names:
        path = name[len("assets/public/"):]
        if path not in candidate["files"] and allowed_generated.get(path) != hashlib.sha256(archive.read(name)).hexdigest():
            raise SystemExit("Unexpected public asset was detected in the APK.")
    for path, expected in candidate["files"].items():
        value = archive.read("assets/public/" + path.replace("\\", "/"))
        if hashlib.sha256(value).hexdigest() != expected:
            raise SystemExit("Packaged web assets differ from the frozen candidate.")
    for name in archive.namelist():
        if name.endswith("/"):
            continue
        value = archive.read(name)
        if secret in value or hashlib.sha256(value).digest() == private_hash or name.lower().endswith((".p12", ".jks", ".keystore", "/credentials.json")):
            raise SystemExit("Private signing material was detected in the APK; do not distribute it.")
print(json.dumps({"frozenAssetsVerified": len(candidate["files"]), "privateSigningMaterialFound": False}))
