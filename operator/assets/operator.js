import { createApiClient, OperatorApiError } from "./api-client.js";
import { allowedTransitions, formatRelativeTime, workStatusLabel } from "./work-state.js";
import { createPushClient } from "./push-client.js";
import { createAuthClient, createCookieAuthClient } from "./auth-client.js";
import { renderPrintEstimation } from "./print-detail.js";
import { renderCustomization } from "./customization-detail.js";
import { renderInvoiceDetail } from "./invoice-detail.js";
import { renderFilamentInventory } from './filament-inventory.js';
import { renderFilamentMatching } from './filament-detail.js';
import {renderCommunications,clearCommunicationDrafts} from './communication-detail.js';
import {renderOperatorModels,clearModelDrafts} from './model-detail.js';

// A sign-in round trip (GitHub redirect, then the Neon session-verifier exchange) can briefly answer 401 before the
// session exists. When `expectSession()` says we just came back from one, wait for it instead of reporting "signed out".
export const SIGN_IN_PENDING_KEY = "operator-sign-in-pending";
const savedLabels = { acknowledge: "Acknowledged", "set-priority": "Priority updated", "set-target-date": "Target date updated", "set-status": "Status updated", "add-note": "Private note added" };
export const savedMessage = (command, item) => `${savedLabels[command.type] ?? "Update saved"} · revision ${item?.revision ?? "?"} saved.`;

export function createOperatorController({ api, view, expectSession = () => false, retry = { attempts: 8, delayMs: 400 }, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const model = { state: "checking-session", operator: null, items: [], detail: null, selectedId: null, detailLoading: false, noteDraft: "" };
  let selectionGeneration = 0;
  const clearPrivate = () => { selectionGeneration++; clearCommunicationDrafts(); clearModelDrafts(); model.items = []; model.detail = null; model.selectedId = null; model.detailLoading = false; };
  async function loadList() { view.state("loading", model); const result = await api.listWork(view.filters?.() ?? { view: "active" }); model.items = result.items ?? []; view.list(model.items); view.state(model.items.length ? "ready" : "empty", model); }
  async function readSession() {
    for (let attempt = 0; ; attempt++) {
      try { return await api.session(); }
      catch (error) {
        if (!(error instanceof OperatorApiError) || error.kind !== "signed-out" || !expectSession() || attempt >= retry.attempts) throw error;
        await wait(retry.delayMs);
      }
    }
  }
  let starting = null;
  // One start at a time, so overlapping callers share a single, monotonic checking -> settled progression.
  function start() {
    return starting ??= (async () => {
      view.state("checking-session", model);
      try { const session = await readSession(); model.operator = session.operator; await loadList(); }
      catch (error) { clearPrivate(); const state = error instanceof OperatorApiError ? error.kind : "error"; view.state(state === "network" ? "offline" : state, model); }
    })().finally(() => { starting = null; });
  }
  async function select(id) {
    const generation = ++selectionGeneration;
    model.selectedId = id; model.detailLoading = true; view.state('loading-detail', model);
    try {
      const detail = await api.getWork(id);
      if (generation !== selectionGeneration || model.selectedId !== id) return;
      model.detail = detail; model.detailLoading = false; view.detail(detail); view.state('ready', model);
    } catch (error) {
      if (generation !== selectionGeneration) return;
      // A failed selection must not reactivate controls for the previous request.
      model.detail = null;
      if (['signed-out', 'forbidden'].includes(error.kind)) clearPrivate();
      view.state(error.kind ?? 'error', model);
    }
  }
  async function command(command) {
    if (!model.selectedId) return;
    if (command.type === "add-note") model.noteDraft = command.body ?? view.noteDraft?.() ?? "";
    try { const result = await api.updateWork(model.selectedId, command); model.detail = { ...model.detail, item: result.item ?? model.detail.item }; if (command.type === "add-note") model.noteDraft = ""; try { const fresh = await api.getWork(model.selectedId); if (Number(fresh.item?.revision) >= Number(model.detail.item?.revision ?? 0)) model.detail = fresh; } catch { /* the update itself succeeded; keep the response copy */ } view.detail(model.detail, { saved: true }); view.announce(savedMessage(command, model.detail.item), "success"); await loadList(); }
    catch (error) { if (error.kind === "conflict") { model.noteDraft ||= view.noteDraft?.() ?? ""; model.detail = await api.getWork(model.selectedId); view.detail(model.detail, { noteDraft: model.noteDraft }); view.announce("This work changed in another window. Review the current version, then try again.", "error"); return; } if (["signed-out", "forbidden"].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); } view.announce(error.message, "error"); }
  }
  async function download(assetId) {
    if (!model.selectedId) return;
    try { const result = await api.printAssetDownload(model.selectedId, assetId); view.announce(`Download link for ${result.filename} expires in 60 seconds.`); view.openDownload?.(result.url); }
    catch (error) { if (["signed-out", "forbidden"].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); } view.announce(error.message, "error"); }
  }
  async function downloadFile(index) {
    if (!model.selectedId) return;
    try { const result = await api.requestFileDownload(model.selectedId, index); view.announce(`Download link for ${result.filename} expires in 60 seconds.`, "success"); view.openDownload?.(result.url); }
    catch (error) { if (["signed-out", "forbidden"].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); } view.announce(error.message, "error"); }
  }
  async function recordRun(run) {
    if (!model.selectedId) return;
    try { await api.recordPrintRun(model.selectedId, run); model.detail = await api.getWork(model.selectedId); view.detail(model.detail); view.announce("Production run recorded."); }
    catch (error) { if (["signed-out", "forbidden"].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); } view.announce(error.message, "error"); }
  }
  async function prepareInquiry(value) {
    if (!model.selectedId) return;
    model.noteDraft = view.noteDraft?.() ?? model.noteDraft;
    try {
      await api.prepareInquiry({ workId: model.selectedId, revision: model.detail.item.revision, ...value });
      model.detail = await api.getWork(model.selectedId); view.detail(model.detail, { noteDraft: model.noteDraft }); await loadList(); view.announce("Operator-prepared project draft created. Customer details and consent still need completion.", "success");
    } catch (error) {
      if (error.kind === "conflict") { model.noteDraft = view.noteDraft?.() ?? ""; model.detail = await api.getWork(model.selectedId); view.detail(model.detail, { noteDraft: model.noteDraft }); }
      if (["signed-out", "forbidden"].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); }
      view.announce(error.kind === "conflict" ? "This work changed. Review the current version before converting." : error.message, "error");
    }
  }
  async function privateOperation(operation) {
    try { return await operation(); }
    catch (error) { if (['signed-out', 'forbidden'].includes(error.kind)) { clearPrivate(); view.state(error.kind, model); } throw error; }
  }
  async function showInventory() {
    try {
      const [stock, policy] = await privateOperation(() => Promise.all([api.listFilament(), api.filamentSettings()]));
      view.inventory({ ...stock, policy }, {
        role: model.operator?.role,
        onSave: filament => privateOperation(() => api.saveFilament(filament)),
        onSaveImported: input => privateOperation(() => api.saveImportedFilament(input)),
        onRefresh: () => privateOperation(() => api.refreshSpoolman()),
        onReload: showInventory,
        onSettingsSave: input => privateOperation(() => api.saveFilamentSettings(input)),
        onSettingsPreview: settings => {
          if (!model.selectedId) throw Error('Select a work request first, then open inventory to preview its matching.');
          return privateOperation(() => api.previewFilamentMatching(model.selectedId, settings));
        },
        onBack: () => view.closeInventory()
      });
    } catch (error) { view.announce(error.message, 'error'); }
  }
  async function filamentAction(action, input, workId = model.detail?.item?.id) {
    if (!workId || model.detailLoading || model.selectedId !== workId || model.detail?.item?.id !== workId) throw Error('The selected work changed or is still loading. Review its current details first.');
    const generation = selectionGeneration;
    return privateOperation(async () => {
      const result = await api[action](workId, input);
      if (action !== 'previewSubstitutionEmail' && model.selectedId === workId && generation === selectionGeneration) {
        const detail = await api.getWork(workId);
        if (model.selectedId === workId && generation === selectionGeneration) { model.detail = detail; view.detail(detail); }
      }
      return result;
    });
  }
  return { prepareInquiry, selectedId: () => model.selectedId, start, loadList, select, command, download, downloadFile, recordRun, showInventory, filamentAction, clearPrivate, snapshot: () => structuredClone(model) };
}

const title = value => String(value ?? "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
function nextWorkAction(item) {
  if (["completed", "declined", "cancelled"].includes(item.status)) return "Review history";
  if (!item.acknowledged) return "Confirm receipt and review";
  if (item.projectDraft) return "Complete project details";
  if (item.kind === "inquiry") return item.status === "waiting_customer" ? "Await customer reply" : "Reply to inquiry";
  return ({submitted:"Review request",triage:"Prepare quote",quoted:"Await quote approval",approved:item.targetDate ? "Schedule production" : "Set target date",scheduled:"Start production",in_progress:"Review production progress",waiting_customer:"Await customer reply"})[item.status] ?? "Review work";
}
function el(name, className, text) { const node = document.createElement(name); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function createDomView(api) {
  const q = selector => document.querySelector(selector); const list = q("#work-list"), detail = q("#detail-content"), placeholder = q("#detail-placeholder"), filters = q("#filters"), status = q("#status-message"), toast = q("#toast"); let controller, toastTimer;
  const view = {
    attach(value) { controller = value; }, filters: () => Object.fromEntries(new FormData(filters)), noteDraft: () => q("#private-note")?.value ?? "",
    state(name, model) {
      document.body.dataset.state = name;
      detail.inert = Boolean(model.detailLoading);
      const checking = name === "checking-session";
      const signedIn = !checking && !["signed-out", "forbidden"].includes(name);
      q("#session-view").hidden = !checking; q("#auth-view").hidden = checking || signedIn; q("#workspace").hidden = !signedIn; q("#sign-out").hidden = !signedIn;
      q("#operator-name").textContent = signedIn ? model.operator?.displayName ?? "Operator" : "";
      q('#filament-inventory').hidden = !signedIn;
      q('#partners-owner').hidden = !signedIn || model.operator?.role !== 'owner';
      if (["signed-out", "forbidden"].includes(name)) { detail.replaceChildren(); const button = q("#sign-in"); button.disabled = false; button.textContent = "Continue with GitHub"; }
      if (name === "forbidden") q("#auth-title").textContent = "This account is not approved.";
      if (["offline", "unavailable", "error"].includes(name)) view.announce(name === "offline" ? "The inbox is offline. Check the connection and retry." : "The inbox could not load. Try again.");
    },
    list(items) { const selectedId = controller?.selectedId?.(); list.replaceChildren(); q("#work-count").textContent = String(items.length); q("#queue-summary").textContent = `${items.length} shown · ${items.filter(item => !item.acknowledged && !["completed", "declined", "cancelled"].includes(item.status)).length} need acknowledgment`; q("#empty-state").hidden = items.length > 0; for (const item of items) { const li = el("li"); li.dataset.id = item.id; li.dataset.active = String(item.id === selectedId); const button = el("button", "work-row"); button.type = "button"; button.append(el("strong", "", item.kind === "inquiry" ? "Inquiry" : item.projectTitle), el("span", "next-action", `Next: ${nextWorkAction(item)}`), el("span", "work-meta", `${item.kind === "inquiry" ? "Inquiry" : title(item.service)} · ${title(workStatusLabel(item))}${item.projectDraft ? " · Project draft" : ""}`), el("span", `priority priority-${item.priority}`, `${title(item.priority)} · ${formatRelativeTime(item.submittedAt)}`)); button.onclick = () => controller.select(item.id); li.append(button); list.append(li); } },
    detail(payload, options = {}) {
      placeholder.hidden = true; detail.hidden = false; detail.replaceChildren(); const { item, files = [], notes = [], events = [], inquiry = null } = payload; const request = payload.request ?? {}; const isInquiry = item.kind === "inquiry";
      const back = el("button", "back", "Back to inbox"); back.type = "button"; back.onclick = () => { document.body.dataset.detail = "closed"; history.pushState({}, "", "/"); };
      const heading = el("header", "job-heading"); heading.append(el("p", "kicker", `${title(workStatusLabel(item))} · revision ${item.revision}`), el("h2", "", isInquiry ? "Inquiry" : request.projectTitle ?? item.projectTitle ?? "Work request"), el("p", "job-id", item.requestId ?? item.id));
      const actions = el("section", "job-actions"); actions.setAttribute("aria-label", "Update work");
      const run = async command => { const controls = [...actions.querySelectorAll("button,select,input")]; actions.setAttribute("aria-busy", "true"); controls.forEach(control => { control.disabled = true; }); try { await controller.command({ ...command, revision: item.revision }); } finally { actions.removeAttribute("aria-busy"); controls.forEach(control => { control.disabled = false; }); } };
      const commandButton = (text, command) => { const button = el("button", "action", text); button.type = "button"; button.onclick = () => run(command); actions.append(button); };
      if (!item.acknowledged) commandButton("Acknowledge", { type: "acknowledge" });
      const priority = el("select"); priority.setAttribute("aria-label", "Priority"); for (const value of ["low", "normal", "high", "urgent"]) { const option = el("option", "", title(value)); option.value = value; option.selected = item.priority === value; priority.append(option); } priority.onchange = () => run({ type: "set-priority", priority: priority.value }); actions.append(priority);
      const date = el("input"); date.type = "date"; date.value = item.targetDate ?? ""; date.setAttribute("aria-label", "Target date"); date.onchange = () => run({ type: "set-target-date", targetDate: date.value || null }); actions.append(date);
      for (const next of allowedTransitions(item)) commandButton(`Move to ${title(workStatusLabel({ ...item, status: next }))}`, { type: "set-status", status: next });
      const facts = el("section", "job-sheet"); facts.append(el("h3", "", isInquiry ? "Inquiry details" : "Request details"));
      if (item.projectDraft) facts.append(el("strong", "draft-badge", "Operator-prepared project draft"), el("p", "", "Incomplete: service-specific details, customer consent and a reviewed planning estimate still need completion. This is not a submitted customer project or an agreed quote."));
      if (inquiry) {
        const source = el("section", "inquiry-source"); source.append(el("h4", "", isInquiry ? "Customer message" : "Original inquiry"));
        for (const [label, value] of [["Name", inquiry.name], ["Reply email", inquiry.replyEmail], ["Inquiry reference", item.inquiryId], ["Message", inquiry.message], ["Reference URL", inquiry.referenceUrl], ["Interest", inquiry.intent]]) if (value) { const row=el("p"); row.append(el("strong", "", `${label}: `), el("span", "", value)); source.append(row); }
        if (inquiry.replyEmail) { const reply = el("a", "action", "Open email reply"); reply.href = `mailto:${encodeURIComponent(inquiry.replyEmail)}?subject=${encodeURIComponent(`Re: inquiry ${item.inquiryId ?? item.id}`)}`; source.append(reply, el("p", "work-meta", "Send replies manually. Acknowledgment and status changes do not verify email delivery.")); }
        facts.append(source);
      }
      if (inquiry && (isInquiry || item.projectDraft)) {
        const invite = el("button", "action", "Copy project-request link"); invite.type="button";
        const fallback = el("input"); fallback.type="text"; fallback.readOnly=true; fallback.hidden=true; fallback.setAttribute("aria-label", "Private project-request link");
        invite.onclick = async () => { invite.disabled=true; fallback.value=""; fallback.hidden=true; try { const result=await api.inviteInquiry(item.id); try { await navigator.clipboard.writeText(result.url); view.announce("Private link copied. Share it manually with the customer; it expires in seven days.", "success"); } catch { fallback.value=result.url; fallback.hidden=false; fallback.focus(); fallback.select(); view.announce("Clipboard unavailable. Copy the private link from the selected field and share it manually."); } } catch(error) { view.announce(error.message, "error"); } finally { invite.disabled=false; } }; facts.append(invite, fallback);
      }
      if (isInquiry) {
        const convert=el("form", "note-form inquiry-convert"); convert.append(el("h4", "", "Convert to project"), el("p", "", "Copy this contact and inquiry context into an incomplete project draft. No customer consent, estimate, invoice or email is created."));
        const service=el("select"); service.id="conversion-service"; service.required=true; for (const [value,label] of [["","Choose a service"],["print","3D printing"],["design","3D design"],["repair","Printer repair"],["consult","Project consult"]]) { const option=el("option","",label); option.value=value; service.append(option); }
        const serviceLabel=el("label","","Project service"); serviceLabel.htmlFor=service.id;
        const projectTitle=el("input"); projectTitle.id="conversion-title"; projectTitle.required=true; projectTitle.maxLength=160; const titleLabel=el("label","","Project title"); titleLabel.htmlFor=projectTitle.id;
        const confirm=el("input"); confirm.type="checkbox"; confirm.id="conversion-confirm"; confirm.required=true; const confirmLabel=el("label","","I reviewed the copied contact and inquiry context."); confirmLabel.htmlFor=confirm.id;
        const submit=el("button","primary","Create project draft"); submit.type="submit"; convert.append(serviceLabel,service,titleLabel,projectTitle,confirm,confirmLabel,submit);
        convert.onsubmit=async event=>{event.preventDefault();if(!convert.reportValidity())return;submit.disabled=true;try{await controller.prepareInquiry({service:service.value,title:projectTitle.value.trim()});}finally{submit.disabled=false;}}; facts.append(convert);
      }
       for (const [key, value] of Object.entries(request)) { if (value == null || value === "" || typeof value === "object") continue; const dl = el("dl"), row = el("div", "fact"); row.append(el("dt", "", title(key)), el("dd", "", String(value))); dl.append(row); facts.append(dl); } if (files.length) { facts.append(el("h4", "", `${files.length} private file${files.length === 1 ? "" : "s"} attached`)); const fileList = el("ul", "request-files"); files.forEach((file, index) => { const row = el("li", "request-file"); row.append(el("span", "request-file-name", file.name ?? `File ${index + 1}`)); if (file.path && file.mode !== "estimate") { const button = el("button", "print-download", "Download"); button.type = "button"; button.setAttribute("aria-label", `Download ${file.name ?? `file ${index + 1}`}`); button.onclick = () => controller.downloadFile(index); row.append(button); } else row.append(el("span", "work-meta", file.mode === "estimate" ? "Estimate model — see Print estimate below" : "Name only — file was not uploaded")); fileList.append(row); }); facts.append(fileList); }
      const form = el("form", "note-form"), note = el("textarea"); note.id = "private-note"; note.maxLength = 4000; note.rows = 4; note.value = options.noteDraft ?? ""; const noteLabel = el("label", "", "Private note"); noteLabel.htmlFor = note.id; const save = el("button", "primary", "Add private note"); save.type = "submit"; form.append(noteLabel, note, save); form.onsubmit = event => { event.preventDefault(); controller.command({ type: "add-note", body: note.value, revision: item.revision }); };
      const activity = el("section", "history"); activity.append(el("h3", "", "Activity")); for (const event of events) activity.append(el("p", "", `${title(event.type)} · ${new Date(event.occurredAt).toLocaleString()}`)); for (const savedNote of notes) activity.append(el("blockquote", "", savedNote.body));
      const onAuthError=()=>{controller.clearPrivate();controller.start();};
      const conversation=renderCommunications({item,request,inquiry,api,onAuthError});
      const models=!isInquiry?renderOperatorModels({item,request,printEstimation:payload.printEstimation,api,onAuthError,onRefresh:()=>controller.selectedId()===item.id?controller.select(item.id):null}):null;
      const print = !isInquiry ? renderPrintEstimation(payload.printEstimation, { onDownload: assetId => controller.download(assetId), onRecordRun: run => controller.recordRun(run),planningOnly:Boolean(item.projectDraft) }) : null;
      const customization = request?.customization ? renderCustomization(request) : null;
      const filament = renderFilamentMatching(payload.filamentMatching, {
        onCommand: input => controller.filamentAction('filamentCommand', input, item.id),
        onPreviewEmail: input => controller.filamentAction('previewSubstitutionEmail', input, item.id),
        onSendEmail: input => controller.filamentAction('sendSubstitutionEmail', input, item.id),
        onInventory: () => controller.showInventory()
      });
      const billing = !isInquiry && !item.projectDraft && controller.snapshot().operator?.role === "owner" ? renderInvoiceDetail({ item, api, onAuthError: () => { controller.clearPrivate(); controller.start(); } }) : null;
      if (options.saved) heading.classList.add("saved-flash"); detail.append(back, heading, actions, conversation, facts, ...(models?[models]:[]), ...(filament ? [filament] : []), ...(customization ? [customization] : []), ...(print ? [print] : []), ...(billing ? [billing] : []), form, activity); list.querySelectorAll("li").forEach(row => { row.dataset.active = String(row.dataset.id === item.id); }); document.body.dataset.detail = "open"; history.pushState({}, "", `/work/${item.id}`); q("#work-detail").focus();
    },
    inventory(data, callbacks) {
      placeholder.hidden = true; detail.hidden = false; detail.replaceChildren(renderFilamentInventory(data, callbacks)); document.body.dataset.detail = 'open'; q('#work-detail').focus();
    },
    closeInventory() {
      detail.replaceChildren(); detail.hidden = true; placeholder.hidden = false; document.body.dataset.detail = 'closed'; history.pushState({}, '', '/'); q('#filament-inventory').focus();
    }, announce(message, kind = "info") { status.textContent = message; toast.textContent = message; toast.dataset.kind = kind; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, kind === "error" ? 9000 : 3500); }, openDownload(url) { location.assign(url); }
  }; filters.onchange = () => controller.loadList(); return view;
}

async function bootstrap() {
  const config = await fetch("/api/config", { cache: "no-store" }).then(r => r.ok ? r.json() : ({})).catch(() => ({}));
  let auth = null;
  if(['authentik','github'].includes(config.authProvider))auth=createCookieAuthClient({apiBase:config.apiBase});
  else if (config.authBase) { const { createNeonBrowserAuth } = await import("./neon-auth.js"); const neon = createNeonBrowserAuth(config.authBase); auth = createAuthClient({ client: neon.client, getToken: neon.getToken }); }
  const signInLabel=config.authProvider==='authentik'?'Sign in':'Continue with GitHub';
  document.querySelector('#sign-in').textContent=signInLabel;
  const store = (() => { try { return sessionStorage; } catch { return null; } })();
  const returningFromSignIn = () => Boolean(store?.getItem(SIGN_IN_PENDING_KEY)) || new URLSearchParams(location.search).has("neon_auth_session_verifier");
  const api = createApiClient({ apiBase: config.apiBase ?? "", getSessionHeaders: auth?.sessionHeaders ?? (async () => ({})) }); const view = createDomView(api); const controller = createOperatorController({ api, view, expectSession: returningFromSignIn }); view.attach(controller);
  document.querySelector('#filament-inventory').onclick = () => controller.showInventory();
  document.querySelector("#sign-in").onclick = async event => {
    if (!auth) return controller.start();
    const button = event.currentTarget; button.disabled = true; button.textContent = "Opening sign-in…"; try { store?.setItem(SIGN_IN_PENDING_KEY, "1"); } catch {}
    try { await auth.signIn("github"); } catch { try { store?.removeItem(SIGN_IN_PENDING_KEY); } catch {} button.disabled = false; button.textContent = signInLabel; view.announce("Sign-in could not start. Try again."); }
  }; document.querySelector("#sign-out").onclick = async () => { controller.clearPrivate(); if (auth) await auth.signOut(); location.assign("/"); };
  const connection = document.querySelector("#connection-status"); const online = () => { connection.textContent = navigator.onLine ? "Online" : "Offline"; connection.dataset.state = navigator.onLine ? "online" : "offline"; }; addEventListener("online", online); addEventListener("offline", online); online();
  if ("serviceWorker" in navigator) { await navigator.serviceWorker.register("/sw.js"); navigator.serviceWorker.addEventListener("message", () => controller.loadList()); }
  const push = createPushClient({ api }); document.querySelector("#notifications").onclick = async () => { const state = await push.getState(); if (!state.supported) return view.announce("Notifications are not available in this browser."); if (state.subscribed) { await push.disable(); view.announce("Notifications disabled."); } else { const result = await push.enable(); view.announce(result.state === "enabled" ? "Notifications enabled." : `Notifications remain ${result.state}.`); } };
  const themes = ["system", "light", "dark"]; document.querySelector("#theme").onclick = event => { const current = document.documentElement.dataset.theme || "system"; const next = themes[(themes.indexOf(current) + 1) % themes.length]; document.documentElement.dataset.theme = next; event.currentTarget.textContent = `Theme: ${next}`; };
  await controller.start(); try { store?.removeItem(SIGN_IN_PENDING_KEY); } catch {} const match = location.pathname.match(/^\/work\/([A-Za-z0-9_-]{8,128})$/); if (match) await controller.select(match[1]);
  let cursor = "0"; setInterval(async () => { if (document.hidden || !navigator.onLine || document.body.dataset.state !== "ready") return; try { const result = await api.events(cursor); if (result.nextCursor) cursor = result.nextCursor; if (result.events?.length) await controller.loadList(); } catch {} }, 20_000);
}
if (typeof document !== "undefined") bootstrap().catch(() => { document.querySelector("#session-view").hidden = true; document.querySelector("#auth-view").hidden = false; });
