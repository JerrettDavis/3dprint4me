"""Blender Cycles product studio. Run through Blender, not system Python.

blender --background --python scripts/render-products.py
Inputs: npm run products:meshes; outputs: .private/product-renders/*.png.
"""
import json
import math
import os
import re
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('PRODUCT_RENDER_WORK_DIR', ROOT / '.private/product-renders')).resolve()
PRIVATE = Path(os.environ.get('PRODUCT_RENDER_PRIVATE_ROOT', ROOT / '.private')).resolve()
if not WORK.is_relative_to(PRIVATE) or WORK.is_relative_to(ROOT / 'public'):
    raise ValueError('Product renders require a private working directory')
RECIPES = json.loads((WORK / 'recipes.json').read_text())
DEVICE = os.environ.get('PRODUCT_RENDER_DEVICE', 'CPU')
if DEVICE not in ('CPU', 'CUDA', 'OPTIX'):
    raise ValueError('Use CPU, CUDA or OPTIX for PRODUCT_RENDER_DEVICE')


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def material(color):
    mat = bpy.data.materials.new('Matte printed polymer')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    rgb = [linear(int(color[i:i+2], 16) / 255) for i in (1, 3, 5)]
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .46
    shader.inputs['IOR'].default_value = 1.46
    # Restrained procedural surface grain; geometry and text remain unchanged.
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 220
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .00008
    mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    # World-space 0.2 mm print layers: surface normals only, never export geometry.
    position = nodes.new('ShaderNodeNewGeometry')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    frequency = nodes.new('ShaderNodeMath')
    frequency.operation = 'MULTIPLY'
    frequency.inputs[1].default_value = 2 * math.pi / .0002
    wave = nodes.new('ShaderNodeMath')
    wave.operation = 'SINE'
    layers = nodes.new('ShaderNodeBump')
    layers.inputs['Strength'].default_value = .18
    layers.inputs['Distance'].default_value = .000012
    mat.node_tree.links.new(position.outputs['Position'], separate.inputs[0])
    mat.node_tree.links.new(separate.outputs['Z'], frequency.inputs[0])
    mat.node_tree.links.new(frequency.outputs[0], wave.inputs[0])
    mat.node_tree.links.new(wave.outputs[0], layers.inputs['Height'])
    mat.node_tree.links.new(bump.outputs['Normal'], layers.inputs['Normal'])
    mat.node_tree.links.new(layers.outputs['Normal'], shader.inputs['Normal'])
    return mat


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


for recipe in RECIPES['renders']:
    if not re.fullmatch(r'[a-z0-9-]{1,160}', recipe['id']) or not 0 < recipe['elevation'] < 90 or not -360 <= recipe['azimuth'] <= 360:
        raise ValueError('Invalid product render recipe')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Factory settings reset Cycles preferences as well as the scene.
    if DEVICE != 'CPU':
        preferences = bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type = DEVICE
        preferences.get_devices()
        for device in preferences.devices:
            device.use = device.type == DEVICE
        if not any(device.use for device in preferences.devices):
            raise ValueError('Requested Cycles device is unavailable')
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU' if DEVICE == 'CPU' else 'GPU'
    scene.cycles.samples = 192
    scene.cycles.seed = 41
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = -0.7
    scene.view_settings.gamma = 1
    scene.world = bpy.data.worlds.new('Neutral studio')
    scene.world.use_nodes = True
    # Keep indirect bounce/contact shadows, but avoid an omnidirectional blue
    # fill lifting every dark surface. Softboxes supply the studio illumination.
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .06
    data = json.loads((WORK / f'{recipe["id"]}.json').read_text())
    points = []
    for part in data['parts']:
        vertices = [tuple(v / 1000 for v in p) for p in part['mesh']['vertices']]
        points.extend(vertices)
        mesh = bpy.data.meshes.new(part['name'])
        mesh.from_pydata(vertices, [], part['mesh']['triangles'])
        mesh.update()
        obj = bpy.data.objects.new(part['name'], mesh)
        scene.collection.objects.link(obj)
        obj.data.materials.append(material(part['color']))
        # Weighted normals keep planar letters crisp and curved surfaces smooth.
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (low + high) / 2
    size = (high - low).length
    bpy.ops.mesh.primitive_plane_add(size=size * 200, location=(center.x, center.y, low.z - .00005))
    bpy.context.object.data.materials.append(material('#e4ded3'))
    for name, offset, power, width in [
        ('Key softbox', (-1.2, -1.5, 2.4), 7, .9),
        ('Fill softbox', (1.5, -.3, 1.2), .6, 1.3),
        ('Rim softbox', (.5, 1.5, 2), 3, .8),
    ]:
        lamp = bpy.data.lights.new(name, 'AREA')
        lamp.energy = power * (size / .2) ** 2
        lamp.shape = 'DISK'
        lamp.size = size * width
        obj = bpy.data.objects.new(name, lamp)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(offset) * size
        aim(obj, center)
    camera = bpy.data.objects.new('Product camera', bpy.data.cameras.new('Product camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    az = math.radians(recipe['azimuth'])
    el = math.radians(recipe['elevation'])
    camera.location = center + Vector((math.cos(az)*math.cos(el), math.sin(az)*math.cos(el), math.sin(el))) * size * 3
    aim(camera, center)
    camera.data.type = 'ORTHO'
    # Fit projected vertices with consistent safe margins, including flat products.
    inverse = camera.rotation_euler.to_matrix().transposed()
    projected = [inverse @ (Vector(p) - center) for p in points]
    width = max(p.x for p in projected) - min(p.x for p in projected)
    height = max(p.y for p in projected) - min(p.y for p in projected)
    camera.data.ortho_scale = max(width, height * 4 / 3) * 1.28
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(WORK / f'{recipe["id"]}.png')
    bpy.ops.render.render(write_still=True)
