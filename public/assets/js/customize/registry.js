import routeShield from "./generators/route-shield.js?v=e48e9721ce74a61c";
import wifiTag from "./generators/wifi-tag.js?v=e48e9721ce74a61c";
import ratingCard from "./generators/rating-card.js?v=e48e9721ce74a61c";
import namePlate from "./generators/name-plate.js?v=e48e9721ce74a61c";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
