// Each generator adds one line; dynamic imports keep per-generator code split.
export const loadBuilder = {
  "route-shield": () => import("./route-shield/build.js"),
  "wifi-tag": () => import("./wifi-tag/build.js"),
  "rating-card": () => import("./rating-card/build.js"),
  "name-plate": () => import("./name-plate/build.js"),
  "pumpkin": () => import("./pumpkin/build.js")
};
