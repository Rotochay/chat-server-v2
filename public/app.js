let socket = null;
let username = null;
let reconnectTimer = null;
let intentionallyClosed = false;

const login = document.getElementById("login");
const chat = document.getElementById("chat");
const messages = document.getElementById("messages");
const input = document.getElementById("messageInput");
const composer = document.getElementById("composer");
const status = document.getElementById("status");

document.querySelectorAll("[data-user]").forEach(button => {
  button.addEventListener("click", () => {
    username = button.dataset.user;
    localStorage.setItem("chatUsername", username);

    login.classList.add("hidden");
    chat.classList.remove("hidden");

    connect();
  });
});

composer.addEventListener("submit", event => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message || !socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: "message",
    message
  }));

  input.value = "";
  input.focus();
});

function setStatus(online) {
  status.textContent = online ? "ONLINE" : "OFFLINE";
  status.classList.toggle("online", online);
  status.classList.toggle("offline", !online);
}

function connect() {
  intentionallyClosed = false;

  if (socket &&
      (socket.readyState === WebSocket.OPEN ||
       socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    setStatus(true);

    socket.send(JSON.stringify({
      type: "identify",
      username
    }));
  });

  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);

    if (data.type === "history") {
      messages.innerHTML = "";
      data.messages.forEach(addMessage);
      scrollToBottom();
    }

    if (data.type === "message") {
      addMessage(data.message);
      scrollToBottom();
    }

    if (data.type === "error") {
      console.warn(data.message);
    }
  });

  socket.addEventListener("close", () => {
    setStatus(false);

    if (!intentionallyClosed) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  });

  socket.addEventListener("error", () => {
    setStatus(false);
  });
}

function addMessage(message) {
  const row = document.createElement("div");
  row.className = "message";

  const name = document.createElement("div");
  name.className = "name" + (message.username === username ? " me" : "");
  name.textContent = displayName(message.username);

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = message.message;

  const time = document.createElement("div");
  time.className = "time";
  time.textContent = formatTime(message.created_at);

  row.append(name, text, time);
  messages.appendChild(row);
}

function displayName(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

// Automatically reuse the last selected account.
const savedUser = localStorage.getItem("chatUsername");
if (["aayush", "hari", "aditya"].includes(savedUser)) {
  username = savedUser;
  login.classList.add("hidden");
  chat.classList.remove("hidden");
  connect();
}
