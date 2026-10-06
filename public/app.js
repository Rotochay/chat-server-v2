/* =========================================================
   CHAT SERVER CLIENT
   ========================================================= */

const loginScreen =
  document.getElementById("loginScreen");

const chatScreen =
  document.getElementById("chatScreen");

const loginForm =
  document.getElementById("loginForm");

const usernameInput =
  document.getElementById("usernameInput");

const passwordInput =
  document.getElementById("passwordInput");

const loginButton =
  document.getElementById("loginButton");

const loginError =
  document.getElementById("loginError");

const chatMessages =
  document.getElementById("chatMessages");

const messageForm =
  document.getElementById("messageForm");

const messageInput =
  document.getElementById("messageInput");

const membersList =
  document.getElementById("membersList");

const onlineCount =
  document.getElementById("onlineCount");

const currentUserLabel =
  document.getElementById("currentUserLabel");

const connectionStatus =
  document.getElementById("connectionStatus");

const logoutButton =
  document.getElementById("logoutButton");

const settingsButton =
  document.getElementById("settingsButton");

const settingsPanel =
  document.getElementById("settingsPanel");

const closeSettingsButton =
  document.getElementById("closeSettings");

const wipeSection =
  document.getElementById("wipeSection");

const wipeButton =
  document.getElementById("wipeButton");

const wipeModal =
  document.getElementById("wipeModal");

const wipeForm =
  document.getElementById("wipeForm");

const wipePassword =
  document.getElementById("wipePassword");

const wipeCancel =
  document.getElementById("wipeCancel");

const wipeError =
  document.getElementById("wipeError");

const themeButtons =
  document.querySelectorAll(
    "[data-theme-choice]"
  );

const groupingToggle =
  document.getElementById("groupingToggle");

const timestampsToggle =
  document.getElementById(
    "timestampsToggle"
  );

/* =========================================================
   STATE
   ========================================================= */

let socket = null;

let session = null;

let authenticated = false;

let onlineSet = new Set();

let canWipeChat = false;

let userDirectory = new Map();

let reconnectTimer = null;

let manuallyLoggedOut = false;

let messageGrouping = true;

let showTimestamps = true;

/* =========================================================
   STORAGE
   ========================================================= */

const savedTheme =
  localStorage.getItem("chatTheme");

const savedGrouping =
  localStorage.getItem(
    "messageGrouping"
  );

const savedTimestamps =
  localStorage.getItem(
    "showTimestamps"
  );

if (savedTheme) {
  document.documentElement.dataset.theme =
    savedTheme;
}

if (savedGrouping !== null) {
  messageGrouping =
    savedGrouping !== "false";
}

if (savedTimestamps !== null) {
  showTimestamps =
    savedTimestamps !== "false";
}

if (groupingToggle) {
  groupingToggle.checked =
    messageGrouping;
}

if (timestampsToggle) {
  timestampsToggle.checked =
    showTimestamps;
}

/* =========================================================
   CONNECTION
   ========================================================= */

function getWebSocketURL() {
  const protocol =
    window.location.protocol === "https:"
      ? "wss:"
      : "ws:";

  return `${protocol}//${window.location.host}`;
}

function connect() {
  if (!session) return;

  manuallyLoggedOut = false;

  clearTimeout(reconnectTimer);

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  setConnectionStatus(
    "connecting",
    "CONNECTING"
  );

  socket = new WebSocket(
    getWebSocketURL()
  );

  socket.addEventListener(
    "open",
    () => {
      setConnectionStatus(
        "connected",
        "ONLINE"
      );

      socket.send(
        JSON.stringify({
          type: "login",
          username: session.username,
          password: session.password
        })
      );
    }
  );

  socket.addEventListener(
    "message",
    handleSocketMessage
  );

  socket.addEventListener(
    "close",
    () => {
      setConnectionStatus(
        "offline",
        "OFFLINE"
      );

      if (
        authenticated &&
        !manuallyLoggedOut
      ) {
        scheduleReconnect();
      }
    }
  );

  socket.addEventListener(
    "error",
    () => {
      setConnectionStatus(
        "offline",
        "CONNECTION ERROR"
      );
    }
  );
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(
    () => {
      connect();
    },
    2000
  );
}

/* =========================================================
   SOCKET EVENTS
   ========================================================= */

function handleSocketMessage(event) {
  let data;

  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }

  switch (data.type) {
    case "login_success":
      handleLoginSuccess(data);
      break;

    case "login_error":
      handleLoginError(data);
      break;

    case "history":
      renderHistory(data.messages || []);
      break;

    case "message":
      addMessage(
        data.message,
        true
      );
      break;

    case "presence":
      onlineSet = new Set(
        data.users || []
      );

      renderMembers();
      break;

    case "chat_wiped":
      clearMessages();

      showSystemMessage(
        `Chat wiped by ${displayName(data.by)}.`
      );

      break;

    case "wipe_error":
      showWipeError(data.message);
      break;

    case "error":
      showToast(data.message);
      break;
  }
}

/* =========================================================
   LOGIN
   ========================================================= */

loginForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    const username =
      usernameInput.value
        .trim()
        .toLowerCase();

    const password =
      passwordInput.value;

    if (!username) {
      showLoginError(
        "Enter your username."
      );

      usernameInput.focus();

      return;
    }

    if (!password) {
      showLoginError(
        "Enter your password."
      );

      passwordInput.focus();

      return;
    }

    session = {
      username,
      password
    };

    loginButton.disabled = true;

    loginButton.textContent =
      "CONNECTING…";

    hideLoginError();

    connect();
  }
);

function handleLoginSuccess(data) {
  authenticated = true;

  canWipeChat =
    Boolean(data.canWipeChat);

  currentUserLabel.textContent =
    displayName(data.username);

  /*
   * The server provides the public user
   * directory. Passwords are never included.
   */
  userDirectory = new Map(
    (data.users || []).map(
      (user) => [
        user.username,
        user
      ]
    )
  );

  loginScreen.classList.add(
    "is-hidden"
  );

  chatScreen.classList.add(
    "is-visible"
  );

  document.body.classList.add(
    "chat-active"
  );

  if (wipeSection) {
    wipeSection.classList.toggle(
      "is-hidden",
      !canWipeChat
    );
  }

  renderMembers();

  loginButton.disabled = false;

  loginButton.textContent =
    "SIGN IN →";

  passwordInput.value = "";

  setTimeout(() => {
    messageInput.focus();
  }, 150);
}

function handleLoginError(data) {
  authenticated = false;

  loginButton.disabled = false;

  loginButton.textContent =
    "SIGN IN →";

  showLoginError(
    data.message ||
      "Incorrect username or password."
  );

  if (socket) {
    socket.close();
  }

  session = null;

  passwordInput.select();
}

function showLoginError(message) {
  loginError.textContent = message;

  loginError.classList.add(
    "is-visible"
  );
}

function hideLoginError() {
  loginError.textContent = "";

  loginError.classList.remove(
    "is-visible"
  );
}

/* =========================================================
   MESSAGES
   ========================================================= */

function renderHistory(messages) {
  chatMessages.innerHTML = "";

  messages.forEach((message) => {
    addMessage(
      message,
      false
    );
  });

  scrollToBottom();
}

function addMessage(message, shouldScroll = true) {
  if (!message) return;

  const info =
    userDirectory.get(
      message.username
    ) || {
      username: message.username,
      displayName:
        formatUsername(
          message.username
        ),
      slot: 1
    };

  const lastMessage =
    chatMessages.lastElementChild;

  const grouped =
    messageGrouping &&
    lastMessage &&
    lastMessage.dataset.username ===
      message.username;

  const row =
    document.createElement("article");

  row.className =
    "message-row";

  if (grouped) {
    row.classList.add(
      "is-grouped"
    );
  }

  row.dataset.username =
    message.username;

  const avatar =
    document.createElement("div");

  avatar.className =
    `message-avatar user-slot-${info.slot || 1}`;

  avatar.textContent =
    getInitial(info.displayName);

  const content =
    document.createElement("div");

  content.className =
    "message-content";

  const meta =
    document.createElement("div");

  meta.className =
    "message-meta";

  const name =
    document.createElement("span");

  name.className =
    `message-name user-slot-text-${info.slot || 1}`;

  name.textContent =
    info.displayName;

  meta.appendChild(name);

  if (showTimestamps) {
    const time =
      document.createElement("time");

    time.className =
      "message-time";

    time.textContent =
      formatTime(message.created_at);

    meta.appendChild(time);
  }

  const bubble =
    document.createElement("div");

  bubble.className =
    "message-bubble";

  bubble.textContent =
    message.message;

  content.appendChild(meta);
  content.appendChild(bubble);

  row.appendChild(avatar);
  row.appendChild(content);

  chatMessages.appendChild(row);

  if (shouldScroll) {
    scrollToBottom();
  }
}

function clearMessages() {
  chatMessages.innerHTML = "";
}

function showSystemMessage(message) {
  const system =
    document.createElement("div");

  system.className =
    "system-message";

  system.textContent =
    message;

  chatMessages.appendChild(system);

  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop =
      chatMessages.scrollHeight;
  });
}

/* =========================================================
   SEND MESSAGE
   ========================================================= */

messageForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    if (
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {
      showToast(
        "You are not connected."
      );

      return;
    }

    const message =
      messageInput.value.trim();

    if (!message) return;

    socket.send(
      JSON.stringify({
        type: "message",
        message
      })
    );

    messageInput.value = "";

    messageInput.focus();
  }
);

messageInput.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      messageForm.requestSubmit();
    }
  }
);

/* =========================================================
   MEMBERS
   ========================================================= */

function renderMembers() {
  if (!membersList) return;

  membersList.innerHTML = "";

  const users =
    [...userDirectory.values()];

  users.forEach((user) => {
    const item =
      document.createElement("div");

    item.className =
      "member";

    if (
      onlineSet.has(
        user.username
      )
    ) {
      item.classList.add(
        "is-online"
      );
    }

    const avatar =
      document.createElement("div");

    avatar.className =
      `member-avatar user-slot-${user.slot || 1}`;

    avatar.textContent =
      getInitial(
        user.displayName
      );

    const info =
      document.createElement("div");

    info.className =
      "member-info";

    const name =
      document.createElement("strong");

    name.textContent =
      user.displayName;

    const status =
      document.createElement("span");

    status.textContent =
      onlineSet.has(
        user.username
      )
        ? "Online"
        : "Offline";

    info.appendChild(name);
    info.appendChild(status);

    const dot =
      document.createElement("span");

    dot.className =
      "member-dot";

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(dot);

    membersList.appendChild(item);
  });

  if (onlineCount) {
    onlineCount.textContent =
      onlineSet.size;
  }
}

/* =========================================================
   SETTINGS
   ========================================================= */

if (settingsButton) {
  settingsButton.addEventListener(
    "click",
    () => {
      settingsPanel.classList.add(
        "is-open"
      );
    }
  );
}

if (closeSettingsButton) {
  closeSettingsButton.addEventListener(
    "click",
    () => {
      settingsPanel.classList.remove(
        "is-open"
      );
    }
  );
}

themeButtons.forEach((button) => {
  button.addEventListener(
    "click",
    () => {
      const theme =
        button.dataset.themeChoice;

      document.documentElement.dataset.theme =
        theme;

      localStorage.setItem(
        "chatTheme",
        theme
      );

      themeButtons.forEach(
        (other) => {
          other.classList.toggle(
            "is-active",
            other === button
          );
        }
      );
    }
  );
});

if (groupingToggle) {
  groupingToggle.addEventListener(
    "change",
    () => {
      messageGrouping =
        groupingToggle.checked;

      localStorage.setItem(
        "messageGrouping",
        String(messageGrouping)
      );

      if (authenticated) {
        renderHistoryFromDOM();
      }
    }
  );
}

if (timestampsToggle) {
  timestampsToggle.addEventListener(
    "change",
    () => {
      showTimestamps =
        timestampsToggle.checked;

      localStorage.setItem(
        "showTimestamps",
        String(showTimestamps)
      );

      if (authenticated) {
        rerenderMessages();
      }
    }
  );
}

/*
 * Re-render existing messages without
 * losing their content.
 */
function rerenderMessages() {
  const rows =
    [...chatMessages.querySelectorAll(
      ".message-row"
    )];

  const data = rows.map((row) => ({
    username:
      row.dataset.username,

    message:
      row.querySelector(
        ".message-bubble"
      )?.textContent || "",

    created_at:
      row.querySelector(
        ".message-time"
      )?.dataset?.timestamp || null
  }));

  /*
   * Timestamp rendering is simpler to
   * refresh by reloading the visible DOM
   * content from existing elements.
   */
  rows.forEach((row) => {
    const meta =
      row.querySelector(
        ".message-meta"
      );

    if (!meta) return;

    let time =
      meta.querySelector(
        ".message-time"
      );

    if (
      showTimestamps &&
      !time
    ) {
      time =
        document.createElement("span");

      time.className =
        "message-time";

      time.textContent = "";

      meta.appendChild(time);
    }

    if (
      !showTimestamps &&
      time
    ) {
      time.remove();
    }
  });

  /*
   * Grouping classes.
   */
  rows.forEach((row, index) => {
    const previous =
      rows[index - 1];

    const grouped =
      messageGrouping &&
      previous &&
      previous.dataset.username ===
        row.dataset.username;

    row.classList.toggle(
      "is-grouped",
      Boolean(grouped)
    );
  });
}

function renderHistoryFromDOM() {
  const rows =
    [...chatMessages.querySelectorAll(
      ".message-row"
    )];

  rows.forEach(
    (row, index) => {
      const previous =
        rows[index - 1];

      const grouped =
        messageGrouping &&
        previous &&
        previous.dataset.username ===
          row.dataset.username;

      row.classList.toggle(
        "is-grouped",
        Boolean(grouped)
      );
    }
  );
}

/* =========================================================
   WIPE CHAT
   ========================================================= */

if (wipeButton) {
  wipeButton.addEventListener(
    "click",
    () => {
      if (!canWipeChat) return;

      wipePassword.value = "";

      wipeError.textContent = "";

      wipeModal.classList.add(
        "is-open"
      );

      setTimeout(() => {
        wipePassword.focus();
      }, 100);
    }
  );
}

if (wipeCancel) {
  wipeCancel.addEventListener(
    "click",
    () => {
      wipeModal.classList.remove(
        "is-open"
      );
    }
  );
}

if (wipeForm) {
  wipeForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      if (
        !socket ||
        socket.readyState !==
          WebSocket.OPEN
      ) {
        showWipeError(
          "You are not connected."
        );

        return;
      }

      socket.send(
        JSON.stringify({
          type: "wipe_chat",
          password:
            wipePassword.value
        })
      );
    }
  );
}

function showWipeError(message) {
  if (!wipeError) return;

  wipeError.textContent =
    message || "Something went wrong.";

  wipeError.classList.add(
    "is-visible"
  );
}

/* =========================================================
   LOGOUT
   ========================================================= */

logoutButton.addEventListener(
  "click",
  () => {
    manuallyLoggedOut = true;

    authenticated = false;

    canWipeChat = false;

    onlineSet.clear();

    userDirectory.clear();

    if (socket) {
      socket.close();
      socket = null;
    }

    clearTimeout(reconnectTimer);

    session = null;

    chatMessages.innerHTML = "";

    passwordInput.value = "";

    usernameInput.value = "";

    loginScreen.classList.remove(
      "is-hidden"
    );

    chatScreen.classList.remove(
      "is-visible"
    );

    document.body.classList.remove(
      "chat-active"
    );

    hideLoginError();

    settingsPanel.classList.remove(
      "is-open"
    );

    wipeModal.classList.remove(
      "is-open"
    );

    setConnectionStatus(
      "offline",
      "OFFLINE"
    );

    usernameInput.focus();
  }
);

/* =========================================================
   HELPERS
   ========================================================= */

function displayName(username) {
  const user =
    userDirectory.get(username);

  if (user) {
    return user.displayName;
  }

  return formatUsername(username);
}

function formatUsername(username) {
  if (!username) return "";

  return username.charAt(0).toUpperCase() +
    username.slice(1);
}

function getInitial(name) {
  return (
    name ||
    "?"
  )
    .trim()
    .charAt(0)
    .toUpperCase();
}

function formatTime(dateString) {
  if (!dateString) {
    return "";
  }

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function setConnectionStatus(
  state,
  text
) {
  if (!connectionStatus) return;

  connectionStatus.textContent =
    text;

  connectionStatus.dataset.state =
    state;
}

function showToast(message) {
  const toast =
    document.createElement("div");

  toast.className =
    "toast";

  toast.textContent =
    message;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add(
      "is-visible"
    );
  });

  setTimeout(() => {
    toast.classList.remove(
      "is-visible"
    );

    setTimeout(() => {
      toast.remove();
    }, 250);
  }, 3000);
}

/* =========================================================
   INITIAL STATE
   ========================================================= */

setConnectionStatus(
  "offline",
  "OFFLINE"
);

if (usernameInput) {
  usernameInput.focus();
}
