const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
const transitions = {
  submitted: ["triage", "waiting_customer", "declined", "cancelled"],
  triage: ["quoted", "waiting_customer", "declined", "cancelled"],
  quoted: ["approved", "waiting_customer", "declined", "cancelled"],
  approved: ["scheduled", "waiting_customer", "cancelled"],
  scheduled: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"],
  waiting_customer: [], completed: [], declined: [], cancelled: []
};

export const filterWork = (items, filters = {}) => items.filter(item => (!filters.kind || item.kind === filters.kind) && (!filters.service || item.service === filters.service) && (!filters.priority || item.priority === filters.priority));
export const sortWork = items => [...items].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.id.localeCompare(b.id));
export function allowedTransitions(item) {
  if (item.kind === "inquiry") {
    if (["completed", "declined", "cancelled"].includes(item.status)) return [];
    if (item.status === "waiting_customer") return [...(["submitted", "triage"].includes(item.previousStatus) ? [item.previousStatus] : []), "completed"];
    return [...(item.status === "submitted" ? ["triage"] : []), "waiting_customer", "completed"];
  }
  let values = [...(transitions[item.status] ?? [])];
  if (item.status === "approved" && !item.targetDate) values = values.filter(value => value !== "scheduled");
  if (item.status === "waiting_customer" && item.previousStatus) values = [item.previousStatus];
  return values;
}
export function formatRelativeTime(value, now = Date.now()) {
  const minutes = Math.round((new Date(value).getTime() - now) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export const workStatusLabel = item => item.kind === "inquiry" ? ({submitted:"Needs response",triage:"Reviewing",waiting_customer:"Waiting",completed:"Closed",declined:"Closed",cancelled:"Closed"}[item.status] ?? item.status) : item.status.replaceAll("_", " ");
