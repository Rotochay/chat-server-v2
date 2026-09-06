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

  logoutBtn: document.getElementById("logoutBtn"),

  wipeSection: document.getElementById("wipeSection"),
  wipeBtn: document.getElementById("wipeBtn"),

  wipeModal: document.getElementById("wipeModal"),
  wipePassword: document.getElementById("wipePassword"),
  wipeError: document.getElementById("wipeError"),
  wipeCancel: document.getElementById("wipeCancel"),
  wipeConfirm: document.getElementById("wipeConfirm")
};


/* ---------------- session state ---------------- */

let socket = null;
let reconnectTimer = null;
let intentionallyClosed = false;

let selectedUser = null;
let session = null;

let authenticated = false;
let onlineSet = new Set();
let lastRendered = null;

let canWipeChat = false;


/* ---------------- preferences ---------------- */

const prefs = {
  theme: "pop",
  grouping: true,
  timestamps: true
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(
      "chatPrefs"
    );

    if (!raw) return;

    const saved = JSON.parse(raw);

    if (
      ["pop", "glass", "matrix"]
        .includes(saved.theme)
    ) {
      prefs.theme = saved.theme;
    }

    if (
      typeof saved.grouping ===
      "boolean"
    ) {
      prefs.grouping = saved.grouping;
    }

    if (
      typeof saved.timestamps ===
      "boolean"
    ) {
      prefs.timestamps =
        saved.timestamps;
    }
  } catch (err) {}
}

function savePrefs() {
  try {
    localStorage.setItem(
      "chatPrefs",
      JSON.stringify(prefs)
    );
  } catch (err) {}
}

function applyPrefs() {
  document.documentElement
    .setAttribute(
      "data-theme",
      prefs.theme
    );

  el.messages.classList.toggle(
    "no-timestamps",
    !prefs.timestamps
  );

  document
    .querySelectorAll(
      "[data-theme-value]"
    )
    .forEach(btn => {
      btn.setAttribute(
        "aria-checked",
        String(
          btn.dataset.themeValue ===
          prefs.theme
        )
      );
    });

  document
    .querySelectorAll(
      "[data-setting]"
    )
    .forEach(btn => {
      const on =
        prefs[
          btn.dataset.setting
        ];

      btn.setAttribute(
        "aria-pressed",
        String(on)
      );

      btn.querySelector(
        ".toggle-state"
      ).textContent =
        on ? "ON" : "OFF";
    });
}


/* ---------------- login ---------------- */

document
  .querySelectorAll("[data-user]")
  .forEach(button => {
    button.addEventListener(
      "click",
      () => {
        selectedUser =
          button.dataset.user;

        document
          .querySelectorAll(
            "[data-user]"
          )
          .forEach(b => {
            b.setAttribute(
              "aria-checked",
              String(b === button)
            );
          });

        hideLoginError();
        el.password.focus();
      }
    );
  });

function showLoginError(message) {
  el.loginError.textContent =
    message;

  el.loginError.hidden = false;
}

function hideLoginError() {
  el.loginError.hidden = true;
}

el.loginForm.addEventListener(
  "submit",
  event => {
    event.preventDefault();

    if (!selectedUser) {
      showLoginError(
        "Pick an account first."
      );

      return;
    }

    const password =
      el.password.value;

    if (!password) {
      showLoginError(
        "Enter your password."
      );

      return;
    }

    session = {
      username: selectedUser,
      password
    };

    hideLoginError();
    connect();
  }
);

function enterChat() {
  el.login.classList.add("hidden");
  el.chat.classList.remove("hidden");

  el.password.value = "";
  el.input.focus();
}

function returnToLogin(message) {
  authenticated = false;
  session = null;
  canWipeChat = false;

  onlineSet = new Set();
  lastRendered = null;

  el.messages.innerHTML = "";

  el.chat.classList.add("hidden");
  el.login.classList.remove("hidden");

  el.password.value = "";

  closeWipeModal();
  updateWipeVisibility();

  if (message) {
    showLoginError(message);
  } else {
    hideLoginError();
  }
}


/* ---------------- logout ---------------- */

el.logoutBtn.addEventListener(
  "click",
  () => {
    intentionallyClosed = true;

    clearTimeout(
      reconnectTimer
    );

    if (socket) {
      socket.close();
    }

    socket = null;

    setStatus(false);
    renderMembers();
    returnToLogin();
  }
);


/* ---------------- connection ---------------- */

function setStatus(online) {
  el.statusText.textContent =
    online
      ? "CONNECTED"
      : "OFFLINE";

  el.status.classList.toggle(
    "online",
    online
  );

  el.status.classList.toggle(
    "offline",
    !online
  );
}

function connect() {
  intentionallyClosed = false;

  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : "ws:";

  socket = new WebSocket(
    `${protocol}//${location.host}`
  );

  socket.addEventListener(
    "open",
    () => {
      if (!session) {
        socket.close();
        return;
      }

      socket.send(
        JSON.stringify({
          type: "login",
          username:
            session.username,
          password:
            session.password
        })
      );
    }
  );

  socket.addEventListener(
    "message",
    event => {
      let data;

      try {
        data = JSON.parse(
          event.data
        );
      } catch (err) {
        return;
      }


      /* LOGIN SUCCESS */

      if (
        data.type ===
        "login_success"
      ) {
        authenticated = true;

        canWipeChat =
          data.canWipeChat === true;

        updateWipeVisibility();

        setStatus(true);
        enterChat();

        return;
      }


      /* LOGIN ERROR */

      if (
        data.type ===
        "login_error"
      ) {
        intentionallyClosed = true;

        clearTimeout(
          reconnectTimer
        );

        if (socket) {
          socket.close();
        }

        socket = null;

        setStatus(false);

        const wasIn =
          authenticated;

        returnToLogin(
          wasIn
            ? "Session ended. Log in again."
            : data.message
        );

        return;
      }


      /* HISTORY */

      if (
        data.type === "history"
      ) {
        el.messages.innerHTML = "";

        lastRendered = null;

        data.messages.forEach(
          addMessage
        );

        renderEmptyState();

        scrollToBottom();

        return;
      }


      /* NEW MESSAGE */

      if (
        data.type === "message"
      ) {
        const stick =
          isNearBottom();

        removeEmptyState();

        addMessage(
          data.message
        );

        if (stick) {
          scrollToBottom();
        }

        return;
      }


      /* CHAT WIPED */

      if (
        data.type ===
        "chat_wiped"
      ) {
        el.messages.innerHTML =
          "";

        lastRendered = null;

        renderEmptyState();

        closeWipeModal();
        openSettings(false);

        return;
      }


      /* WIPE ERROR */

      if (
        data.type ===
        "wipe_error"
      ) {
        showWipeError(
          data.message
        );

        return;
      }


      /* PRESENCE */

      if (
        data.type ===
        "presence"
      ) {
        onlineSet =
          new Set(data.users);

        renderMembers();

        return;
      }


      /* GENERIC ERROR */

      if (
        data.type === "error"
      ) {
        console.warn(
          data.message
        );
      }
    }
  );

  socket.addEventListener(
    "close",
    () => {
      setStatus(false);

      onlineSet = new Set();
      renderMembers();

      if (
        !intentionallyClosed &&
        session
      ) {
        clearTimeout(
          reconnectTimer
        );

        reconnectTimer =
          setTimeout(
            connect,
            2000
          );
      }
    }
  );

  socket.addEventListener(
    "error",
    () => {
      setStatus(false);
    }
  );
}


/* ---------------- composer ---------------- */

el.composer.addEventListener(
  "submit",
  event => {
    event.preventDefault();

    const message =
      el.input.value.trim();

    if (
      !message ||
      !authenticated ||
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "message",
        message
      })
    );

    el.input.value = "";
    el.input.focus();
  }
);


/* ---------------- message rendering ---------------- */

function displayName(value) {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function formatTime(value) {
  return new Date(
    value
  ).toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function addMessage(message) {
  removeEmptyState();

  const mine =
    session &&
    message.username ===
      session.username;

  const stamp =
    new Date(
      message.created_at
    ).getTime();

  const grouped =
    prefs.grouping &&
    lastRendered &&
    lastRendered.username ===
      message.username &&
    stamp -
      lastRendered.time <
      5 * 60 * 1000;

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "msg" +
    (mine ? " mine" : "") +
    (grouped
      ? " grouped"
      : "");

  const avatar =
    document.createElement(
      "div"
    );

  avatar.className =
    "msg-avatar";

  avatar.style.background =
    `var(--user-${message.username})`;

  avatar.style.color =
    `var(--user-${message.username}-fg)`;

  avatar.textContent =
    displayName(
      message.username
    ).charAt(0);

  avatar.setAttribute(
    "aria-hidden",
    "true"
  );

  const body =
    document.createElement(
      "div"
    );

  body.className =
    "msg-body";

  if (!grouped) {
    const meta =
      document.createElement(
        "div"
      );

    meta.className =
      "msg-meta";

    const name =
      document.createElement(
        "span"
      );

    name.className =
      "msg-name";

    name.style.color =
      `var(--user-${message.username})`;

    name.textContent =
      mine
        ? "You"
        : displayName(
            message.username
          );

    const time =
      document.createElement(
        "span"
      );

    time.className =
      "msg-time";

    time.textContent =
      formatTime(
        message.created_at
      );

    meta.append(
      name,
      time
    );

    body.appendChild(
      meta
    );
  }

  const text =
    document.createElement(
      "div"
    );

  text.className =
    "msg-text";

  text.textContent =
    message.message;

  body.appendChild(
    text
  );

  row.append(
    avatar,
    body
  );

  el.messages.appendChild(
    row
  );

  lastRendered = {
    username:
      message.username,
    time: stamp
  };
}


/* ---------------- empty chat ---------------- */

function renderEmptyState() {
  if (
    el.messages.querySelector(
      ".empty-chat"
    )
  ) {
    return;
  }

  const empty =
    document.createElement(
      "div"
    );

  empty.className =
    "empty-chat";

  empty.innerHTML = `
    <div
      class="empty-chat-mark"
      aria-hidden="true"
    >✳</div>

    <h2>NO MESSAGES YET</h2>

    <p>Start the conversation.</p>
  `;

  el.messages.appendChild(
    empty
  );
}

function removeEmptyState() {
  const empty =
    el.messages.querySelector(
      ".empty-chat"
    );

  if (empty) {
    empty.remove();
  }
}


/* ---------------- members ---------------- */

function renderMembers() {
  el.members.innerHTML = "";

  USERS.forEach(user => {
    const online =
      onlineSet.has(user);

    const item =
      document.createElement(
        "li"
      );

    item.className =
      "member" +
      (
        online
          ? " is-online"
          : ""
      );

    const avatar =
      document.createElement(
        "span"
      );

    avatar.className =
      "member-avatar";

    avatar.style.background =
      `var(--user-${user})`;

    avatar.style.color =
      `var(--user-${user}-fg)`;

    avatar.textContent =
      displayName(user)
        .charAt(0);

    const dot =
      document.createElement(
        "span"
      );

    dot.className =
      "member-dot";

    dot.textContent =
      online ? "●" : "○";

    const name =
      document.createElement(
        "span"
      );

    name.className =
      "member-name";

    name.textContent =
      displayName(user);

    item.append(
      avatar,
      dot,
      name
    );

    item.title =
      `${displayName(user)} — ${
        online
          ? "online"
          : "offline"
      }`;

    el.members.appendChild(
      item
    );
  });
}


/* ---------------- scrolling ---------------- */

function isNearBottom() {
  const gap =
    el.messages.scrollHeight -
    el.messages.scrollTop -
    el.messages.clientHeight;

  return gap < 140;
}

function scrollToBottom() {
  el.messages.scrollTop =
    el.messages.scrollHeight;
}


/* ---------------- settings ---------------- */

function openSettings(open) {
  el.settings.classList.toggle(
    "hidden",
    !open
  );

  el.settingsOverlay.classList.toggle(
    "hidden",
    !open
  );

  el.settingsBtn.setAttribute(
    "aria-expanded",
    String(open)
  );
}

el.settingsBtn.addEventListener(
  "click",
  () => {
    openSettings(
      el.settings.classList.contains(
        "hidden"
      )
    );
  }
);

el.settingsClose.addEventListener(
  "click",
  () => openSettings(false)
);

el.settingsOverlay.addEventListener(
  "click",
  () => openSettings(false)
);

document.addEventListener(
  "keydown",
  event => {
    if (event.key === "Escape") {
      openSettings(false);
      closeWipeModal();
    }
  }
);


/* ---------------- theme controls ---------------- */

document
  .querySelectorAll(
    "[data-theme-value]"
  )
  .forEach(btn => {
    btn.addEventListener(
      "click",
      () => {
        prefs.theme =
          btn.dataset.themeValue;

        applyPrefs();
        savePrefs();
      }
    );
  });


/* ---------------- chat settings ---------------- */

document
  .querySelectorAll(
    "[data-setting]"
  )
  .forEach(btn => {
    btn.addEventListener(
      "click",
      () => {
        const key =
          btn.dataset.setting;

        prefs[key] =
          !prefs[key];

        applyPrefs();
        savePrefs();
      }
    );
  });


/* ---------------- wipe chat ---------------- */

function updateWipeVisibility() {
  if (!el.wipeSection) return;

  el.wipeSection.classList.toggle(
    "hidden",
    !canWipeChat
  );
}

function openWipeModal() {
  if (!canWipeChat) return;

  el.wipePassword.value = "";
  el.wipeError.hidden = true;

  el.wipeModal.classList.remove(
    "hidden"
  );

  el.wipePassword.focus();
}

function closeWipeModal() {
  if (!el.wipeModal) return;

  el.wipeModal.classList.add(
    "hidden"
  );

  el.wipePassword.value = "";
  el.wipeError.hidden = true;

  if (el.wipeConfirm) {
    el.wipeConfirm.disabled =
      false;
  }
}

function showWipeError(message) {
  el.wipeError.textContent =
    message;

  el.wipeError.hidden = false;
}

el.wipeBtn?.addEventListener(
  "click",
  openWipeModal
);

el.wipeCancel?.addEventListener(
  "click",
  closeWipeModal
);

el.wipeModal?.addEventListener(
  "click",
  event => {
    if (
      event.target ===
      el.wipeModal
    ) {
      closeWipeModal();
    }
  }
);

el.wipeConfirm?.addEventListener(
  "click",
  () => {
    if (
      !authenticated ||
      !canWipeChat
    ) {
      return;
    }

    const password =
      el.wipePassword.value;

    if (!password) {
      showWipeError(
        "Enter the admin password."
      );

      return;
    }

    if (
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {
      showWipeError(
        "Not connected to the server."
      );

      return;
    }

    el.wipeConfirm.disabled =
      true;

    socket.send(
      JSON.stringify({
        type: "wipe_chat",
        password
      })
    );

    /*
     * Re-enable if the server doesn't
     * respond. A successful wipe closes
     * the modal immediately.
     */
    setTimeout(() => {
      if (
        el.wipeConfirm &&
        !el.wipeModal.classList.contains(
          "hidden"
        )
      ) {
        el.wipeConfirm.disabled =
          false;
      }
    }, 2000);
  }
);


/* ---------------- boot ---------------- */

loadPrefs();
applyPrefs();
renderMembers();
setStatus(false);
updateWipeVisibility();
