// Map the lower hat onto the measured pumpkin, including its asymmetric lobes.
// The map remains monotone in Z; upper details settle 3 mm lower without folding.
export function contourSeat(crown, style) {
  const base = { witch:25.5, santa:27, baseball:26.5 }[style];
  const heights = new Map();
  const sample = (x,y) => {
    const key=`${x},${y}`;
    if (!heights.has(key)) {
      const hit=crown.rayCast([x,y,60],[x,y,0])[0]; // A brim continues past the upper shoulder instead of wrapping down over
      // the face. Clamping is continuous, unlike stepping inward to another ray.
      heights.set(key,Math.max(22,hit?.position[2] ?? 22)); 
    }
    return heights.get(key);
  };
  return v => {
    // Bilinear interpolation avoids a ray query for every refined mesh vertex.
    const x=Math.floor(v[0]*4)/4, y=Math.floor(v[1]*4)/4;
    const u=(v[0]-x)*4, w=(v[1]-y)*4;
    const z=(1-w)*((1-u)*sample(x,y)+u*sample(x+.25,y))
      +w*((1-u)*sample(x,y+.25)+u*sample(x+.25,y+.25));
    const blend=Math.max(0,Math.min(1,(v[2]-base)/16));
    v[2]+=(z-base-.5)*(1-blend)-3*blend;
  };
}
