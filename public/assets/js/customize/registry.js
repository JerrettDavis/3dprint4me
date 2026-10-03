import routeShield from "./generators/route-shield.js?v=04d405c055e4e8d3";
// Later tasks add: wifiTag, ratingCard, namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
