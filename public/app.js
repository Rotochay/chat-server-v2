/* ==========================================================================
   CHAT SERVER — frontend
   No credentials live here. Login is verified by the server over the socket.
   Authentication is NEVER persisted: reload = login screen.
   Only the (harmless) theme + chat display prefs are stored locally.
   ========================================================================== */

const USERS = ["aayush", "hari", "aditya"];

const el = {
  login: document.getElementById("login"),
  loginForm: document.getElementById("loginForm"),
  loginError: document.getElementById("loginError"),
  password: document.getElementById("passwordInput"),
  chat: document.getElementById("chat"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  input: document.getElementById("messageInput"),
  status: document.getElementById("status"),
  statusText: document.getElementById("statusText"),
  members: document.getElementById("members"),
  settings: document.getElementById("settings"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsClose: document.getElementById("settingsClose"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  logoutBtn: document.getElementById("logoutBtn")
};

/* ---------------- session state (memory only) ---------------- */
let socket = null;
let reconnectTimer = null;
let intentionallyClosed = false;
let selectedUser = null;
let session = null;          // { username, password } — in memory for this tab only
let authenticated = false;
let onlineSet = new Set();
let lastRendered = null;     // { username, time } for grouping

const prefs = {
  theme: "pop",
  grouping: true,
  timestamps: true
};

/* ---------------- preferences (theme only, never auth) ---------------- */
function loadPrefs() {
  try {
    const raw = localStorage.getItem("chatPrefs");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (["pop", "glass", "matrix"].includes(saved.theme)) prefs.theme = saved.theme;
    if (typeof saved.grouping === "boolean") prefs.grouping = saved.grouping;
    if (typeof saved.timestamps === "boolean") prefs.timestamps = saved.timestamps;
  } catch (err) {
    /* ignore corrupt prefs */
  }
}

function savePrefs() {
  try {
    localStorage.setItem("chatPrefs", JSON.stringify(prefs));
  } catch (err) {
    /* storage unavailable — prefs stay for this session only */
  }
}

function applyPrefs() {
  document.documentElement.setAttribute("data-theme", prefs.theme);
  el.messages.classList.toggle("no-timestamps", !prefs.timestamps);

  document.querySelectorAll("[data-theme-value]").forEach(btn => {
    btn.setAttribute("aria-checked", String(btn.dataset.themeValue === prefs.theme));
  });
  document.querySelectorAll("[data-setting]").forEach(btn => {
    const on = prefs[btn.dataset.setting];
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector(".toggle-state").textContent = on ? "ON" : "OFF";
  });
}

/* ---------------- login screen ---------------- */
document.querySelectorAll("[data-user]").forEach(button => {
  button.addEventListener("click", () => {
    selectedUser = button.dataset.user;
    document.querySelectorAll("[data-user]").forEach(b => {
      b.setAttribute("aria-checked", String(b === button));
    });
    hideLoginError();
    el.password.focus();
  });
});

function showLoginError(message) {
  el.loginError.textContent = message;
  el.loginError.hidden = false;
}

function hideLoginError() {
  el.loginError.hidden = true;
}

el.loginForm.addEventListener("submit", event => {
  event.preventDefault();

  if (!selectedUser) {
    showLoginError("Pick an account first.");
    return;
  }

  const password = el.password.value;
  if (!password) {
    showLoginError("Enter your password.");
    return;
  }

  // Held in memory only, so an automatic reconnect can re-authenticate.
  session = { username: selectedUser, password };
  hideLoginError();
  connect();
});

function enterChat() {
  el.login.classList.add("hidden");
  el.chat.classList.remove("hidden");
  el.password.value = "";
  el.input.focus();
}

function returnToLogin(message) {
  authenticated = false;
  session = null;
  onlineSet = new Set();
  lastRendered = null;
  el.messages.innerHTML = "";
  el.chat.classList.add("hidden");
  el.login.classList.remove("hidden");
  el.password.value = "";
  if (message) showLoginError(message); else hideLoginError();
}

el.logoutBtn.addEventListener("click", () => {
  intentionallyClosed = true;
  clearTimeout(reconnectTimer);
  if (socket) socket.close();
  socket = null;
  setStatus(false);
  renderMembers();
  returnToLogin();
});

/* ---------------- connection ---------------- */
function setStatus(online) {
  el.statusText.textContent = online ? "CONNECTED" : "OFFLINE";
  el.status.classList.toggle("online", online);
  el.status.classList.toggle("offline", !online);
}

function connect() {
  intentionallyClosed = false;

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    if (!session) {
      socket.close();
      return;
    }
    socket.send(JSON.stringify({
      type: "login",
      username: session.username,
      password: session.password
    }));
  });

  socket.addEventListener("message", event => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    if (data.type === "login_success") {
      authenticated = true;
      setStatus(true);
      enterChat();
      return;
    }

    if (data.type === "login_error") {
      intentionallyClosed = true;
      clearTimeout(reconnectTimer);
      socket.close();
      socket = null;
      setStatus(false);
      const wasIn = authenticated;
      returnToLogin(wasIn ? "Session ended. Log in again." : data.message);
      return;
    }

    if (data.type === "history") {
      el.messages.innerHTML = "";
      lastRendered = null;
      data.messages.forEach(addMessage);
      scrollToBottom();
      return;
    }

    if (data.type === "message") {
      const stick = isNearBottom();
      addMessage(data.message);
      if (stick) scrollToBottom();
      return;
    }

    if (data.type === "presence") {
      onlineSet = new Set(data.users);
      renderMembers();
      return;
    }

    if (data.type === "error") {
      console.warn(data.message);
    }
  });

  socket.addEventListener("close", () => {
    setStatus(false);
    onlineSet = new Set();
    renderMembers();

    if (!intentionallyClosed && session) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  });

  socket.addEventListener("error", () => setStatus(false));
}

/* ---------------- composer ---------------- */
el.composer.addEventListener("submit", event => {
  event.preventDefault();

  const message = el.input.value.trim();
  if (!message || !authenticated || !socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({ type: "message", message }));
  el.input.value = "";
  el.input.focus();
});

/* ---------------- rendering ---------------- */
function displayName(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMessage(message) {
  const mine = session && message.username === session.username;
  const stamp = new Date(message.created_at).getTime();

  const grouped =
    prefs.grouping &&
    lastRendered &&
    lastRendered.username === message.username &&
    stamp - lastRendered.time < 5 * 60 * 1000;

  const row = document.createElement("div");
  row.className = "msg" + (mine ? " mine" : "") + (grouped ? " grouped" : "");

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.style.background = `var(--user-${message.username})`;
  avatar.style.color = `var(--user-${message.username}-fg)`;
  avatar.textContent = displayName(message.username).charAt(0);
  avatar.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "msg-body";

  if (!grouped) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";

    const name = document.createElement("span");
    name.className = "msg-name";
    name.style.color = `var(--user-${message.username})`;
    name.textContent = mine ? "You" : displayName(message.username);

    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(message.created_at);

    meta.append(name, time);
    body.appendChild(meta);
  }

  const text = document.createElement("div");
  text.className = "msg-text";
  text.textContent = message.message;
  body.appendChild(text);

  row.append(avatar, body);
  el.messages.appendChild(row);

  lastRendered = { username: message.username, time: stamp };
}

function renderMembers() {
  el.members.innerHTML = "";

  USERS.forEach(user => {
    const online = onlineSet.has(user);

    const item = document.createElement("li");
    item.className = "member" + (online ? " is-online" : "");

    const avatar = document.createElement("span");
    avatar.className = "member-avatar";
    avatar.style.background = `var(--user-${user})`;
    avatar.style.color = `var(--user-${user}-fg)`;
    avatar.textContent = displayName(user).charAt(0);

    const dot = document.createElement("span");
    dot.className = "member-dot";
    dot.textContent = online ? "●" : "○";

    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = displayName(user);

    item.append(avatar, dot, name);
    item.title = `${displayName(user)} — ${online ? "online" : "offline"}`;
    el.members.appendChild(item);
  });
}

function isNearBottom() {
  const gap = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
  return gap < 140;
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

/* ---------------- settings ---------------- */
function openSettings(open) {
  el.settings.classList.toggle("hidden", !open);
  el.settingsOverlay.classList.toggle("hidden", !open);
  el.settingsBtn.setAttribute("aria-expanded", String(open));
}

el.settingsBtn.addEventListener("click", () => openSettings(el.settings.classList.contains("hidden")));
el.settingsClose.addEventListener("click", () => openSettings(false));
el.settingsOverlay.addEventListener("click", () => openSettings(false));

document.addEventListener("keydown", event => {
  if (event.key === "Escape") openSettings(false);
});

document.querySelectorAll("[data-theme-value]").forEach(btn => {
  btn.addEventListener("click", () => {
    prefs.theme = btn.dataset.themeValue;
    applyPrefs();
    savePrefs();
  });
});

document.querySelectorAll("[data-setting]").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.setting;
    prefs[key] = !prefs[key];
    applyPrefs();
    savePrefs();
  });
});

/* ---------------- boot ---------------- */
loadPrefs();
applyPrefs();
renderMembers();
setStatus(false);

// No auto-login, ever. The login screen is always the entry point.
