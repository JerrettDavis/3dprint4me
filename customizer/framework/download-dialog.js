// "Download my file" thank-you dialog. Offers a print request first; "No, just give me my file"
// always downloads. The optional email and the choice go to this site's own /api only; the model,
// its settings and any sensitive value never do.
export const DOWNLOAD_ENDPOINT = "/api/inquiry?kind=customize-download";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Fire-and-forget tracking. Resolves false on any failure; never throws, never blocks the file. */
export async function trackDownload({ generatorId, action, email }, fetchFn = globalThis.fetch) {
  try {
    const body = { generatorId, action };
    if (email) body.email = email;
    const response = await fetchFn(DOWNLOAD_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    return !!response?.ok;
  } catch {
    return false;
  }
}

/** The file name a customer gets: the generated one, made safe for any file system. */
export function safeFilename(name) {
  const cleaned = String(name ?? "").replace(/[\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return cleaned || "model.3mf";
}

/** The email field is optional: empty is fine, anything else must look like an address. */
export function checkEmail(value) {
  const email = String(value ?? "").trim();
  return email && !EMAIL.test(email) ? { ok: false, email } : { ok: true, email };
}

export function createDownloadDialog({ doc = document, onDownload, onDownloadStl = () => {}, onPrint, track = trackDownload } = {}) {
  const dialog = doc.createElement("dialog");
  dialog.className = "cz-dialog";
  dialog.id = "cz-download-dialog";
  dialog.setAttribute("aria-labelledby", "cz-dl-title");
  dialog.innerHTML = `
    <form method="dialog" class="cz-dl" novalidate>
      <h2 id="cz-dl-title">Thanks for using 3dprint4.me</h2>
      <p>We're glad you made something. If you'd like it printed for you, in the colors and material you chose, we'd love to do it.</p>
      <div class="field">
        <label for="cz-dl-email">Email (optional)</label>
        <input id="cz-dl-email" type="email" autocomplete="email" inputmode="email" aria-describedby="cz-dl-help cz-dl-error">
        <p class="help" id="cz-dl-help">So we can follow up about this design. Skip it if you'd rather not; your file downloads either way. We only receive this email and which design you made, never your settings or text.</p>
        <p class="cz-dl-error" id="cz-dl-error" role="alert" hidden></p>
      </div>
      <div class="cz-dl-actions">
        <button class="button primary" type="button" data-act="print">Yes, I'd like a print</button>
        <button class="button ghost" type="button" data-act="download">No, just give me my file</button>
      </div>
      <p class="cz-dl-stl"><button class="cz-link-button" type="button" data-act="download-stl">Download as STL instead</button> <span id="cz-dl-stl-note">One combined mesh with no colors, for slicers that don't read 3MF. The 3MF keeps the colored parts separate.</span></p>
      <button class="cz-dl-close" type="button" data-act="close" aria-label="Close without downloading">×</button>
    </form>`;
  doc.body.append(dialog);
  const email = dialog.querySelector("#cz-dl-email");
  const error = dialog.querySelector("#cz-dl-error");
  let opener = null;
  let context = null;

  function close() {
    if (dialog.open) dialog.close();
    opener?.focus?.();
  }
  async function choose(action) {
    const checked = checkEmail(email.value);
    if (!checked.ok) {
      error.textContent = "That email address doesn't look right. Fix it, or clear the box to skip.";
      error.hidden = false;
      email.setAttribute("aria-invalid", "true");
      email.focus();
      return;
    }
    error.hidden = true;
    email.removeAttribute("aria-invalid");
    // The download starts inside the click, so the browser treats it as user-initiated.
    if (action === "download") onDownload(context);
    if (action === "download-stl") onDownloadStl(context);
    const tracked = track({ generatorId: context.generatorId, action: action === "download-stl" ? "download" : action, email: checked.email });
    if (action === "print") { await Promise.race([tracked, new Promise(r => setTimeout(r, 800))]); close(); await onPrint(context); return; }
    close();
  }
  dialog.addEventListener("click", event => {
    const act = event.target.closest?.("[data-act]")?.dataset.act;
    if (act === "close") close();
    else if (act) choose(act);
    else if (event.target === dialog) close();
  });
  dialog.addEventListener("keydown", event => {
    // Enter in the email box must not pick a side for the customer.
    if (event.key === "Enter" && event.target === email) event.preventDefault();
  });
  return {
    element: dialog,
    open(ctx, from) {
      context = ctx;
      opener = from ?? null;
      error.hidden = true;
      email.removeAttribute("aria-invalid");
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
      dialog.querySelector('[data-act="print"]').focus();
    }
  };
}
