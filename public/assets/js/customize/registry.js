import routeShield from "./generators/route-shield.js?v=019b09fba4bb8b4a";
import wifiTag from "./generators/wifi-tag.js?v=019b09fba4bb8b4a";
import ratingCard from "./generators/rating-card.js?v=019b09fba4bb8b4a";
import namePlate from "./generators/name-plate.js?v=019b09fba4bb8b4a";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
