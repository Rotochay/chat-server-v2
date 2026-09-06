/* ============================================================
   STATE
   ============================================================ */

let socket = null;
let username = null;
let reconnectTimer = null;
let intentionallyClosed = false;

// grouping state — tracks the last rendered message so consecutive
// messages from the same sender collapse into one visual group
let lastGroup = { el: null, username: null, time: 0 };

const GROUP_WINDOW_MS = 3 * 60 * 1000; // 3 minutes
const KNOWN_USERS = ["aayush", "hari", "aditya"];

/* ============================================================
   DOM REFS
   ============================================================ */

const body = document.body;
const login = document.getElementById("login");
const chat = document.getElementById("chat");
const messagesEl = document.getElementById("messages");
const input = document.getElementById("messageInput");
const composer = document.getElementById("composer");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const currentUserLabel = document.getElementById("currentUserLabel");
const toast = document.getElementById("toast");
const themeSwitcher = document.getElementById("themeSwitcher");
const themeGlide = themeSwitcher.querySelector(".theme-pill-glide");

/* ============================================================
   THEME SWITCHING
   ============================================================ */

const THEMES = ["pop", "glass", "matrix"];

function applyTheme(theme, { persist = true } = {}) {
  if (!THEMES.includes(theme)) theme = "pop";

  body.setAttribute("data-theme", theme);

  themeSwitcher.querySelectorAll("[data-theme-btn]").forEach(btn => {
    const active = btn.dataset.themeBtn === theme;
    btn.setAttribute("aria-selected", String(active));
  });

  const index = THEMES.indexOf(theme);
  themeGlide.style.transform = `translateX(${index * 100}%)`;

  if (persist) {
    try { localStorage.setItem("chatTheme", theme); } catch (_) {}
  }
}

themeSwitcher.querySelectorAll("[data-theme-btn]").forEach(btn => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.themeBtn));
});

// size the glide pill to match a tab's width, then restore saved theme
function initThemeSwitcher() {
  const firstPill = themeSwitcher.querySelector(".theme-pill");
  if (firstPill) {
    themeGlide.style.width = `${firstPill.offsetWidth}px`;
  }

  let savedTheme = "pop";
  try {
    savedTheme = localStorage.getItem("chatTheme") || "pop";
  } catch (_) {}

  applyTheme(savedTheme, { persist: false });
}

/* ============================================================
   LOGIN
   ============================================================ */

document.querySelectorAll("[data-user]").forEach(button => {
  button.addEventListener("click", () => {
    username = button.dataset.user;
    try { localStorage.setItem("chatUsername", username); } catch (_) {}

    enterChat();
  });
});

function enterChat() {
  login.classList.add("hidden");
  chat.classList.remove("hidden");
  currentUserLabel.textContent = displayName(username);
  connect();
}

/* ============================================================
   COMPOSER — Enter to send, Shift+Enter for newline, autosize
   ============================================================ */

composer.addEventListener("submit", event => {
  event.preventDefault();
  sendCurrentMessage();
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendCurrentMessage();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

function sendCurrentMessage() {
  const message = input.value.trim();
  if (!message || !socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: "message",
    message
  }));

  input.value = "";
  input.style.height = "auto";
  input.focus();
}

/* ============================================================
   CONNECTION STATUS
   ============================================================ */

function setStatus(state) {
  // state: "connecting" | "online" | "offline"
  statusEl.classList.remove("online", "offline");

  if (state === "online") {
    statusEl.classList.add("online");
    statusText.textContent = "Connected";
  } else if (state === "connecting") {
    statusEl.classList.add("offline");
    statusText.textContent = "Connecting";
  } else {
    statusEl.classList.add("offline");
    statusText.textContent = "Disconnected";
  }
}

/* ============================================================
   TOAST (replaces browser alert() for error messages)
   ============================================================ */

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

/* ============================================================
   WEBSOCKET — protocol unchanged: identify / identified /
   message / history / error
   ============================================================ */

function connect() {
  intentionallyClosed = false;

  if (socket &&
      (socket.readyState === WebSocket.OPEN ||
       socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setStatus("connecting");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    setStatus("online");

    socket.send(JSON.stringify({
      type: "identify",
      username
    }));
  });

  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);

    if (data.type === "history") {
      renderHistory(data.messages);
    }

    if (data.type === "identified") {
      // server confirmed our username; nothing else required
    }

    if (data.type === "message") {
      appendMessage(data.message);
    }

    if (data.type === "error") {
      showToast(data.message || "Something went wrong.");
    }
  });

  socket.addEventListener("close", () => {
    setStatus("offline");

    if (!intentionallyClosed) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  });

  socket.addEventListener("error", () => {
    setStatus("offline");
  });
}

/* ============================================================
   MESSAGE RENDERING + GROUPING
   ============================================================ */

function renderHistory(list) {
  messagesEl.innerHTML = "";
  lastGroup = { el: null, username: null, time: 0 };
  list.forEach(msg => appendMessage(msg, { animate: false }));
  scrollToBottom();
}

function appendMessage(message, { animate = true } = {}) {
  const time = new Date(message.created_at).getTime();
  const mine = message.username === username;

  const sameGroup =
    lastGroup.username === message.username &&
    (time - lastGroup.time) < GROUP_WINDOW_MS &&
    lastGroup.el;

  if (sameGroup) {
    addBubbleTo(lastGroup.el, message, time);
  } else {
    const groupEl = createGroup(message, time, mine);
    if (!animate) groupEl.style.animation = "none";
    messagesEl.appendChild(groupEl);
    lastGroup = { el: groupEl, username: message.username, time };
  }

  lastGroup.time = time;
  scrollToBottom();
}

function createGroup(message, time, mine) {
  const group = document.createElement("div");
  group.className = "msg-group" + (mine ? " mine" : "");

  if (!mine) {
    const avatar = document.createElement("span");
    avatar.className = `avatar ${avatarClass(message.username)}`;
    avatar.textContent = initial(message.username);
    group.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "msg-body";

  if (!mine) {
    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent = displayName(message.username);
    body.appendChild(sender);
  }

  group.appendChild(body);
  addBubbleTo(group, message, time);

  return group;
}

function addBubbleTo(group, message, time) {
  const body = group.querySelector(".msg-body");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const text = document.createElement("span");
  text.className = "bubble-text";
  text.textContent = message.message;

  const stamp = document.createElement("span");
  stamp.className = "bubble-time";
  stamp.textContent = formatTime(time);

  bubble.append(text, stamp);
  body.appendChild(bubble);
}

/* ============================================================
   HELPERS
   ============================================================ */

const COLOR_SLOT = { aayush: "a", hari: "b", aditya: "c" };

function avatarClass(user) {
  return `avatar-${COLOR_SLOT[user] || "a"}`;
}

function initial(user) {
  return user.charAt(0).toUpperCase();
}

function displayName(user) {
  return user.charAt(0).toUpperCase() + user.slice(1);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ============================================================
   INIT
   ============================================================ */

initThemeSwitcher();

// Automatically reuse the last selected account.
let savedUser = null;
try { savedUser = localStorage.getItem("chatUsername"); } catch (_) {}

if (KNOWN_USERS.includes(savedUser)) {
  username = savedUser;
  enterChat();
}
