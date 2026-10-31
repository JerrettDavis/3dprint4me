import routeShield from "./generators/route-shield.js?v=4224f5a9733c420b";
import wifiTag from "./generators/wifi-tag.js?v=4224f5a9733c420b";
import ratingCard from "./generators/rating-card.js?v=4224f5a9733c420b";
import namePlate from "./generators/name-plate.js?v=4224f5a9733c420b";
import pumpkin from "./generators/pumpkin.js?v=4224f5a9733c420b";
import displaySign from "./generators/display-sign.js?v=4224f5a9733c420b";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin, [displaySign.id]: displaySign });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
