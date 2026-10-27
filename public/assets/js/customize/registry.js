import routeShield from "./generators/route-shield.js?v=0be1ba19c5d91a3e";
import wifiTag from "./generators/wifi-tag.js?v=0be1ba19c5d91a3e";
import ratingCard from "./generators/rating-card.js?v=0be1ba19c5d91a3e";
import namePlate from "./generators/name-plate.js?v=0be1ba19c5d91a3e";
import pumpkin from "./generators/pumpkin.js?v=0be1ba19c5d91a3e";
import displaySign from "./generators/display-sign.js?v=0be1ba19c5d91a3e";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin, [displaySign.id]: displaySign });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
