import assert from "node:assert/strict";
import test from "node:test";

import { createNeonWorkRepository } from "../../lib/work-management/adapters/neon-work-repository.js";

test("Neon Home Assistant snapshot uses one bounded read and normalizes its aggregate", async () => {
  const calls = [];
  const query = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [{
      active: "24", unacknowledged: "7", urgent: "2", waiting_customer: "3",
      latest_created_id: "work_terminal999", items: [{
        id: "work_12345678", status: "submitted", service: "print", projectTitle: "Replacement bracket",
        priority: "urgent", acknowledged: false, submittedAt: new Date("2026-09-22T11:55:00.000Z"),
        targetDate: "2026-09-30"
      }]
    }];
  };
  const snapshot = await createNeonWorkRepository({ query }).getHomeAssistantSnapshot();
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /COUNT\(\*\).*FILTER/is);
  assert.match(calls[0].text, /jsonb_agg/is);
  assert.match(calls[0].text, /LIMIT 20/is);
  assert.match(calls[0].text, /FROM work_items\s+ORDER BY created_at DESC,\s*id DESC/is);
  assert.doesNotMatch(calls[0].text, /\b(?:UPDATE|INSERT|DELETE)\b/is);
  assert.doesNotMatch(calls[0].text, /\b(?:payload|uploaded_files|work_notes|work_events|revision|operator_id)\b/is);
  assert.doesNotMatch(calls[0].text, /['"]requestId['"]|\bAS\s+request_id\b/is);
  assert.deepEqual(snapshot, {
    counts: { active: 24, unacknowledged: 7, urgent: 2, waitingCustomer: 3 },
    latestCreatedId: "work_terminal999", items: [{
      id: "work_12345678", status: "submitted", service: "print", projectTitle: "Replacement bracket",
      priority: "urgent", acknowledged: false, submittedAt: "2026-09-22T11:55:00.000Z", targetDate: "2026-09-30"
    }]
  });
});

test("Neon Home Assistant snapshot returns zeros and empty cards when work does not exist", async () => {
  const query = async () => [{ active: "0", unacknowledged: "0", urgent: "0", waiting_customer: "0", latest_created_id: null, items: null }];
  const actual = await createNeonWorkRepository({ query }).getHomeAssistantSnapshot();
  assert.deepEqual(actual, { counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 }, latestCreatedId: null, items: [] });
});
