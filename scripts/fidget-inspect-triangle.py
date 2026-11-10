"""Private local-reference inspection; does not publish or copy source mesh."""
from pathlib import Path
import json
import hashlib
import argparse
import trimesh
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source',type=Path,help='Permissioned local STL; the source mesh stays private.')
source=parser.parse_args().source.resolve()
mesh=trimesh.load(source,force='mesh')
parts=mesh.split(only_watertight=False)
root=Path(__file__).resolve().parents[1]/'screenshots/fidget-evidence'
fig=plt.figure(figsize=(15,10))
for index,(elev,azim) in enumerate([(35,-60),(90,-90),(0,-90),(0,0),(35,120),(0,90)]):
    ax=fig.add_subplot(2,3,index+1,projection='3d')
    faces=[];colors=[]
    for part in parts:
        faces.extend(part.triangles)
        colors.extend(['#315b6c' if part.volume>1000 else '#d6a052']*len(part.faces))
    ax.add_collection3d(Poly3DCollection(faces,facecolors=colors,linewidths=0,shade=True))
    ax.set(xlim=(-1,84),ylim=(-1,42),zlim=(-1,22))
    ax.set_box_aspect([85,43,23]);ax.view_init(elev=elev,azim=azim);ax.set_axis_off()
fig.tight_layout();fig.savefig(root/'triangle-source-inspection.png',dpi=140)
report={'source':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'bounds':mesh.bounds.tolist(),'parts':[]}
for i,part in enumerate(parts):
    planes=[]
    for normal,origin,area in zip(part.facets_normal,part.facets_origin,part.facets_area):
        if area>12:planes.append({'normal':np.round(normal,6).tolist(),'origin':np.round(origin,6).tolist(),'area':round(float(area),3)})
    report['parts'].append({'id':i,'bounds':part.bounds.tolist(),'volume':float(part.volume),'major_planes':planes})
(root/'triangle-source-measurements.json').write_text(json.dumps(report,indent=2))
