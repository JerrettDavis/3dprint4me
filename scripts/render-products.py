"""Blender Cycles product studio. Run through Blender, not system Python.

blender --background --python scripts/render-products.py
Inputs: npm run products:meshes; outputs: .private/product-renders/*.png.
"""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
RECIPES = json.loads((ROOT / 'scripts/product-render-recipes.json').read_text())


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def material(color):
    mat = bpy.data.materials.new('Matte printed polymer')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    rgb = [linear(int(color[i:i+2], 16) / 255) for i in (1, 3, 5)]
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .38
    # Restrained procedural surface grain; geometry and text remain unchanged.
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 220
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .00008
    mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    mat.node_tree.links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return mat


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


for recipe in RECIPES['renders']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 96
    scene.cycles.seed = 41
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.world = bpy.data.worlds.new('Neutral studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.78, .81, .86, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .35
    data = json.loads((ROOT / f'.private/product-renders/{recipe["id"]}.json').read_text())
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
        ('Key softbox', (-1.2, -1.5, 2.4), 7, 1.5),
        ('Fill softbox', (1.5, -.3, 1.2), 2.5, 1.3),
        ('Rim softbox', (.5, 1.5, 2), 5, 1),
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
    scene.render.filepath = str(ROOT / f'.private/product-renders/{recipe["id"]}.png')
    bpy.ops.render.render(write_still=True)
