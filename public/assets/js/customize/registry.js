import routeShield from "./generators/route-shield.js?v=400837523c07bad6";
import wifiTag from "./generators/wifi-tag.js?v=400837523c07bad6";
import ratingCard from "./generators/rating-card.js?v=400837523c07bad6";
import namePlate from "./generators/name-plate.js?v=400837523c07bad6";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
