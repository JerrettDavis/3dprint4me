import { scope, skull } from "../skeleton/geometry.js";

export default async function build(o, { wasm }) {
  const s = scope(wasm);
  let ok = false;
  try {
    const head = skull(s, o, { attachment: o.attachment });
    s.add("Skull", o.skull_color, head.body);
    if (o.multicolor) s.add("Face inlays", o.face_color, head.face);
    ok = true;
    return { solids: s.solids, title: "Skull keychain", warnings: ["Print with the flat back on the bed. 3MF face colors are flush inlays; assign filaments in your slicer.", "Keyring strength is not certified. Check the loop with a test print before daily use."] };
  } finally { s.done(ok); }
}
