import qrcode from "qrcode-generator";
import { QR_FLOOR_MODULE_MM } from "../../public/assets/js/customize/qr.js";

// Builds the QR centered on the origin. `size` is the edge length of the dark-module
// area (the quiet zone is just empty body around it).
export function qrCrossSection(CrossSection, data, size) {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const n = qr.getModuleCount();
  const minimumModule = QR_FLOOR_MODULE_MM;
  const required = n * minimumModule;
  if (required > size) {
    throw new Error(`QR payload is too dense for this item. It needs about ${required.toFixed(1)} mm at the ${minimumModule} mm/module printability floor but only ${size.toFixed(1)} mm fits.`);
  }
  const module = size / n;
  // Neighbouring dark modules overlap slightly so they union into solid regions.
  // Gaps between modules render as a hairline grid that breaks QR scanning.
  const overlap = 0.01;
  const polygons = [];
  const left = -size / 2;
  const bottom = -size / 2;
  for (let r=0; r<n; r++) {
    for (let c=0; c<n; c++) {
      if (!qr.isDark(r,c)) continue;
      const x0 = left + c * module - overlap/2;
      // Row 0 is the top of the code; Y grows upward. The back is mirrored left-right later.
      const y0 = bottom + (n - 1 - r) * module - overlap/2;
      const s2 = module + overlap;
      polygons.push([[x0,y0],[x0+s2,y0],[x0+s2,y0+s2],[x0,y0+s2]]);
    }
  }
  return { cs: CrossSection.ofPolygons(polygons), module, modules: n, target: size };
}
