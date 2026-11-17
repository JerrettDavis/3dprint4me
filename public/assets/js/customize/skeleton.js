export const number = (label, value, min, max, step, section, extra = {}) => ({
  type: "number", label, default: value, min, max, step, unit: "mm", section, group: "size", ...extra
});
export const choice = (label, value, options, section) => ({
  type: "enum", label, default: value, options: options.map(([value, label]) => ({ value, label })), section, group: "layout"
});
export const skullSchema = {
  head_width_mm: number("Head width", 38, 28, 80, 0.5, "head"),
  head_height_mm: number("Head height", 34.5, 24, 75, 0.5, "head"),
  head_depth_mm: number("Head depth", 14, 6, 40, 0.5, "head", { help: "Scales the generated skull's relief. A thin keychain flattens the face; 33.5 mm gives a fuller figure head." }),
  chin_fullness_pct: number("Chin fullness", 100, 85, 115, 5, "head", { unit: "%", advanced: true }),
  eye_size_pct: number("Eye size", 100, 65, 125, 5, "face", { unit: "%", advanced: true }),
  eye_recess_pct: number("Eye socket depth", 9, 5, 25, 1, "face", { unit: "%", advanced: true }),
  tooth_count: { type: "int", label: "Tooth count", default: 18, min: 12, max: 24, step: 1, section: "face", group: "layout", advanced: true },
  smile_width_pct: number("Smile width", 100, 70, 120, 5, "face", { unit: "%", advanced: true }),
  inlay_depth_mm: number("Face inlay depth", 0.8, 0.4, 1.4, 0.2, "face", { advanced: true }),
  multicolor: { type: "bool", label: "Multicolor face inlays", default: true, section: "face", group: "colors", help: "3MF keeps the dark features as flush color parts. Turn off for a single-color engraved face." },
  skull_color: { type: "color", label: "Skull color", default: "#f2eee2", section: "head", group: "colors" },
  face_color: { type: "color", label: "Face color", default: "#20232a", section: "face", group: "colors", visibleWhen: { multicolor: true } }
};

export function threadSpec(o) {
  return { radius: o.thread_diameter_mm / 2, ridge: 0.65, pitch: 2.4, height: Math.min(6, o.head_depth_mm * 0.45 - 1.2), clearance: o.thread_clearance_mm };
}

export function figureLayout(o) {
  const top = o.torso_length_mm / 2, bottom = -top;
  const headY = top + o.neck_length_mm + o.head_height_mm * 0.5;
  const hipX = o.torso_width_mm * 0.3;
  const shoulderX = o.torso_width_mm * 0.44;
  const arms = [-1, 1].map(s => {
    const shoulder = [s * shoulderX, top - 3];
    const upperAngle = 18 * Math.PI / 180, lowerAngle = (18 - o.elbow_bend_deg) * Math.PI / 180;
    const elbow = [shoulder[0] + s * o.upper_arm_mm * Math.sin(upperAngle), shoulder[1] - o.upper_arm_mm * Math.cos(upperAngle)];
    const wrist = [elbow[0] + s * o.forearm_mm * Math.sin(lowerAngle), elbow[1] - o.forearm_mm * Math.cos(lowerAngle)];
    return { shoulder, elbow, wrist };
  });
  const legs = [-1, 1].map(s => {
    const hip = [s * hipX, bottom + 2];
    const bend = o.knee_bend_deg * Math.PI / 180;
    const thighAngle = 2 * Math.PI / 180 + Math.atan2(o.shin_mm * Math.sin(bend), o.thigh_mm + o.shin_mm * Math.cos(bend));
    const shinAngle = thighAngle - bend;
    const knee = [hip[0] + s * o.thigh_mm * Math.sin(thighAngle), hip[1] - o.thigh_mm * Math.cos(thighAngle)];
    const ankle = [knee[0] + s * o.shin_mm * Math.sin(shinAngle), knee[1] - o.shin_mm * Math.cos(shinAngle)];
    return { hip, knee, ankle, side: s };
  });
  return { top, bottom, headY, arms, legs };
}

export function skullRules(o) {
  const errors = [], fieldErrors = {};
  const add = (key, message) => { errors.push(message); fieldErrors[key] = message; };
  if (o.head_height_mm > o.head_width_mm * 1.25) add("head_height_mm", "Keep head height at most 125% of its width.");
  return { errors, fieldErrors, limits: { head_height_mm: [24, Math.min(75, Math.floor(o.head_width_mm * 2.5) / 2)] } };
}
