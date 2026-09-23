const OPERATOR_ORIGIN = "https://work.3dprint4.me";
const WORK_ID = /^work_[A-Za-z0-9_-]{8,123}$/;

function safeWorkId(value) {
  const id = String(value ?? "");
  if (!WORK_ID.test(id)) throw new TypeError("Snapshot contains an invalid work ID.");
  return id;
}

export function presentHomeAssistantSnapshot(raw, { now = () => new Date() } = {}) {
  const items = raw.items.map(item => {
    const id = safeWorkId(item.id);
    return {
      id, title: item.projectTitle, service: item.service, status: item.status,
      priority: item.priority, acknowledged: Boolean(item.acknowledged),
      submittedAt: item.submittedAt, targetDate: item.targetDate ?? null,
      url: `${OPERATOR_ORIGIN}/work/${id}`
    };
  });
  return {
    version: 1, generatedAt: now().toISOString(), queueUrl: `${OPERATOR_ORIGIN}/`,
    counts: {
      active: Number(raw.counts.active), unacknowledged: Number(raw.counts.unacknowledged),
      urgent: Number(raw.counts.urgent), waitingCustomer: Number(raw.counts.waitingCustomer)
    },
    latestCreatedId: raw.latestCreatedId === null ? null : safeWorkId(raw.latestCreatedId), items
  };
}
