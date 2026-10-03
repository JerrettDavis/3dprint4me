import routeShield from "./generators/route-shield.js?v=fb2ab26d2511eeaf";
import wifiTag from "./generators/wifi-tag.js?v=fb2ab26d2511eeaf";
// Later tasks add: ratingCard, namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
