const connection = document.querySelector("#connection-status");
connection.textContent = navigator.onLine ? "Online" : "Offline";
connection.dataset.state = navigator.onLine ? "online" : "offline";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
