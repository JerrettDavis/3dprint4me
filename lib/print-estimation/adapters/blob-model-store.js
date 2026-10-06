// Private Vercel Blob adapter for print models. Upload and download URLs are signed
// for one exact pathname; objects are never public.
import * as blob from "../../blob.js";

export function createBlobModelStore({ store = blob } = {}) {
  return {
    kind: "blob",
    async authorizeUpload(path, size, contentType) {
      const signed = await store.createSignedUpload(path, size, contentType);
      return { uploadUrl: signed.uploadUrl, method: "PUT", headers: {}, bodyType: "file" };
    },
    async inspect(path) {
      try {
        const info = await store.inspectPrivateObject(path);
        return info ? { size: Number(info.size) } : null;
      } catch (error) {
        if (error?.name === "BlobNotFoundError" || error?.status === 404) return null;
        throw error;
      }
    },
    read: (path, maxBytes) => store.readPrivateObject(path, maxBytes),
    put: (path, bytes) => store.putPrivateObject(path, bytes),
    signDownload: (path, seconds) => store.createSignedDownload(path, seconds),
    delete: path => store.deletePrivateObject(path)
  };
}
