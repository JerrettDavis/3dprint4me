import routeShield from "./generators/route-shield.js?v=7db462c2276a5051";
import wifiTag from "./generators/wifi-tag.js?v=7db462c2276a5051";
import ratingCard from "./generators/rating-card.js?v=7db462c2276a5051";
// Later tasks add: namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
