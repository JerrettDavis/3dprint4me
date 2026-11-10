"""Render exported mesh evidence, without changing model geometry."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
import sys

root=Path(__file__).resolve().parents[1]/'screenshots/fidget-evidence'
models=json.loads((root/'models.json').read_text())
fig=plt.figure(figsize=(16,12),facecolor='#edf1f3')
def render(ax,model):
    points=[]
    faces=[]
    colors=[]
    for part in model['parts']:
        vertices=np.asarray(part['mesh']['vertices'])
        points.append(vertices)
        triangles=vertices[np.asarray(part['mesh']['triangles'])]
        faces.extend(triangles)
        colors.extend([part['color']]*len(triangles))
    ax.add_collection3d(Poly3DCollection(faces,facecolors=colors,linewidths=0,shade=True,lightsource=matplotlib.colors.LightSource(azdeg=310,altdeg=50)))
    vertices=np.concatenate(points)
    low,high=vertices.min(axis=0),vertices.max(axis=0)
    ax.set(xlim=(low[0]-2,high[0]+2),ylim=(low[1]-2,high[1]+2),zlim=(0,high[2]+2))
    ax.set_box_aspect(high-low+4)
    ax.view_init(elev=37,azim=-60)
    ax.set_axis_off()
for index,model in enumerate(models):
    ax=fig.add_subplot(3,3,index+1,projection='3d')
    render(ax,model)
    ax.set_title(model['title'],fontsize=14)
fig.suptitle('Infinity fidget — exported geometry review\nPhysical bearing fit, support release and durability remain unverified',fontsize=17)
fig.tight_layout()
fig.savefig(root/'review-board.png',dpi=150)
if '--catalog' in sys.argv:
    from PIL import Image
    catalog=plt.figure(figsize=(6.4,4.8),facecolor='#edf1f3')
    ax=catalog.add_axes([0,0,1,1],projection='3d')
    render(ax,models[0])
    catalog.canvas.draw()
    rgba=np.asarray(catalog.canvas.buffer_rgba())
    output=root.parents[1]/'public/assets/images/products/infinity-fidget.webp'
    Image.fromarray(rgba).convert('RGB').save(output,quality=90)
