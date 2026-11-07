// Keep the outside level. Only the boolean mould cuts the pumpkin contour inside.
// Ease the lower profile onto its level base plane while retaining the previous
// upper-detail height (raw Z minus 3 mm). This map is monotone and independent of XY.
export function flatSeat(style, height = 28) {
  const base = { witch:25.5, santa:27, baseball:26.5 }[style];
  return v => {
    const blend=Math.max(0,Math.min(1,(v[2]-base)/16));
    v[2]+=(height-base)*(1-blend)-3*blend;
  };
}

// Choose the lowest level cap base that leaves a 2 mm-wide uncut outer land.
// The maximum is measured over the whole outside of the actual reference mesh,
// rather than sampled rays, so asymmetric shoulders cannot break through it.
export function capBaseHeight(wasm, crown, diameter) {
  const radius=diameter===30 ? 14.7 : diameter/2;
  const inner=wasm.Manifold.cylinder(60,radius-2,radius-2,192);
  let outside;
  try {
    outside=crown.subtract(inner);
    return Math.min(28,outside.boundingBox().max[2]+.25);
  } finally {inner.delete();outside?.delete();}
}
