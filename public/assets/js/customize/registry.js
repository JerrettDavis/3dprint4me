import routeShield from "./generators/route-shield.js?v=dcef6fb6d5754a0b";
import wifiTag from "./generators/wifi-tag.js?v=dcef6fb6d5754a0b";
import ratingCard from "./generators/rating-card.js?v=dcef6fb6d5754a0b";
import namePlate from "./generators/name-plate.js?v=dcef6fb6d5754a0b";
import pumpkin from "./generators/pumpkin.js?v=dcef6fb6d5754a0b";
import displaySign from "./generators/display-sign.js?v=dcef6fb6d5754a0b";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin, [displaySign.id]: displaySign });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
