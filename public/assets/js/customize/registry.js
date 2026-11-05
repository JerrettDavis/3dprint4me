import routeShield from "./generators/route-shield.js?v=a81675c1ee3b41b1";
import wifiTag from "./generators/wifi-tag.js?v=a81675c1ee3b41b1";
import ratingCard from "./generators/rating-card.js?v=a81675c1ee3b41b1";
import namePlate from "./generators/name-plate.js?v=a81675c1ee3b41b1";
import pumpkin from "./generators/pumpkin.js?v=a81675c1ee3b41b1";
import displaySign from "./generators/display-sign.js?v=a81675c1ee3b41b1";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin, [displaySign.id]: displaySign });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
