import inquiryHandler from "../lib/quick-inquiry/handler.js";
import downloadEventHandler from "../lib/customization/download-event.js";

export { createInquiryHandler } from "../lib/quick-inquiry/handler.js";

// One function serves both: Vercel Hobby allows twelve, and the customizer's download event is a
// tiny sibling of the quick inquiry (`/api/inquiry?kind=customize-download`).
export default function handler(req, res) {
  const kind = new URL(req.url ?? "/", "http://local").searchParams.get("kind");
  return (kind === "customize-download" ? downloadEventHandler : inquiryHandler)(req, res);
}
