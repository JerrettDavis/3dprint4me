import { createSignedUpload, hasBlob, inspectPrivateObject } from "../blob.js";
import * as defaultStore from "../inquiry-store.js";
import { sendInquiryEmail } from "../inquiry-notifications.js";
import { hasEmailDelivery } from "../notifications.js";
import { notifyInquiryUseCase } from "./notify-inquiry.js";
import { getLocalOperatorStore, localOperatorEnabled } from '../local-operator.js';
import { createLocalInquiryStore } from '../inquiry-workflow/local-inquiry-store.js';

function notificationPayload(row) {
  return {
    from: process.env.REQUEST_FROM_EMAIL,
    to: [process.env.REQUEST_TO_EMAIL],
    reply_to: row.inquiry.replyEmail,
    subject: `[${row.id}] Quick inquiry`,
    text: `Quick inquiry ${row.id}\n\n${JSON.stringify(row.inquiry, null, 2)}\n\nPrivate attachments (open through authenticated Blob storage):\n${row.files.map(file => `${file.name}: ${file.path}`).join("\n")}\n\nThis inquiry has no binding estimate or payment.`
  };
}

export function createQuickInquiryRuntime(deps = {}) {
  const local = !deps.store && localOperatorEnabled();
  const store = deps.store || (local ? createLocalInquiryStore({work:getLocalOperatorStore()}) : defaultStore);
  const repository = {
    rate: key => store.rate(key),
    findOwnedDraft: key => (store.findOwnedDraft || store.find)(key),
    createDraft: row => (store.createDraft || store.create)(row),
    completeDraft: row => (store.completeDraft || store.complete)(row),
    ensureSubmittedWork: store.ensureSubmittedWork ? row => store.ensureSubmittedWork(row) : null,
    claimNotification: store.claimNotification ? (row, payload) => store.claimNotification(row, payload) : null,
    finishNotification: store.finishNotification ? (row, state) => store.finishNotification(row, state) : null
  };
  const inspect = deps.head || inspectPrivateObject;
  const sign = deps.sign || createSignedUpload;
  const privateFiles = (deps.blobConfigured || (()=>!local&&hasBlob()))()
    ? {
        async matches(file) {
          try { const object = await inspect(file.path); return object.pathname === file.path && object.size === file.size; }
          catch { return false; }
        },
        authorizeUpload: sign
      }
    : null;
  const notify = deps.store?.notify && !deps.store.claimNotification
    ? row => deps.store.notify(row)
    : notifyInquiryUseCase({
        hasDelivery: deps.hasDelivery || (()=>!local&&hasEmailDelivery()),
        buildPayload: notificationPayload,
        repository,
        send: deps.send || sendInquiryEmail
      });
  return {
    configured: (deps.configured || (() => local || Boolean(process.env.DATABASE_URL)))(),
    repository,
    privateFiles,
    notify
  };
}
