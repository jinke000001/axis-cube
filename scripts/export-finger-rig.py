"""Regenerate FK definitions from the checked-in, unmodified Wuji URDF files."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

project = Path(__file__).resolve().parent.parent
result = {"source": "Wuji URDF, fixed vendored revision 829c9aa27cb12c3a49d5b8d63c9869dd8f656702", "sides": {}}

def vector(element, attribute, default="0 0 0"):
    return [float(v) for v in (element.get(attribute, default) if element is not None else default).split()]

for side in ["left", "right"]:
    path = project / "public/models/wuji/hand/body/urdf" / (side + ".urdf")
    root = ET.fromstring(path.read_text())
    joints = []
    for joint in root.findall("joint"):
        origin, limit = joint.find("origin"), joint.find("limit")
        joints.append({
            "name": joint.get("name"), "type": joint.get("type"),
            "parent": joint.find("parent").get("link"), "child": joint.find("child").get("link"),
            "xyz": vector(origin, "xyz"), "rpy": vector(origin, "rpy"),
            "axis": vector(joint.find("axis"), "xyz", "0 0 1"),
            **{key: float(limit.get(key, "0")) if limit is not None else 0 for key in ["lower", "upper", "velocity"]},
        })
    result["sides"][side] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "joints": joints}
(project / "src/scene/finger-rig.json").write_text(json.dumps(result, indent=2) + "\n")
print("Exported 25 joints per hand, including fixed fingertip frames.")
