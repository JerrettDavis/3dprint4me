// Wi-Fi network QR payloads in the de facto "WIFI:" URI format that phone cameras join from.
// Special characters in the SSID and password are backslash-escaped.
export const escapeWifiField = value => String(value).replace(/([\\;,:"])/g, "\\$1");

export function wifiPayload({ ssid, password = "", security = "WPA", hidden = false }) {
  const parts = [`T:${security}`, `S:${escapeWifiField(ssid)}`];
  if (security !== "nopass" && password) parts.push(`P:${escapeWifiField(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}
