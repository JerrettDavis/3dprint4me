import { choice, number, skullRules, skullSchema } from "../skeleton.js?v=9ac764f878c3801f";

export default {
  id: "skull-keychain", version: 4, title: "Skull keychain",
  blurb: "An algorithmic broad-chinned skull with recessed sockets, individual teeth, a flat back and reinforced keyring attachment.",
  category: "tags", origin: "house",
  rights: { publishable: true, note: "Algorithmic house geometry with reference-informed proportions; no source mesh or sampled source surface is distributed. Reference artwork rights still apply." },
  initialView: "3d",
  sections: { head: "Head", face: "Face", loop: "Keyring" },
  focus: [{ part: "Skull", section: "head" }, { part: "Face", section: "face" }],
  schema: {
    ...skullSchema,
    attachment: choice("Keyring attachment", "loop", [["loop", "Reinforced outer loop"], ["hole", "Hole through forehead"], ["none", "No attachment"]], "loop"),
    hole_diameter_mm: number("Keyring hole diameter", 4, 3, 7, 0.5, "loop", { visibleWhen: { attachment: ["hole", "loop"] } }),
    loop_wall_mm: number("Keyring wall thickness", 3, 2.5, 5, 0.5, "loop", { visibleWhen: { attachment: ["hole", "loop"] }, help: "Material around the hole; larger values resist keyring loads better." })
  },
  rules(o) {
    const r = skullRules(o);
    if (o.attachment === "hole" && o.hole_diameter_mm + 2 * o.loop_wall_mm > o.head_height_mm * 0.42) {
      const message = "The forehead hole needs more room for its wall. Reduce the hole or wall, or enlarge the head.";
      r.errors.push(message); r.fieldErrors.hole_diameter_mm = message;
    }
    return r;
  },
  presets: { loop: {}, hole: { attachment: "hole", head_height_mm: 38, head_width_mm: 44 }, engraved: { multicolor: false }, large: { head_width_mm: 55, head_height_mm: 45 } },
  defaultDesign: "loop",
  designs: [
    { id: "loop", label: "Reinforced keychain", blurb: "Flat back and a thick external loop.", params: {} },
    { id: "hole", label: "Forehead hole", blurb: "An integrated hole in a larger head.", params: { attachment: "hole", head_height_mm: 38, head_width_mm: 44 } },
    { id: "engraved", label: "Single-color skull", blurb: "Engraved features; no AMS needed.", params: { multicolor: false } },
    { id: "large", label: "Large bag charm", blurb: "A larger rounded charm.", params: { head_width_mm: 55, head_height_mm: 45, head_depth_mm: 10 } }
  ]
};
