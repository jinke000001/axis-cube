"""Strip calibration diagnostics while retaining exact, measured trajectories."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
roles_path = root / "evidence/finger-role-strokes.json"
carry_path = root / "evidence/finger-wrist-base-stable-carries.json"
roles = json.loads(roles_path.read_text())
carriers = json.loads(carry_path.read_text())
grips = json.loads((root / "src/scene/finger-grips.json").read_text())

def contact(c):
    return dict(finger=c["finger"], point=c["cubeLocalPoint"] if "cubeLocalPoint" in c else [c["target"][0], c["target"][1] - .34, c["target"][2]],
                normal=c["normal"], padOffset=c.get("padOffset", c.get("padLocalOffset")))

def pose(p):
    return {key:p[key] for key in ("position", "quaternion", "joints")}

library = {"version":1, "provenance":[{"path":str(path.relative_to(root)), "sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for path in [roles_path, carry_path]], "hands":{}, "strokes":{}, "carries":{}}
for hand in roles["hands"]:
    side = hand["side"]
    g = grips["hands"][side]
    library["hands"][side] = {
        "support":pose(hand["supportPose"]),
        "contacts":[contact(c) for c in hand["supportPose"]["contacts"]],
        "active":pose(hand["activePose"]),
        "freeAngles":hand["freeAngles"],
        "grip":{"position":g["position"], "quaternion":g["quaternion"], "joints":{f"{side}_finger{f['finger']}_joint{j+1}":a for f in g["fingers"] for j,a in enumerate(f["angles"])}},
        "gripContacts":[contact(c) for c in g["fingers"]],
    }
for stroke in roles["strokes"]:
    if max(stroke["validation"][k] for k in ["maxCubeDepthMM","maxSupportErrorMM","maxActiveErrorMM","maxExportedPadInterpolationErrorMM","maxSelfContainmentMM"]) > .3:
        raise ValueError("Unaccepted stroke")
    library["strokes"][stroke["id"]] = {
        "side":stroke["side"], "finger":stroke["finger"],
        "samples":[{key:sample[key] for key in ["phase","angle","angles","target","normal","padLocalOffset"]} for sample in stroke["samples"]],
        "hover": {h["end"]:{key:h[key] for key in ["angles","posePass"]} for h in stroke["hover"]},
    }
for carry in carriers["carries"]:
    if not carry["passed"] or not carry["hold"]["supportGatePassed"]:
        raise ValueError("Unaccepted carry")
    side = carry["side"]
    library["carries"][side] = {
        "angle":carry["worldDegrees"]*3.141592653589793/180,
        "withdrawal":[pose(frame[side]) for frame in carry["withdrawal"]["releaseFrames"]],
        "relocation":[pose(frame[side]) for frame in carry["relocation"]["frames"]],
        "hold":pose(carry["hold"]["pose"]),
        "contacts":[contact(c) for c in carry["hold"]["supportContacts"]],
    }
output = root / "src/scene/finger-library.json"
output.write_text(json.dumps(library,separators=(",",":"))+"\n")
print(f"{output.relative_to(root)}: {output.stat().st_size} bytes")

# Rigidly transformed U strokes with independently accepted low-grip entries.
# Keep only exact pose tables; the source files retain meshes and diagnostics.
direct = {"faces":{}, "provenance":[]}
for face, name in [("F", "front"), ("B", "back"), ("D", "down")]:
    source = root / f"evidence/finger-{name}-primitives.json"
    if not source.exists():
        continue
    primitive = json.loads(source.read_text())
    for case in primitive["cases"]:
        proof = root / case["evidence"]
        if hashlib.sha256(proof.read_bytes()).hexdigest() != case["evidenceSHA256"]:
            raise ValueError(f"Changed direct finger proof: {proof}")
        if not json.loads(proof.read_text())["passed"]:
            raise ValueError(f"Unaccepted direct finger path: {proof}")
    direct["provenance"].append({"path":str(source.relative_to(root)),"sha256":hashlib.sha256(source.read_bytes()).hexdigest()})
    direct["faces"][face] = {"rotation":primitive["rotation"],"hands":{}}
    for side, hand in primitive["hands"].items():
        direct["faces"][face]["hands"][side] = {
            "rotation":hand.get("rotation", primitive["rotation"]),
            "support":hand["support"],
            "supportEntry":[group["poses"] for group in hand["supportEntry"]],
            "activeEntry":[group["poses"] for group in hand["activeEntry"]],
        }
output = root / "src/scene/finger-direct.json"
output.write_text(json.dumps(direct,separators=(",",":"))+"\n")
print(f"{output.relative_to(root)}: {output.stat().st_size} bytes")

rotation_path = root / "evidence/finger-whole-x-primitives.json"
rotation = json.loads(rotation_path.read_text())
if not rotation["passed"]:
    raise ValueError("Unaccepted whole-cube rotation")
rotation_library = {"sourceSHA256":hashlib.sha256(rotation_path.read_bytes()).hexdigest(),"primitives":{}}
for key, primitive in rotation["primitives"].items():
    if not primitive["passed"]:
        raise ValueError("Unaccepted rotation primitive")
    rotation_library["primitives"][primitive["notation"]] = [{
        "id":segment["id"],
        "frames":[{key:frame[key] for key in ["left","right","contacts","cubeAngle","turning"]} for frame in segment["frames"]]
    } for segment in primitive["segments"]]
output=root/"src/scene/finger-rotations.json"
output.write_text(json.dumps(rotation_library,separators=(",",":"))+"\n")
print(f"{output.relative_to(root)}: {output.stat().st_size} bytes")

faces_path = root / "evidence/finger-face-primitives.json"
face_paths = root / "evidence/finger-face-transitions.json"
faces = json.loads(faces_path.read_text())
transfers = json.loads(face_paths.read_text())
compact_path=root/"evidence/finger-face-compact-transitions.json"
compact_transfers=json.loads(compact_path.read_text())
face_library = {"provenance":[{"path":str(path.relative_to(root)),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for path in [faces_path,face_paths]], "primitives":{},"entries":{}}
def full_contact(c):
    return {"side":c["side"],"role":c["role"],**contact(c)}
def motion_frames(frames):
    return [{"left":pose(f["left"]),"right":pose(f["right"]),"contacts":[full_contact(c) for c in f["supportContacts"]]} for f in frames]
for entry in transfers["results"]:
    if not entry["passed"] or not entry["selected"]["interpolation"]["passed"]:
        raise ValueError("Unaccepted face entry")
    face_library["entries"][entry["id"]] = {
        "frames":motion_frames(entry["selected"]["frames"]),
        "order":entry["selected"]["order"],
    }
    compact=next(e for e in compact_transfers["results"] if e["id"]==entry["id"])
    if not compact["passed"] or not compact["selected"]["interpolation"]["passed"]:
        raise ValueError("Unaccepted compact face entry")
    face_library["entries"][entry["id"]]={"frames":motion_frames(compact["selected"]["frames"]),"order":compact["selected"]["order"]}
face_library["provenance"].append({"path":str(compact_path.relative_to(root)),"sha256":hashlib.sha256(compact_path.read_bytes()).hexdigest()})
for primitive in faces["primitives"]:
    regrip = transfers["regrips"][primitive["id"]]
    if not regrip["passed"] or not regrip["selected"]["interpolation"]["passed"]:
        raise ValueError("Unaccepted face regrip")
    key = primitive["face"] + ("'" if primitive["turnRadians"]>0 else "")
    entry = next(e for e in transfers["results"] if key.replace("'","Prime") in e["faces"] and all(sum((a-b)**2 for a,b in zip(primitive["initial"][s]["position"],e["target"][s]["position"])) < 1e-12 for s in ["left","right"]))
    face_library["primitives"][key] = {
        "active":primitive["active"], "normal":primitive["normal"], "angle":primitive["turnRadians"], "initial":primitive["initial"],
        "contacts":[full_contact(c) for c in primitive["contacts"]], "entry":entry["id"],
        "regrip":motion_frames(regrip["selected"]["frames"]),
    }
output=root/"src/scene/finger-faces.json"
output.write_text(json.dumps(face_library,separators=(",",":"))+"\n")
print(f"{output.relative_to(root)}: {output.stat().st_size} bytes")

transition_path = root / "evidence/finger-role-transitions.json"
transition = json.loads(transition_path.read_text())
if not transition["passed"]:
    raise ValueError("Unaccepted role transitions")
paths = {"sourceSHA256":hashlib.sha256(transition_path.read_bytes()).hexdigest(),"roles":{},"strokes":{}}
def path_frames(side, ids):
    return [[pose(f[side]) for f in transition["segments"][id]["frames"]] for id in ids]
for side in ["left","right"]:
    paths["roles"][side] = path_frames(side,[f"{side}-role-{part}" for part in ["retreat","rise-open","enter-high"]])
    for name in ["index","middle"]:
        id=f"{side}-{name}"
        release=["release-hover","release-free"] if name=="index" else ["release-lift-wrist","release-free-raised","release-lower-wrist"]
        paths["strokes"][id]={
            "prepare":path_frames(side,[f"{id}-prepare-hover",f"{id}-seat"]),
            "release":path_frames(side,[f"{id}-{part}" for part in release]),
        }
        if name=="index":
            paths["strokes"][id]["overlapTurn"] = path_frames(side,[f"{id}-turn-prepare-middle"])[0]
            paths["strokes"][id]["overlapRelease"] = path_frames(side,[f"{id}-release-hover-middle-ready",f"{id}-release-free-middle-ready"])
output = root / "src/scene/finger-paths.json"
output.write_text(json.dumps(paths,separators=(",",":"))+"\n")
print(f"{output.relative_to(root)}: {output.stat().st_size} bytes")
