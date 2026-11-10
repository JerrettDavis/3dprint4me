// Each generator adds one line; dynamic imports keep per-generator code split.
export const loadBuilder = {
  'vase': () => import('./vase/build.js'),
  'infinity-fidget': () => import('./infinity-fidget/build.js'),
  'gridfinity-bin': () => import('./gridfinity-bin/build.js'),
  'gridfinity-base': () => import('./gridfinity-base/build.js'),
  "route-shield": () => import("./route-shield/build.js"),
  "wifi-tag": () => import("./wifi-tag/build.js"),
  "rating-card": () => import("./rating-card/build.js"),
  "name-plate": () => import("./name-plate/build.js"),
  "pumpkin": () => import("./pumpkin/build.js"),
  "display-sign": () => import("./display-sign/build.js")
};
