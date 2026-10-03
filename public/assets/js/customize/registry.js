import routeShield from "./generators/route-shield.js?v=3000b425eb9825c0";
import wifiTag from "./generators/wifi-tag.js?v=3000b425eb9825c0";
// Later tasks add: ratingCard, namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
