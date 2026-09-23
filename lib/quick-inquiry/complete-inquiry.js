import { HttpError } from "../http.js";

export function completeInquiryUseCase({ validateKey, repository, privateFiles, notify }) {
  return async function completeInquiry(body) {
    const keyHash = validateKey(body?.submissionKey);
    let row = await repository.findOwnedDraft(keyHash);
    if (!row || row.id !== body?.id) throw new HttpError(404, "Inquiry not found.");
    if (row.status !== "submitted") {
      for (const file of row.files) {
        if (!(await privateFiles.matches(file))) throw new HttpError(409, "An attachment is missing or incomplete. Retry the upload.");
      }
      row = await repository.completeDraft(row);
    }
    try { await notify(row); } catch { /* Durable acceptance is independent of notification delivery. */ }
    return row;
  };
}
