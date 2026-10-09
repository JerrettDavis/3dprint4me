import routeShield from "./generators/route-shield.js?v=b02beb96949fe963";
import wifiTag from "./generators/wifi-tag.js?v=b02beb96949fe963";
import ratingCard from "./generators/rating-card.js?v=b02beb96949fe963";
import namePlate from "./generators/name-plate.js?v=b02beb96949fe963";
import pumpkin from "./generators/pumpkin.js?v=b02beb96949fe963";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
