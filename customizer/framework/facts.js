// Local, non-binding facts about a built model. Pure formatting; the analysis runs in the
// browser on the built 3MF bytes (no network). Planning figures only.
import { estimateProductionFromGeometry, GEOMETRY_PRODUCTION_PROFILE } from "../../public/assets/js/print-estimation/geometry.js";

export const FACTS_NOTE = "Planning figures only; we confirm before printing.";

const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const colorCountLabel = count => `${count} ${count === 1 ? "color" : "colors"}`;

function formatHours(hours) {
  if (!(hours > 0)) return "—";
  if (hours < 1) return `about ${Math.max(5, Math.round(hours * 60 / 5) * 5)} min`;
  return `about ${oneDecimal.format(Math.round(hours * 2) / 2)} h`;
}

/** Turns geometry metrics (from analyzeModelBytes) and the color count into display rows. */
export function describeFacts(metrics, { colors = 1 } = {}) {
  const [x, y, z] = (metrics?.dimensionsMm ?? []).map(Number);
  const production = estimateProductionFromGeometry(metrics, { colors, material: "pla", quality: "standard" });
  const bed = GEOMETRY_PRODUCTION_PROFILE.bedMm;
  const fitsBed = [x, y, z].every((v, i) => Number.isFinite(v) && v <= bed[i]);
  return {
    colorsLabel: colorCountLabel(colors),
    rows: [
      { label: "Size", value: `${oneDecimal.format(x)} × ${oneDecimal.format(y)} × ${oneDecimal.format(z)} mm` },
      { label: "Volume", value: `${oneDecimal.format((metrics?.volumeMm3 ?? 0) / 1000)} cm³` },
      { label: "Rough weight", value: `about ${whole.format(Math.max(1, Math.round(production.gramsPerUnit)))} g PLA` },
      { label: "Rough print time", value: formatHours(production.hoursPerUnit) }
    ],
    fitsBed
  };
}
