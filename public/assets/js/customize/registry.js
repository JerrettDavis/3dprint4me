import routeShield from "./generators/route-shield.js?v=a246708eea72b65a";
import wifiTag from "./generators/wifi-tag.js?v=a246708eea72b65a";
import ratingCard from "./generators/rating-card.js?v=a246708eea72b65a";
import namePlate from "./generators/name-plate.js?v=a246708eea72b65a";
import pumpkin from "./generators/pumpkin.js?v=a246708eea72b65a";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
