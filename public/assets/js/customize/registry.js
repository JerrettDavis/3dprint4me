import routeShield from "./generators/route-shield.js?v=ed70022f8c38a1b0";
import wifiTag from "./generators/wifi-tag.js?v=ed70022f8c38a1b0";
import ratingCard from "./generators/rating-card.js?v=ed70022f8c38a1b0";
import namePlate from "./generators/name-plate.js?v=ed70022f8c38a1b0";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
