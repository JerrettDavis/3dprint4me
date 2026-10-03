// Each generator adds one line; dynamic imports keep per-generator code split.
export const loadBuilder = {
  "route-shield": () => import("./route-shield/build.js"),
  "wifi-tag": () => import("./wifi-tag/build.js")
};
