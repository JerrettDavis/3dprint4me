import routeShield from "./generators/route-shield.js?v=734fd579335663df";
import wifiTag from "./generators/wifi-tag.js?v=734fd579335663df";
// Later tasks add: ratingCard, namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
