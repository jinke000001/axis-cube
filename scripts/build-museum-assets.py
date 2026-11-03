"""Original AXIS gallery, generated in Blender. Run with Blender --background --python.

Meters; Blender Z-up exports as glTF Y-up. Pedestal tops sit at Y=-.04 in runtime.
The teaching cube and articulated hands are deliberately absent: the state engine owns them.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art" / "museum"
PUBLIC = ROOT / "public" / "models" / "museum"
EVIDENCE = ROOT / "evidence" / "museum-upgrade-2026-11-01" / "assets"
for directory in (SOURCE, PUBLIC, EVIDENCE):
    directory.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal=0, rough=.45, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Metallic'].default_value = metal
    node.inputs['Roughness'].default_value = rough
    if emission:
        node.inputs['Emission Color'].default_value = (*color, 1)
        node.inputs['Emission Strength'].default_value = emission
    return mat

graphite = material('AXIS | graphite ceramic', (.035, .042, .051), .3, .52)
floor = material('AXIS | exhibition floor', (.003, .0045, .006), .05, .85)
silver = material('AXIS | brushed titanium', (.32, .38, .42), .85, .34)
black = material('AXIS | recessed joints', (.009, .014, .019), .2, .5)
blue = material('AXIS | ice guidance inlay', (.20, .58, .72), .4, .34, .7)

def finish(obj, name, mat, bevel=0):
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new('Manufactured edge', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj

def box(name, pos, dimensions, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bevel)

def disk(name, x, y, z, radius, depth, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=(x, y, z))
    return finish(bpy.context.object, name, mat, .004)

def ring(name, x, y, z, radius, width, mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=6,
        location=(x, y, z), major_radius=radius, minor_radius=width)
    return finish(bpy.context.object, name, mat)

box('gallery | continuous floor', (0, 0, -.265), (13, 13, .05), floor)
# A 60 cm module and recessed joints give the camera movement a quiet spatial reference.
for line in range(-10, 11):
    value = line * .6
    box('floor | joint x %d' % line, (value, 0, -.238), (.003, 12, .002), black)
    box('floor | joint y %d' % line, (0, value, -.238), (12, .003, .002), black)

stations = [('entry', 0, 0), ('learn', 3.4, 0), ('library', 0, 3.4), ('solve', -3.4, 0)]
for name, x, y in stations:
    disk(name + ' | floating plinth', x, y, -.148, .55, .176, graphite)
    disk(name + ' | precision surface', x, y, -.05, .535, .02, black)
    ring(name + ' | machined lip', x, y, -.065, .544, .007, silver)
    ring(name + ' | guidance halo', x, y, -.227, .635, .006, blue)
    ring(name + ' | index circle', x, y, -.038, .49, .0018, silver)
    for segment in range(12):
        angle = segment * math.pi / 6
        part = box(name + ' | index %02d' % segment,
            (x + .48 * math.cos(angle), y + .48 * math.sin(angle), -.036),
            (.022, .003, .001), silver)
        part.rotation_euler[2] = angle
    for angle in (math.pi / 4, math.pi * .75, math.pi * 1.25, math.pi * 1.75):
        box(name + ' | isolator', (x + .35 * math.cos(angle), y + .35 * math.sin(angle), -.218),
            (.07, .07, .04), silver, .006)

# Thin floor tracers connect the exhibits without walls or large GPU textures.
box('wayfinding | east west', (0, 0, -.233), (6.8, .007, .004), blue)
box('wayfinding | north', (0, 1.7, -.233), (.007, 3.4, .004), blue)
for x in (-5.1, 5.1):
    for y in (-2.1, 4.8):
        box('architecture | column', (x, y, .7), (.06, .06, 1.86), graphite, .009)
        box('architecture | luminous seam', (x, y - .032, .76), (.006, .002, 1.55), blue)
for x in (-5.1, 5.1):
    box('architecture | ceiling rail', (x, 1.35, 1.62), (.07, 6.9, .08), graphite, .008)

# Export a batched copy (five material draws), while retaining editable source objects.
bpy.ops.object.select_all(action='DESELECT')
copies = []
for original in list(bpy.context.scene.objects):
    if original.type != 'MESH':
        continue
    duplicate = original.copy()
    duplicate.data = original.data.copy()
    bpy.context.collection.objects.link(duplicate)
    duplicate.select_set(True)
    copies.append(duplicate)
bpy.context.view_layer.objects.active = copies[0]
bpy.ops.object.join()
bpy.context.object.name = 'AXIS gallery | batched runtime geometry'
bpy.ops.export_scene.gltf(filepath=str(PUBLIC / 'axis-gallery.glb'), export_format='GLB',
    export_cameras=False, export_lights=False, use_selection=True,
    export_yup=True, export_materials='EXPORT')
bpy.ops.object.delete(use_global=False)

# Studio lighting and camera are retained in the editable source, not in the runtime GLB.
world = bpy.data.worlds.new('AXIS | dark studio')
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs[0].default_value = (.025, .035, .05, 1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .32
for name, pos, energy, size, color in [
    ('key', (0, -2, 5), 1400, 6, (.68, .82, 1)),
    ('rim', (3, 5, 4), 1500, 5, (.4, .7, 1)),
    ('fill', (-4, -1, 3), 900, 4, (1, 1, 1))]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy; data.shape = 'DISK'; data.size = size; data.color = color
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    obj.location = pos; obj.rotation_euler = (Vector((0, 1, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
data = bpy.data.cameras.new('Gallery overview')
camera = bpy.data.objects.new('Gallery overview', data)
bpy.context.collection.objects.link(camera)
camera.location = (8.1, -10.8, 8.5)
camera.rotation_euler = (Vector((0, 1.1, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
data.lens = 47
scene = bpy.context.scene
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 1600; scene.render.resolution_y = 1000; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(EVIDENCE / 'gallery-overview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'axis-gallery.blend'))
bpy.ops.render.render(write_still=True)
print('AXIS GLB bytes:', (PUBLIC / 'axis-gallery.glb').stat().st_size)
