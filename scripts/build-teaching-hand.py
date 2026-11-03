"""AXIS teaching hand: rigid links with an explicit MCP/PIP/DIP hierarchy.

This is an original pedagogical rig, not the Wuji hardware or a physical robot
execution model. Runtime rotates rigid nodes only; it never scales phalanges.
Authored Y-up and exported without an axis conversion for exact metre units.
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

def mat(name, rgb, metallic, roughness):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb,1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return m
metal=mat('AXIS | satin titanium',(.38,.43,.48),.83,.3)
joint=mat('AXIS | graphite hinges',(.025,.033,.044),.55,.42)
pad=mat('AXIS | soft contact pads',(.075,.09,.11),.12,.7)
accent=mat('AXIS | ice inlay',(.20,.63,.76),.5,.28)
# The mesh and independent geometric audit consume this same authored spec.
geometry = {
 'linkWidths': [.0075,.0075,.006], 'linkDepths': [.0065,.0065,.0065],
 'linkEndInset': .002, 'linkBevel': .0012,
 'mcpMountRadius': .0025, 'mcpMountLength': .008, 'mcpMountRadialSegments': 16,
 'jointRadii': [.0045,.0037,.0037], 'padRadius': .0032,
 'uvSphereSegments': 12, 'uvSphereRings': 8,
 'inlayDepthOffset': .0035, 'inlayDepth': .0006,
 'palmInlayOffsetRight': [.0085,.001,.006], 'palmInlaySize': [.001,.033,.002], 'palmInlayBevel': .0003,
 'palmSize': [.016,.061,.043], 'palmBevel': .003,
 'palmInnerSize': [.002,.047,.032], 'palmInnerOffset': .0065, 'palmInnerBevel': .001,
 'armHousingWidth': .021, 'armHousingDepth': .023, 'armEndInset': .0075, 'armHousingBevel': .004,
 'armBearingRadius': .014, 'wristCouplerRadius': .012,
}


def empty(name,parent=None,pos=(0,0,0)):
    obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj)
    obj.parent=parent;obj.location=pos;return obj
def box(name,parent,pos,size,material,bevel=.001):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj=bpy.context.object;obj.name=name;obj.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.parent=parent;obj.location=pos;obj.data.materials.append(material)
    if bevel:
        mod=obj.modifiers.new('Machined edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj
def sphere(name,parent,pos,radius,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=geometry['uvSphereSegments'],ring_count=geometry['uvSphereRings'],radius=radius)
    obj=bpy.context.object;obj.name=name;obj.parent=parent;obj.location=pos
    obj.data.materials.append(material)
    for poly in obj.data.polygons:poly.use_smooth=True
    return obj

def cylinder_x(name,parent,center,length,radius,material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=geometry['mcpMountRadialSegments'],radius=radius,depth=length)
    obj=bpy.context.object;obj.name=name;obj.rotation_euler[1]=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    obj.parent=parent;obj.location=center;obj.data.materials.append(material)
    return obj

lengths=[.045,.040,.019]
arm_lengths=[.20,.19]
wrist_attachment=[0,-.029,.012]
bases={
 'thumb':[-.014,-.016,.021],
 'index':[-.014,.022,-.014],
 'middle':[-.014,.007,-.019],
 'ring':[-.014,-.009,-.018],
 'little':[-.014,-.024,-.012],
}
root=empty('axis_teaching_hands')
for side,sign in [('left',-1),('right',1)]:
    palm=empty(side+'_palm',root)
    box(side+'_palm_shell',palm,(0,0,0),geometry['palmSize'],metal,geometry['palmBevel'])
    box(side+'_palm_inner',palm,(-sign*geometry['palmInnerOffset'],0,0),geometry['palmInnerSize'],joint,geometry['palmInnerBevel'])
    box(side+'_palm_inlay',palm,(sign*geometry['palmInlayOffsetRight'][0],*geometry['palmInlayOffsetRight'][1:]),geometry['palmInlaySize'],accent,geometry['palmInlayBevel'])
    for finger,base in bases.items():
        base=[base[0]*sign,base[1],base[2]]
        mount_center=(base[0]+sign*geometry['mcpMountLength']/2,base[1],base[2])
        cylinder_x(side+'_'+finger+'_mount',palm,mount_center,geometry['mcpMountLength'],geometry['mcpMountRadius'],joint)
        mcp=empty(side+'_'+finger+'_mcp',palm,base)
        nodes=[mcp]
        nodes.append(empty(side+'_'+finger+'_pip',nodes[-1],(0,lengths[0],0)))
        nodes.append(empty(side+'_'+finger+'_dip',nodes[-1],(0,lengths[1],0)))
        for i,(node,length) in enumerate(zip(nodes,lengths)):
            sphere(side+'_'+finger+'_hinge_'+str(i),node,(0,0,0),geometry['jointRadii'][i],joint)
            box(side+'_'+finger+'_link_'+str(i),node,(0,length/2,0),(geometry['linkWidths'][i],length-2*geometry['linkEndInset'],geometry['linkDepths'][i]),metal,geometry['linkBevel'])
            if i<2:box(side+'_'+finger+'_inlay_'+str(i),node,(0,length/2,geometry['inlayDepthOffset']),(.0015,length*.6,geometry['inlayDepth']),accent,.0002)
        tip=empty(side+'_'+finger+'_tip',nodes[-1],(0,lengths[2],0))
        sphere(side+'_'+finger+'_pad',tip,(0,0,0),geometry['padRadius'],pad)
    # Two rigid links supply the mechanical-arm silhouette. Runtime fits the
    # elbow to the wrist using fixed-length inverse kinematics.
    shoulder=empty(side+'_shoulder',root)
    elbow=empty(side+'_elbow',shoulder,(0,arm_lengths[0],0))
    for name,node,length in [('upper',shoulder,arm_lengths[0]),('forearm',elbow,arm_lengths[1])]:
        sphere(side+'_'+name+'_bearing',node,(0,0,0),geometry['armBearingRadius'],joint)
        box(side+'_'+name+'_housing',node,(0,length/2,0),(geometry['armHousingWidth'],length-2*geometry['armEndInset'],geometry['armHousingDepth']),metal,geometry['armHousingBevel'])
        box(side+'_'+name+'_inlay',node,(0,length/2,.012),(.003,length*.55,.001),accent,.0005)
    sphere(side+'_wrist_coupler',palm,wrist_attachment,geometry['wristCouplerRadius'],joint)

bpy.context.scene['axis_teaching_rig_version']=1
bpy.context.scene['units']='metres; Y up'
bpy.context.scene['constraint']='Rigid links only. Original pedagogical hand; no real robot claim.'
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'axis-teaching-hand.blend'))
bpy.ops.export_scene.gltf(filepath=str(PUB/'axis-teaching-hand.glb'),export_format='GLB',export_yup=False,
    export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
(SRC/'rig.json').write_text(json.dumps({'version':1,'units':'metres','linkLengths':lengths,'baseOffsetsRight':bases,
    'joints':['mcp','pip','dip'],'fingertipRadius':geometry['padRadius'],'geometry':geometry,'armLengths':arm_lengths,'wristAttachment':wrist_attachment,
    'runtime':'Three.js rigid node transforms; no mesh deformation or runtime link scaling'},indent=2))
print('AXIS teaching asset written:',PUB/'axis-teaching-hand.glb')
