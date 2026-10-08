// QR printability, shared by the page, the builders and the server's re-validation.
// A module (one dark/light cell) must be wide enough for a 0.4 mm nozzle to lay down
// distinct lines: below ~2 nozzle widths adjacent modules fuse and scanners fail.
export const QR_NOZZLE_MM = 0.4;
export const QR_FLOOR_MODULE_MM = 0.6;    // below this a code cannot be printed reliably at all
export const QR_COMFORT_MODULE_MM = 1.0;  // at or above this a 0.4 mm nozzle prints it dependably
export const QR_SCALE_RANGE = Object.freeze([25, 100]);

/** Schema entry for the independent QR size (percent of the largest size that fits). */
export const qrScaleField = (group = "back", extra = {}) => ({
  type: "number", label: "QR code size", min: QR_SCALE_RANGE[0], max: QR_SCALE_RANGE[1], step: 5, default: 100, unit: "%", group, ...extra
});

/** { level: "ok" | "marginal" | "unprintable", message } for a module width in mm. */
export function qrModuleStatus(moduleMm) {
  if (moduleMm < QR_FLOOR_MODULE_MM) return { level: "unprintable", message: `Each QR cell would be ${moduleMm.toFixed(2)} mm, too fine for a 0.4 mm nozzle to print. Make the code bigger or shorten its content.` };
  if (moduleMm < QR_COMFORT_MODULE_MM) return { level: "marginal", message: `Each QR cell is ${moduleMm.toFixed(2)} mm. A 0.4 mm nozzle can print this, but scanning may be unreliable; ${QR_COMFORT_MODULE_MM.toFixed(1)} mm or more is safer.` };
  return { level: "ok", message: "" };
}
