import routeShield from "./generators/route-shield.js?v=af64c2651617f465";
import wifiTag from "./generators/wifi-tag.js?v=af64c2651617f465";
import ratingCard from "./generators/rating-card.js?v=af64c2651617f465";
import namePlate from "./generators/name-plate.js?v=af64c2651617f465";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
