import { HttpError } from "../http.js";

export function createInquiryUseCase({ normalize, repository, privateFiles, newId, randomHex }) {
  return async function createInquiry(body) {
    const normalized = normalize(body);
    let row = await repository.findOwnedDraft(normalized.key_hash);
    if (row && row.payload_hash !== normalized.payload_hash) throw new HttpError(409, "This submission key belongs to different inquiry details.");
    if (!row) {
      if (normalized.files.length && !privateFiles) throw new HttpError(503, "Private uploads are unavailable.");
      const id = newId();
      row = await repository.createDraft({
        ...normalized,
        id,
        status: "draft",
        files: normalized.files.map((file, index) => ({ ...file, path: `inquiries/${id}/${index}-${randomHex()}.${file.name.split(".").pop().toLowerCase()}` }))
      });
      if (row.payload_hash !== normalized.payload_hash) throw new HttpError(409, "This submission key belongs to different inquiry details.");
    }

    const uploads = [];
    if (row.status !== "submitted") {
      for (const [index, file] of row.files.entries()) {
        if (!(await privateFiles.matches(file))) {
          uploads.push({ index, path: file.path, ...await privateFiles.authorizeUpload(file.path, file.size, file.type), method: "PUT", contentType: file.type });
        }
      }
    }
    return { row, uploads };
  };
}
