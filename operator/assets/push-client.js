export function urlBase64ToUint8Array(value) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}
export function createPushClient({ navigator: nav = navigator, Notification: Notices = Notification, api }) {
  const supported = () => Boolean(nav?.serviceWorker && Notices);
  return {
    async getState() { const config = await api.pushConfig(); return { supported: supported() && config.supported, permission: Notices?.permission ?? "unsupported", subscribed: config.subscribed }; },
    async enable() {
      if (!supported()) return { state: "unsupported" };
      const permission = await Notices.requestPermission();
      if (permission !== "granted") return { state: permission };
      const config = await api.pushConfig();
      const registration = await nav.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const subscription = current ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) });
      await api.pushAction("subscribe", subscription.toJSON()); return { state: "enabled" };
    },
    async disable() { const registration = await nav.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (subscription) { await api.pushAction("unsubscribe", { endpoint: subscription.endpoint }); await subscription.unsubscribe(); } return { state: "disabled" }; },
    sendTest: () => api.pushAction("test")
  };
}
