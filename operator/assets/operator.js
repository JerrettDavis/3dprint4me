import { createApiClient, OperatorApiError } from "./api-client.js";
import { allowedTransitions, formatRelativeTime } from "./work-state.js";
import { createPushClient } from "./push-client.js";
import { createAuthClient } from "./auth-client.js";

export function createOperatorController({ api, view }) {
  const model = { state: "checking-session", operator: null, items: [], detail: null, selectedId: null, noteDraft: "" };
  const clearPrivate = () => { model.items = []; model.detail = null; model.selectedId = null; };
  async function loadList() { view.state("loading", model); const result = await api.listWork(view.filters?.() ?? { view: "active" }); model.items = result.items ?? []; view.list(model.items); view.state(model.items.length ? "ready" : "empty", model); }
  async function start() { view.state("checking-session", model); try { const session = await api.session(); model.operator = session.operator; await loadList(); } catch (error) { clearPrivate(); const state = error instanceof OperatorApiError ? error.kind : "error"; view.state(state === "network" ? "offline" : state, model); } }
  async function select(id) { model.selectedId = id; view.state("loading-detail", model); try { model.detail = await api.getWork(id); view.detail(model.detail); view.state("ready", model); } catch (error) { if (["signed-out", "forbidden"].includes(error.kind)) clearPrivate(); view.state(error.kind ?? "error", model); } }
  async function command(command) {
    if (!model.selectedId) return;
    if (command.type === "add-note") model.noteDraft = command.body ?? view.noteDraft?.() ?? "";
    try { const result = await api.updateWork(model.selectedId, command); model.detail = { ...model.detail, item: result.item ?? model.detail.item }; if (command.type === "add-note") model.noteDraft = ""; view.detail(model.detail); view.announce("Update saved."); await loadList(); }
    catch (error) { if (error.kind === "conflict") { model.noteDraft ||= view.noteDraft?.() ?? ""; model.detail = await api.getWork(model.selectedId); view.detail(model.detail, { noteDraft: model.noteDraft }); view.announce("This work changed in another window. Review the current version, then try again."); return; } if (["signed-out", "forbidden"].includes(error.kind)) clearPrivate(); view.state(error.kind ?? "error", model); view.announce(error.message); }
  }
  return { start, loadList, select, command, clearPrivate, snapshot: () => structuredClone(model) };
}

const title = value => String(value ?? "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
function el(name, className, text) { const node = document.createElement(name); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function createDomView() {
  const q = selector => document.querySelector(selector); const list = q("#work-list"), detail = q("#detail-content"), placeholder = q("#detail-placeholder"), filters = q("#filters"), status = q("#status-message"); let controller;
  const view = {
    attach(value) { controller = value; }, filters: () => Object.fromEntries(new FormData(filters)), noteDraft: () => q("#private-note")?.value ?? "",
    state(name, model) { document.body.dataset.state = name; const signedIn = !["checking-session", "signed-out", "forbidden"].includes(name); q("#auth-view").hidden = signedIn; q("#workspace").hidden = !signedIn; q("#sign-out").hidden = !signedIn; q("#operator-name").textContent = signedIn ? model.operator?.displayName ?? "Operator" : ""; if (name === "forbidden") q("#auth-title").textContent = "This account is not approved."; if (["offline", "unavailable", "error"].includes(name)) view.announce(name === "offline" ? "The inbox is offline. Check the connection and retry." : "The inbox could not load. Try again."); },
    list(items) { list.replaceChildren(); q("#work-count").textContent = String(items.length); q("#empty-state").hidden = items.length > 0; for (const item of items) { const li = el("li"); const button = el("button", "work-row"); button.type = "button"; button.append(el("strong", "", item.projectTitle), el("span", "work-meta", `${title(item.service)} · ${title(item.status)}`), el("span", `priority priority-${item.priority}`, `${title(item.priority)} · ${formatRelativeTime(item.submittedAt)}`)); button.onclick = () => controller.select(item.id); li.append(button); list.append(li); } },
    detail(payload, options = {}) {
      placeholder.hidden = true; detail.hidden = false; detail.replaceChildren(); const { item, request = {}, files = [], notes = [], events = [] } = payload;
      const back = el("button", "back", "Back to inbox"); back.type = "button"; back.onclick = () => { document.body.dataset.detail = "closed"; history.pushState({}, "", "/"); };
      const heading = el("header", "job-heading"); heading.append(el("p", "kicker", `${title(item.status)} · revision ${item.revision}`), el("h2", "", request.projectTitle ?? item.projectTitle ?? "Work request"), el("p", "job-id", item.requestId ?? item.id));
      const actions = el("section", "job-actions"); actions.setAttribute("aria-label", "Update work");
      const commandButton = (text, command) => { const button = el("button", "", text); button.type = "button"; button.onclick = () => controller.command({ ...command, revision: item.revision }); actions.append(button); };
      if (!item.acknowledged) commandButton("Acknowledge", { type: "acknowledge" });
      const priority = el("select"); priority.setAttribute("aria-label", "Priority"); for (const value of ["low", "normal", "high", "urgent"]) { const option = el("option", "", title(value)); option.value = value; option.selected = item.priority === value; priority.append(option); } priority.onchange = () => controller.command({ type: "set-priority", priority: priority.value, revision: item.revision }); actions.append(priority);
      const date = el("input"); date.type = "date"; date.value = item.targetDate ?? ""; date.setAttribute("aria-label", "Target date"); date.onchange = () => controller.command({ type: "set-target-date", targetDate: date.value || null, revision: item.revision }); actions.append(date);
      for (const next of allowedTransitions(item)) commandButton(`Move to ${title(next)}`, { type: "set-status", status: next });
      const facts = el("section", "job-sheet"); facts.append(el("h3", "", "Request details")); for (const [key, value] of Object.entries(request)) { if (value == null || value === "" || typeof value === "object") continue; const dl = el("dl"), row = el("div", "fact"); row.append(el("dt", "", title(key)), el("dd", "", String(value))); dl.append(row); facts.append(dl); } if (files.length) facts.append(el("p", "", `${files.length} private file${files.length === 1 ? "" : "s"} attached`));
      const form = el("form", "note-form"), note = el("textarea"); note.id = "private-note"; note.maxLength = 4000; note.rows = 4; note.value = options.noteDraft ?? ""; const noteLabel = el("label", "", "Private note"); noteLabel.htmlFor = note.id; const save = el("button", "primary", "Add private note"); save.type = "submit"; form.append(noteLabel, note, save); form.onsubmit = event => { event.preventDefault(); controller.command({ type: "add-note", body: note.value, revision: item.revision }); };
      const activity = el("section", "history"); activity.append(el("h3", "", "Activity")); for (const event of events) activity.append(el("p", "", `${title(event.type)} · ${new Date(event.occurredAt).toLocaleString()}`)); for (const savedNote of notes) activity.append(el("blockquote", "", savedNote.body));
      detail.append(back, heading, actions, facts, form, activity); document.body.dataset.detail = "open"; history.pushState({}, "", `/work/${item.id}`); q("#work-detail").focus();
    }, announce(message) { status.textContent = message; }
  }; filters.onchange = () => controller.loadList(); return view;
}

async function bootstrap() {
  const config = await fetch("/api/config", { cache: "no-store" }).then(r => r.ok ? r.json() : ({})).catch(() => ({}));
  let auth = null; if (config.authBase) { const { createNeonBrowserAuth } = await import("./neon-auth.js"); const neon = createNeonBrowserAuth(config.authBase); auth = createAuthClient({ client: neon.client, getToken: neon.getToken }); }
  const api = createApiClient({ apiBase: config.apiBase ?? "", getSessionHeaders: auth?.sessionHeaders ?? (async () => ({})) }); const view = createDomView(); const controller = createOperatorController({ api, view }); view.attach(controller);
  document.querySelector("#sign-in").onclick = () => auth ? auth.signIn("github") : controller.start(); document.querySelector("#sign-out").onclick = async () => { controller.clearPrivate(); if (auth) await auth.signOut(); location.assign("/"); };
  const connection = document.querySelector("#connection-status"); const online = () => { connection.textContent = navigator.onLine ? "Online" : "Offline"; connection.dataset.state = navigator.onLine ? "online" : "offline"; }; addEventListener("online", online); addEventListener("offline", online); online();
  if ("serviceWorker" in navigator) { await navigator.serviceWorker.register("/sw.js"); navigator.serviceWorker.addEventListener("message", () => controller.loadList()); }
  const push = createPushClient({ api }); document.querySelector("#notifications").onclick = async () => { const state = await push.getState(); if (!state.supported) return view.announce("Notifications are not available in this browser."); if (state.subscribed) { await push.disable(); view.announce("Notifications disabled."); } else { const result = await push.enable(); view.announce(result.state === "enabled" ? "Notifications enabled." : `Notifications remain ${result.state}.`); } };
  const themes = ["system", "light", "dark"]; document.querySelector("#theme").onclick = event => { const current = document.documentElement.dataset.theme || "system"; const next = themes[(themes.indexOf(current) + 1) % themes.length]; document.documentElement.dataset.theme = next; event.currentTarget.textContent = `Theme: ${next}`; };
  await controller.start(); const match = location.pathname.match(/^\/work\/([A-Za-z0-9_-]{8,128})$/); if (match) await controller.select(match[1]);
  let cursor = "0"; setInterval(async () => { if (document.hidden || !navigator.onLine || document.body.dataset.state !== "ready") return; try { const result = await api.events(cursor); if (result.nextCursor) cursor = result.nextCursor; if (result.events?.length) await controller.loadList(); } catch {} }, 20_000);
}
if (typeof document !== "undefined") bootstrap();
