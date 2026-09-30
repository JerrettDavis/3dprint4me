// The public rate card is the market/retail candidate. Reusing the exact browser
// module keeps the customer planning range and the server snapshot on one formula.
import { SITE_CONFIG } from "../../public/assets/js/config.js";
import { printRateCardQuote } from "../../public/assets/js/quote-engine.js";

export const RATE_CARD_VERSION = `site-config:print:${SITE_CONFIG.pricing.print.setup}/${SITE_CONFIG.pricing.print.machineHour}/${SITE_CONFIG.pricing.print.minimum}`;

export function marketPrice(options, production) {
  const quote = printRateCardQuote({
    material: options.material,
    quality: options.quality,
    colors: options.colors,
    finish: options.finish,
    delivery: options.delivery,
    quantity: options.quantity,
    sizeClass: options.sizeClass,
    grams: production.source === "manual" ? production.gramsPerUnit : "",
    machineHours: production.source === "manual" ? production.hoursPerUnit : "",
    modelEstimate: ["geometry", "slicer", "catalog"].includes(production.source)
      ? { grams: production.gramsPerUnit, hours: production.hoursPerUnit, source: production.source === "slicer" ? "slicer" : "geometry" }
      : null
  });
  return { priceUsd: quote.subtotal, version: RATE_CARD_VERSION, quote };
}

export function rateCardSizeFallback(sizeClass) {
  const table = SITE_CONFIG.pricing.print.sizeFallback;
  return table[sizeClass] ?? table.palm;
}
