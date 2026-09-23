export { normalizeInquiry, validateSubmissionKey } from "../inquiry-validation.js";

export function notificationClaimAllowed({ status, attempts, startedAt, lastAt, now = new Date() }) {
  if (status === "sent" || Number(attempts) >= 3) return false;
  const current = new Date(now).getTime();
  if (startedAt && current - new Date(startedAt).getTime() >= 23 * 60 * 60 * 1000) return false;
  if (lastAt && current - new Date(lastAt).getTime() < 60 * 1000) return false;
  return true;
}
