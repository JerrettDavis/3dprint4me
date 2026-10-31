import routeShield from "./generators/route-shield.js?v=b3e928dd366365e4";
import wifiTag from "./generators/wifi-tag.js?v=b3e928dd366365e4";
import ratingCard from "./generators/rating-card.js?v=b3e928dd366365e4";
import namePlate from "./generators/name-plate.js?v=b3e928dd366365e4";
import pumpkin from "./generators/pumpkin.js?v=b3e928dd366365e4";
import displaySign from "./generators/display-sign.js?v=b3e928dd366365e4";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin, [displaySign.id]: displaySign });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
