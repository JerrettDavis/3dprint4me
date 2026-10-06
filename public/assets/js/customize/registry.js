import routeShield from "./generators/route-shield.js?v=d04c3523bdcde7f8";
import wifiTag from "./generators/wifi-tag.js?v=d04c3523bdcde7f8";
import ratingCard from "./generators/rating-card.js?v=d04c3523bdcde7f8";
import namePlate from "./generators/name-plate.js?v=d04c3523bdcde7f8";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
