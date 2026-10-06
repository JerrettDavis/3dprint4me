import routeShield from "./generators/route-shield.js?v=4eed843a69c17184";
import wifiTag from "./generators/wifi-tag.js?v=4eed843a69c17184";
import ratingCard from "./generators/rating-card.js?v=4eed843a69c17184";
import namePlate from "./generators/name-plate.js?v=4eed843a69c17184";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
