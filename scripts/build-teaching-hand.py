"""AXIS teaching hand: rigid links with an explicit MCP/PIP/DIP hierarchy.

The joint empties, lengths, and art/teaching-hand/rig.json are the collision
contract used by the CFOP demonstrator. Do not retune those numbers to chase a
look. This builder only replaces the visible skin: a matte warm-white rounded
shell, charcoal knuckle balls, and black fingertips, in the spirit of the
earlier AXIS Studio "MUJI HAND" dual-arm study.

Visible shafts are oval capsules inscribed in the authored link boxes, and
they stop where they meet the knuckle spheres. They stay inside the geometry
audit's outer warning radius. The palm keeps the audited front face and adds a
back-of-hand bulge away from the finger mounts so the silhouette reads as a
soft hand rather than a titanium slab.
"""
import bpy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'teaching-hand'
PUB = ROOT / 'public' / 'models' / 'teaching-hand'
SRC.mkdir(parents=True, exist_ok=True)
PUB.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def mat(name, rgb, metallic, roughness, specular):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    spec = bsdf.inputs.get('Specular IOR Level')
    if spec is not None:
        spec.default_value = specular
    return m

# Linear RGB. Displayed result is a warm off-white, close to the studio reference.
shell = mat('AXIS | muji shell', (0.78, 0.755, 0.70), 0.02, 0.55, 0.18)
knuckle = mat('AXIS | soft knuckle', (0.012, 0.013, 0.015), 0.08, 0.42, 0.18)
pad = mat('AXIS | soft fingertip', (0.008, 0.008, 0.009), 0.0, 0.74, 0.08)

# The mesh and independent geometric audit consume this same authored spec.
# Values are the collision contract; visual code below must not rewrite them.
geometry = {
 'linkWidths': [.0075, .0075, .006], 'linkDepths': [.0065, .0065, .0065],
 'linkEndInset': .002, 'linkBevel': .0012,
 'mcpMountRadius': .0025, 'mcpMountLength': .008, 'mcpMountRadialSegments': 16,
 'jointRadii': [.0045, .0037, .0037], 'padRadius': .0032,
 'uvSphereSegments': 12, 'uvSphereRings': 8,
 'inlayDepthOffset': .0035, 'inlayDepth': .0006,
 'palmInlayOffsetRight': [.0085, .001, .006], 'palmInlaySize': [.001, .033, .002], 'palmInlayBevel': .0003,
 'palmSize': [.016, .061, .043], 'palmBevel': .003,
 'palmInnerSize': [.002, .047, .032], 'palmInnerOffset': .0065, 'palmInnerBevel': .001,
 'armHousingWidth': .021, 'armHousingDepth': .023, 'armEndInset': .0075, 'armHousingBevel': .004,
 'armBearingRadius': .014, 'wristCouplerRadius': .012,
}


def shade(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def apply_xform(obj, location=False, rotation=False, scale=False):
    activate(obj)
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)

def empty(name, parent=None, pos=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = pos
    return obj

def fuse(obj, voxel):
    mod = obj.modifiers.new('Soft fuse', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.use_smooth_shade = True
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    shade(obj)

def join_at_origin(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    apply_xform(obj, location=True, rotation=True, scale=True)
    return obj

def uv_sphere(name, radius, location, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    return obj

def assign(obj, material, parent):
    obj.data.materials.append(material)
    obj.parent = parent
    obj.matrix_parent_inverse.identity()
    shade(obj)
    return obj

def outer_link_radius(index):
    """Diagonal warning radius already used by the geometry audit for this shaft."""
    half_w = geometry['linkWidths'][index] / 2
    half_d = geometry['linkDepths'][index] / 2
    depth = half_d
    if index < 2:
        depth = max(depth, geometry['inlayDepthOffset'] + geometry['inlayDepth'] / 2)
    return math.hypot(half_w, depth)

def joint_band(name, parent, radius, length, material):
    """Short collar. A full sphere at the authored joint radius reads as a bead, not skin."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=length, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = -math.pi / 2
    apply_xform(obj, rotation=True)
    return assign(obj, material, parent)

def soft_ellipsoid(name, parent, y0, y1, radius, material):
    """Belly of a phalanx. Ends pinch so the joint reads as a crease, not a pipe coupling."""
    length = max(y1 - y0, radius * 1.4)
    mid = (y0 + y1) * 0.5
    obj = uv_sphere(name, 1.0, (0, mid, 0), 36, 22)
    obj.scale = (radius, length / 2, radius * 0.92)
    apply_xform(obj, scale=True)
    return assign(obj, material, parent)

def soft_segment(name, parent, y0, y1, radius, scale_xz, material, voxel):
    """Oval capsule along parent +Y, from y0 to y1, including rounded ends."""
    length = y1 - y0
    if length <= radius * 1.15:
        center = (y0 + y1) * 0.5
        obj = uv_sphere(name, max(length * 0.5, 0.001), (0, center, 0))
        obj.scale = (scale_xz[0], 1, scale_xz[1])
        apply_xform(obj, scale=True)
    else:
        body = max(length - 2 * radius, 0.0004)
        bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=radius, depth=body, location=(0, y0 + radius + body / 2, 0))
        cyl = bpy.context.object
        cyl.rotation_euler[0] = -math.pi / 2
        apply_xform(cyl, rotation=True)
        near = uv_sphere(name + '_near', radius, (0, y0 + radius, 0), 28, 14)
        far = uv_sphere(name + '_far', radius, (0, y1 - radius, 0), 28, 14)
        obj = join_at_origin([cyl, near, far], name)
        obj.scale = (scale_xz[0], 1, scale_xz[1])
        apply_xform(obj, scale=True)
        # Remesh swells about half a voxel. The shaft was inset to the knuckle,
        # and the voxel is small next to the audited outer radius.
        fuse(obj, voxel)
    return assign(obj, material, parent)

def cylinder_x(name, parent, center, length, radius, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=geometry['mcpMountRadialSegments'], radius=radius, depth=length)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[1] = math.pi / 2
    apply_xform(obj, rotation=True)
    obj.location = center
    return assign(obj, material, parent)

def rounded_palm(name, parent, size, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    apply_xform(obj, scale=True)
    mod = obj.modifiers.new('Round palm', 'BEVEL')
    mod.width = bevel
    mod.segments = 5
    mod.affect = 'EDGES'
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(50)
    mod.use_clamp_overlap = True
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    shade(obj)
    obj.parent = parent
    obj.matrix_parent_inverse.identity()
    return obj

def ellipsoid(name, location, radii, segments=32):
    obj = uv_sphere(name, 1.0, location, segments, segments // 2)
    obj.scale = radii
    apply_xform(obj, location=False, scale=True)
    # apply_xform scale keeps location. Bake location into the mesh later via boolean.
    return obj

def bool_union(target, piece):
    mod = target.modifiers.new('union', 'BOOLEAN')
    mod.operation = 'UNION'
    mod.object = piece
    mod.solver = 'EXACT'
    activate(target)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(piece, do_unlink=True)
    shade(target)

lengths = [.045, .040, .019]
arm_lengths = [.20, .19]
wrist_attachment = [0, -.029, .012]
bases = {
 'thumb': [-.014, -.016, .021],
 'index': [-.014, .022, -.014],
 'middle': [-.014, .007, -.019],
 'ring': [-.014, -.009, -.018],
 'little': [-.014, -.024, -.012],
}
root = empty('axis_teaching_hands')
for side, sign in [('left', -1), ('right', 1)]:
    palm = empty(side + '_palm', root)
    shell_mesh = rounded_palm(side + '_palm_shell', palm, geometry['palmSize'], 0.0052)
    shell_mesh.data.materials.append(shell)
    # Back of the hand is opposite the finger mounts. Right-hand mounts sit on -X.
    back = ellipsoid(side + '_palm_back', (sign * 0.0075, 0.0, 0.0), (0.011, 0.024, 0.016))
    heel = ellipsoid(side + '_palm_heel', (sign * 0.002, -0.020, 0.004), (0.009, 0.013, 0.011))
    bool_union(shell_mesh, back)
    bool_union(shell_mesh, heel)
    fuse(shell_mesh, 0.0015)
    for finger, base in bases.items():
        base = [base[0] * sign, base[1], base[2]]
        mount_center = (base[0] + sign * geometry['mcpMountLength'] / 2, base[1], base[2])
        cylinder_x(side + '_' + finger + '_mount', palm, mount_center, geometry['mcpMountLength'], geometry['mcpMountRadius'], shell)
        mcp = empty(side + '_' + finger + '_mcp', palm, base)
        nodes = [mcp]
        nodes.append(empty(side + '_' + finger + '_pip', nodes[-1], (0, lengths[0], 0)))
        nodes.append(empty(side + '_' + finger + '_dip', nodes[-1], (0, lengths[1], 0)))
        for i, (node, length) in enumerate(zip(nodes, lengths)):
            # Plump the visible finger toward the audit's outer capsule. The old
            # box faces were the thin titanium look; staying under this radius
            # keeps the skin inside the existing "possible overlap" envelope.
            radius = outer_link_radius(i) * (0.88 if finger != 'thumb' else 0.94)
            inset = max(0.0016, length * 0.06)
            y0 = inset
            y1 = length - inset
            joint_band(
                side + '_' + finger + '_hinge_' + str(i), node,
                radius * 0.62, min(0.0028, length * 0.22), knuckle,
            )
            soft_ellipsoid(side + '_' + finger + '_link_' + str(i), node, y0, y1, radius, shell)
        tip = empty(side + '_' + finger + '_tip', nodes[-1], (0, lengths[2], 0))
        # Black cap is the visible fingertip. It is slightly larger than the
        # audited 3.2 mm pad so it finishes the thicker distal shaft.
        tip_radius = outer_link_radius(2) * 0.78
        uv_sphere(side + '_' + finger + '_pad', tip_radius, (0, tip_radius * 0.35, 0), 28, 14)
        assign(bpy.context.object, pad, tip)
    shoulder = empty(side + '_shoulder', root)
    elbow = empty(side + '_elbow', shoulder, (0, arm_lengths[0], 0))
    # Round tube inside the audit's diagonal arm capsule, not the flat housing box.
    arm_outer = math.hypot(geometry['armHousingWidth'] / 2, geometry['armHousingDepth'] / 2)
    arm_r = arm_outer * 0.74
    band_r = arm_r * 1.06
    for name, node, length in [('upper', shoulder, arm_lengths[0]), ('forearm', elbow, arm_lengths[1])]:
        joint_band(side + '_' + name + '_bearing', node, band_r, 0.012, knuckle)
        inset = band_r * 0.55
        soft_segment(side + '_' + name + '_housing', node, inset, length - inset, arm_r, (1, 1), shell, 0.0018)
    uv_sphere(side + '_wrist_coupler', band_r, wrist_attachment, 32, 16)
    assign(bpy.context.object, knuckle, palm)

bpy.context.scene['axis_teaching_rig_version'] = 1
bpy.context.scene['units'] = 'metres; Y up'
bpy.context.scene['constraint'] = 'Rigid links only. Original pedagogical hand; no real robot claim.'
bpy.context.scene['visual'] = 'Warm-white rounded skin on the unchanged rigid teaching skeleton.'
bpy.ops.wm.save_as_mainfile(filepath=str(SRC / 'axis-teaching-hand.blend'))
bpy.ops.export_scene.gltf(
    filepath=str(PUB / 'axis-teaching-hand.glb'),
    export_format='GLB',
    export_yup=False,
    export_extras=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
rig_path = SRC / 'rig.json'
authored = {
    'version': 1, 'units': 'metres', 'linkLengths': lengths, 'baseOffsetsRight': bases,
    'joints': ['mcp', 'pip', 'dip'], 'fingertipRadius': geometry['padRadius'], 'geometry': geometry,
    'armLengths': arm_lengths, 'wristAttachment': wrist_attachment,
    'runtime': 'Three.js rigid node transforms; no mesh deformation or runtime link scaling',
}
# Pretty-print only when the file is missing. A visual rebuild must not touch the
# hashed collision contract, including key order and whitespace.
if rig_path.exists():
    existing = json.loads(rig_path.read_text())
    if existing != authored:
        raise SystemExit('rig.json collision contract changed; visual rebuild must not alter it')
else:
    rig_path.write_text(json.dumps(authored, indent=2))
print('AXIS teaching asset written:', PUB / 'axis-teaching-hand.glb')
