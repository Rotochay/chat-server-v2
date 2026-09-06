// ============================================
// CHAT SERVER V3 - APP.JS
// Fixed WebSocket / duplicate message version
// ============================================

const USERS = ["aayush", "hari", "aditya"];

let currentUser = localStorage.getItem("chatUser") || "aayush";
let currentTheme = localStorage.getItem("chatTheme") || "pop";

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
let intentionallyClosed = false;
let connectionGeneration = 0;

// ============================================
// DOM
// ============================================

const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettingsButton = document.getElementById("closeSettings");

const usernameSelect = document.getElementById("usernameSelect");
const themeSelect = document.getElementById("themeSelect");

const connectionStatus = document.getElementById("connectionStatus");


// ============================================
// INITIAL SETUP
// ============================================

document.body.dataset.theme = currentTheme;

if (usernameSelect) {
    usernameSelect.value = currentUser;
}

if (themeSelect) {
    themeSelect.value = currentTheme;
}


// ============================================
// WEBSOCKET URL
// ============================================

function getWebSocketURL() {
    const protocol = window.location.protocol === "https:"
        ? "wss:"
        : "ws:";

    return `${protocol}//${window.location.host}`;
}


// ============================================
// CONNECTION STATUS
// ============================================

function setConnectionStatus(status) {
    if (!connectionStatus) return;

    if (status === "connected") {
        connectionStatus.textContent = "Connected";
        connectionStatus.className = "connected";
    }

    else if (status === "connecting") {
        connectionStatus.textContent = "Connecting...";
        connectionStatus.className = "connecting";
    }

    else {
        connectionStatus.textContent = "Disconnected";
        connectionStatus.className = "disconnected";
    }
}


// ============================================
// CONNECT
// ============================================

function connect() {

    // ----------------------------------------
    // IMPORTANT:
    // Never create another socket if one is
    // already connecting or connected.
    // ----------------------------------------

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    intentionallyClosed = false;

    setConnectionStatus("connecting");

    const myGeneration = ++connectionGeneration;

    const newSocket = new WebSocket(getWebSocketURL());

    socket = newSocket;

    // ----------------------------------------
    // OPEN
    // ----------------------------------------

    newSocket.addEventListener("open", () => {

        // Ignore an old socket that somehow
        // finished opening after a newer one.
        if (myGeneration !== connectionGeneration) {
            newSocket.close();
            return;
        }

        reconnectDelay = 2000;

        setConnectionStatus("connected");

        // Identify ourselves
        newSocket.send(JSON.stringify({
            type: "identify",
            username: currentUser
        }));
    });


    // ----------------------------------------
    // MESSAGE
    // ----------------------------------------

    newSocket.addEventListener("message", (event) => {

        // Ignore messages from an old socket
        if (myGeneration !== connectionGeneration) {
            return;
        }

        let data;

        try {
            data = JSON.parse(event.data);
        } catch (error) {
            console.error("Invalid server message:", event.data);
            return;
        }


        // -------------------------------
        // CHAT HISTORY
        // -------------------------------

        if (data.type === "history") {

            messagesEl.innerHTML = "";

            if (Array.isArray(data.messages)) {

                data.messages.forEach(message => {
                    addMessage(message, false);
                });

            }

            scrollToBottom(false);
        }


        // -------------------------------
        // NEW MESSAGE
        // -------------------------------

        else if (data.type === "message") {

            addMessage(data.message, true);

            scrollToBottom(true);
        }


        // -------------------------------
        // ERROR
        // -------------------------------

        else if (data.type === "error") {

            console.error("Server error:", data.message);
        }
    });


    // ----------------------------------------
    // CLOSE
    // ----------------------------------------

    newSocket.addEventListener("close", () => {

        // Only clear the global socket if this
        // is still the active socket.
        if (socket === newSocket) {
            socket = null;
        }

        setConnectionStatus("disconnected");

        // Don't reconnect if we deliberately
        // closed the connection.
        if (intentionallyClosed) {
            return;
        }

        scheduleReconnect();
    });


    // ----------------------------------------
    // ERROR
    // ----------------------------------------

    newSocket.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
    });
}


// ============================================
// RECONNECT
// ============================================

function scheduleReconnect() {

    // Don't create multiple reconnect timers.
    if (reconnectTimer !== null) {
        return;
    }

    reconnectTimer = setTimeout(() => {

        reconnectTimer = null;

        connect();

        // Gradually increase retry time
        // if Render is temporarily asleep.
        reconnectDelay = Math.min(
            reconnectDelay * 1.5,
            10000
        );

    }, reconnectDelay);
}


// ============================================
// CLOSE SOCKET SAFELY
// ============================================

function closeSocket() {

    intentionallyClosed = true;

    // Cancel reconnect timer
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // Invalidate the current connection
    connectionGeneration++;

    if (socket) {

        const oldSocket = socket;

        socket = null;

        if (
            oldSocket.readyState === WebSocket.OPEN ||
            oldSocket.readyState === WebSocket.CONNECTING
        ) {
            oldSocket.close();
        }
    }
}


// ============================================
// SEND MESSAGE
// ============================================

function sendMessage() {

    const text = messageInput.value.trim();

    if (!text) {
        return;
    }

    // ----------------------------------------
    // Make absolutely sure there is only one
    // active connection.
    // ----------------------------------------

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        return;
    }

    const message = {
        type: "message",
        message: text
    };

    // Clear input BEFORE sending
    messageInput.value = "";

    socket.send(JSON.stringify(message));

    messageInput.focus();
}


// ============================================
// SEND BUTTON
// ============================================

if (sendButton) {

    sendButton.addEventListener("click", () => {
        sendMessage();
    });
}


// ============================================
// ENTER TO SEND
// ============================================

if (messageInput) {

    messageInput.addEventListener("keydown", (event) => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {
            event.preventDefault();
            sendMessage();
        }

    });
}


// ============================================
// ADD MESSAGE
// ============================================

function addMessage(message, animate = true) {

    if (!message || !messageElIsValid(message)) {
        return;
    }

    const wrapper = document.createElement("div");

    wrapper.className = "message-row";

    const isOwnMessage =
        message.username === currentUser;

    if (isOwnMessage) {
        wrapper.classList.add("own");
    } else {
        wrapper.classList.add("other");
    }


    // ----------------------------------------
    // Bubble
    // ----------------------------------------

    const bubble = document.createElement("div");

    bubble.className = "message-bubble";


    // ----------------------------------------
    // Username
    // ----------------------------------------

    if (!isOwnMessage) {

        const username = document.createElement("div");

        username.className = "message-username";

        username.textContent =
            formatUsername(message.username);

        bubble.appendChild(username);
    }


    // ----------------------------------------
    // Message text
    // ----------------------------------------

    const text = document.createElement("div");

    text.className = "message-text";

    // textContent prevents HTML injection
    text.textContent = message.message;

    bubble.appendChild(text);


    // ----------------------------------------
    // Time
    // ----------------------------------------

    if (message.created_at) {

        const time = document.createElement("div");

        time.className = "message-time";

        time.textContent =
            formatTime(message.created_at);

        bubble.appendChild(time);
    }


    wrapper.appendChild(bubble);

    messagesEl.appendChild(wrapper);


    // ----------------------------------------
    // Animation
    // ----------------------------------------

    if (animate) {

        wrapper.classList.add("message-enter");

        requestAnimationFrame(() => {
            wrapper.classList.add("message-enter-active");
        });

    }
}


// ============================================
// MESSAGE VALIDATION
// ============================================

function messageElIsValid(message) {

    if (!message) {
        return false;
    }

    if (
        typeof message.username !== "string" ||
        typeof message.message !== "string"
    ) {
        return false;
    }

    return true;
}


// ============================================
// FORMAT USERNAME
// ============================================

function formatUsername(username) {

    if (!username) {
        return "";
    }

    return username.charAt(0).toUpperCase()
        + username.slice(1);
}


// ============================================
// FORMAT TIME
// ============================================

function formatTime(dateString) {

    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}


// ============================================
// SCROLL
// ============================================

function scrollToBottom(smooth = true) {

    if (!messagesEl) {
        return;
    }

    messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
    });
}


// ============================================
// SETTINGS PANEL
// ============================================

if (settingsButton) {

    settingsButton.addEventListener("click", () => {

        settingsPanel.classList.add("open");
    });
}


if (closeSettingsButton) {

    closeSettingsButton.addEventListener("click", () => {

        settingsPanel.classList.remove("open");
    });
}


// ============================================
// CLOSE SETTINGS WHEN CLICKING OUTSIDE
// ============================================

document.addEventListener("click", (event) => {

    if (!settingsPanel || !settingsButton) {
        return;
    }

    if (!settingsPanel.classList.contains("open")) {
        return;
    }

    const clickedInsidePanel =
        settingsPanel.contains(event.target);

    const clickedSettingsButton =
        settingsButton.contains(event.target);

    if (
        !clickedInsidePanel &&
        !clickedSettingsButton
    ) {
        settingsPanel.classList.remove("open");
    }
});


// ============================================
// CHANGE THEME
// ============================================

if (themeSelect) {

    themeSelect.addEventListener("change", () => {

        currentTheme = themeSelect.value;

        localStorage.setItem(
            "chatTheme",
            currentTheme
        );

        document.body.dataset.theme =
            currentTheme;
    });
}


// ============================================
// CHANGE USER
// ============================================

if (usernameSelect) {

    usernameSelect.addEventListener("change", () => {

        const newUser = usernameSelect.value;

        if (!USERS.includes(newUser)) {
            return;
        }

        currentUser = newUser;

        localStorage.setItem(
            "chatUser",
            currentUser
        );

        /*
         * IMPORTANT:
         *
         * We do NOT close/reopen the WebSocket
         * here.
         *
         * Doing that was one of the things that
         * could cause multiple sockets to exist.
         *
         * Instead, simply identify the existing
         * connection as the new user.
         */

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {

            socket.send(JSON.stringify({
                type: "identify",
                username: currentUser
            }));
        }

        // Refresh the message alignment.
        refreshMessageAlignment();
    });
}


// ============================================
// REFRESH MESSAGE ALIGNMENT
// ============================================

function refreshMessageAlignment() {

    const rows =
        messagesEl.querySelectorAll(".message-row");

    rows.forEach(row => {

        row.classList.remove("own");
        row.classList.remove("other");
    });

    /*
     * Re-rendering the history is cleaner than
     * trying to modify every existing bubble.
     */

    requestHistory();
}


// ============================================
// REQUEST HISTORY
// ============================================

function requestHistory() {

    if (
        socket &&
        socket.readyState === WebSocket.OPEN
    ) {

        socket.send(JSON.stringify({
            type: "request_history"
        }));
    }
}


// ============================================
// PAGE VISIBILITY
// ============================================

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState === "visible"
        ) {

            // If the browser suspended the
            // connection, restore it.

            if (
                !socket ||
                socket.readyState === WebSocket.CLOSED
            ) {
                connect();
            }
        }
    }
);


// ============================================
// ONLINE / OFFLINE
// ============================================

window.addEventListener("online", () => {

    if (
        !socket ||
        socket.readyState === WebSocket.CLOSED
    ) {
        connect();
    }
});


window.addEventListener("offline", () => {

    setConnectionStatus("disconnected");
});


// ============================================
// CLEANUP
// ============================================

window.addEventListener("beforeunload", () => {

    intentionallyClosed = true;

    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (socket) {

        socket.close();
        socket = null;
    }
});


// ============================================
// START
// ============================================

connect();
