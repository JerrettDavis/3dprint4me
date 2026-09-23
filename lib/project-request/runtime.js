import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as blob from "../blob.js";
import { getLocalOperatorStore, localOperatorEnabled } from "../local-operator.js";
import * as neon from "../neon.js";
import { hasEmailDelivery, hasWebhookDelivery, postRequestWebhook, sendRequestEmails } from "../notifications.js";
import { triggerPushWorker } from "../push-trigger.js";
import * as supabase from "../supabase.js";
import { createNeonWorkStore } from "../work-store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function neonRepository() {
  return {
    createDraft: neon.createRequestRecord,
    acceptsUploads: neon.requestRecordExists
  };
}

function supabaseRepository() {
  return {
    createDraft: supabase.createRequestRecord,
    completeDraft: supabase.completeRequestRecord,
    acceptsUploads: supabase.requestRecordExists
  };
}

function blobFileStore() {
  return {
    bodyType: "file",
    headers: {},
    authorizeUpload: blob.createSignedUpload
  };
}

function supabaseFileStore() {
  return {
    bodyType: "form",
    headers: { "x-upsert": "false" },
    authorizeUpload: supabase.createSignedUpload
  };
}

function localRecorder() {
  return {
    async record(event) {
      if (process.env.LOCAL_DEV !== "1") return;
      const path = join(root, "data", "dev-requests.ndjson");
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify({ ...event, loggedAt: new Date().toISOString() })}\n`, "utf8");
    }
  };
}

function notificationCapabilities() {
  return {
    emailNotifier: { notify: sendRequestEmails },
    webhookNotifier: { notify: postRequestWebhook },
    pushTrigger: { trigger: triggerPushWorker },
    recorder: localRecorder()
  };
}

export function createProjectRequestRuntime() {
  const notifications = notificationCapabilities();
  if (neon.hasNeon()) {
    const workStore = createNeonWorkStore();
    return {
      ...notifications,
      mode: "neon",
      requestRepository: neonRepository(),
      privateFileStore: blob.hasBlob() ? blobFileStore() : null,
      workPublisher: {
        async completeRequest(id, request, files) {
          const completed = await workStore.completeRequestWithWork(id, request, files);
          return { outboxId: completed.outbox.id };
        }
      }
    };
  }
  if (supabase.hasSupabase()) {
    return {
      ...notifications,
      mode: "supabase",
      requestRepository: supabaseRepository(),
      privateFileStore: supabaseFileStore(),
      workPublisher: null
    };
  }
  return {
    ...notifications,
    mode: hasEmailDelivery() || hasWebhookDelivery() ? "delivery" : "local",
    requestRepository: null,
    privateFileStore: null,
    workPublisher: localOperatorEnabled()
      ? { async completeRequest(id, request, files) { await getLocalOperatorStore().completeRequestWithWork(id, request, files); return { outboxId: null }; } }
      : null
  };
}
