import routeShield from "./generators/route-shield.js?v=edf0ac7d83450b6f";
import wifiTag from "./generators/wifi-tag.js?v=edf0ac7d83450b6f";
import ratingCard from "./generators/rating-card.js?v=edf0ac7d83450b6f";
import namePlate from "./generators/name-plate.js?v=edf0ac7d83450b6f";
import pumpkin from "./generators/pumpkin.js?v=edf0ac7d83450b6f";
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield, [wifiTag.id]: wifiTag, [ratingCard.id]: ratingCard, [namePlate.id]: namePlate, [pumpkin.id]: pumpkin });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
