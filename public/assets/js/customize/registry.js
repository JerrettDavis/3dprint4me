import routeShield from "./generators/route-shield.js?v=fbc13f804a77bd37";
import wifiTag from "./generators/wifi-tag.js?v=fbc13f804a77bd37";
import ratingCard from "./generators/rating-card.js?v=fbc13f804a77bd37";
import namePlate from "./generators/name-plate.js?v=fbc13f804a77bd37";
import pumpkin from "./generators/pumpkin.js?v=fbc13f804a77bd37";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
