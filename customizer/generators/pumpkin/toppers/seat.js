// Keep the outside level. Only the boolean mould cuts the pumpkin contour inside.
// Ease the lower profile onto a common 28 mm plane while retaining the previous
// upper-detail height (raw Z minus 3 mm). This map is monotone and independent of XY.
export function flatSeat(style) {
  const base = { witch:25.5, santa:27, baseball:26.5 }[style];
  return v => {
    const blend=Math.max(0,Math.min(1,(v[2]-base)/16));
    v[2]+=(28-base)*(1-blend)-3*blend;
  };
}
