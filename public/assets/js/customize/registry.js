import routeShield from "./generators/route-shield.js?v=c3ea9b8ac54c513f";
import wifiTag from "./generators/wifi-tag.js?v=c3ea9b8ac54c513f";
import ratingCard from "./generators/rating-card.js?v=c3ea9b8ac54c513f";
import namePlate from "./generators/name-plate.js?v=c3ea9b8ac54c513f";
import pumpkin from "./generators/pumpkin.js?v=c3ea9b8ac54c513f";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
