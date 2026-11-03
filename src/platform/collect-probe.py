"""Read only AXIS's capability report from a simulator app container."""
import argparse
import json
import os
import pathlib
import plistlib
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("platform", choices=("ios", "android"))
parser.add_argument("device")
parser.add_argument("output")
args = parser.parse_args()


def run(command):
    return subprocess.run(command, check=True, capture_output=True, timeout=20).stdout


if args.platform == "ios":
    container = pathlib.Path(run(["xcrun", "simctl", "get_app_container", args.device, "app.axis.cube", "data"]).decode().strip())
    with (container / "Library/Preferences/app.axis.cube.plist").open("rb") as source:
        values = plistlib.load(source)
    value = values["CapacitorStorage.axis.mobile.probe.result"]
else:
    sdk = pathlib.Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or pathlib.Path.home() / "Library/Caches/axis-mobile/android-sdk")
    source = run([str(sdk / "platform-tools/adb"), "-s", args.device, "exec-out", "run-as", "app.axis.cube.debug", "cat", "shared_prefs/CapacitorStorage.xml"])
    value = next(item.text for item in ET.fromstring(source) if item.get("name") == "axis.mobile.probe.result")

report = json.loads(value)
output = pathlib.Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"platform": report["platform"], "native": report["native"], "completed": report["completed"], "checks": {key: entry["status"] for key, entry in report["checks"].items()}, "output": str(output)}, ensure_ascii=False))
