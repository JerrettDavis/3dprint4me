import routeShield from "./generators/route-shield.js?v=8b580d4116242dd0";
import wifiTag from "./generators/wifi-tag.js?v=8b580d4116242dd0";
import ratingCard from "./generators/rating-card.js?v=8b580d4116242dd0";
import namePlate from "./generators/name-plate.js?v=8b580d4116242dd0";
import pumpkin from "./generators/pumpkin.js?v=8b580d4116242dd0";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
