/* =========================================================
   ELEMENTS
========================================================= */

const messages = document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const composer =
    document.getElementById("composer");

const connectionText =
    document.getElementById("connectionText");

const connectionDot =
    document.getElementById("connectionDot");

const settingsButton =
    document.getElementById("settingsButton");

const closeSettings =
    document.getElementById("closeSettings");

const settingsBackdrop =
    document.getElementById("settingsBackdrop");


/* =========================================================
   STATE
========================================================= */

let currentUser =
    localStorage.getItem("chatUser") || "aayush";

let currentTheme =
    localStorage.getItem("chatTheme") || "pop";

let socket = null;

let reconnectTimer = null;

let manuallyClosing = false;


/* =========================================================
   INITIAL THEME
========================================================= */

document.body.dataset.theme =
    currentTheme;


/* =========================================================
   HELPERS
========================================================= */

function prettyName(username) {

    return username
        .charAt(0)
        .toUpperCase()
        + username.slice(1);

}


function setConnectionStatus(online) {

    if (online) {

        connectionText.textContent =
            "online";

        connectionDot.classList.add(
            "online"
        );

    } else {

        connectionText.textContent =
            "connecting";

        connectionDot.classList.remove(
            "online"
        );
    }

}


function formatTime(dateValue) {

    const date =
        new Date(dateValue);

    if (Number.isNaN(date.getTime())) {

        return "";

    }

    return date.toLocaleTimeString(
        [],
        {
            hour: "numeric",
            minute: "2-digit"
        }
    );

}


/* =========================================================
   ADD MESSAGE
========================================================= */

function addMessage(message) {

    const mine =
        message.username === currentUser;


    const row =
        document.createElement("div");

    row.className =
        "message-row "
        + (mine ? "mine" : "theirs");


    /* NAME */

    const sender =
        document.createElement("div");

    sender.className =
        "message-sender";

    sender.textContent =
        mine
            ? "You"
            : prettyName(message.username);


    /* BUBBLE */

    const bubble =
        document.createElement("div");

    bubble.className =
        "message-bubble";

    /*
        textContent is deliberately used here
        instead of innerHTML so messages cannot
        inject HTML into the page.
    */

    bubble.textContent =
        message.message;


    /* TIME */

    const time =
        document.createElement("div");

    time.className =
        "message-time";

    time.textContent =
        formatTime(
            message.created_at
        );


    row.appendChild(sender);

    row.appendChild(bubble);

    row.appendChild(time);

    messages.appendChild(row);

}


/* =========================================================
   HISTORY
========================================================= */

function renderHistory(history) {

    messages.innerHTML = "";


    for (const message of history) {

        addMessage(message);

    }


    requestAnimationFrame(() => {

        messages.scrollTop =
            messages.scrollHeight;

    });

}


/* =========================================================
   SCROLL
========================================================= */

function scrollToBottom() {

    requestAnimationFrame(() => {

        messages.scrollTop =
            messages.scrollHeight;

    });

}


/* =========================================================
   CONNECT
========================================================= */

function connect() {

    clearTimeout(
        reconnectTimer
    );


    const protocol =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";


    const socketURL =
        protocol
        + "//"
        + window.location.host;


    socket =
        new WebSocket(socketURL);


    /* ---------- OPEN ---------- */

    socket.addEventListener(
        "open",
        () => {

            setConnectionStatus(true);


            socket.send(
                JSON.stringify({
                    type: "identify",
                    username: currentUser
                })
            );

        }
    );


    /* ---------- MESSAGE ---------- */

    socket.addEventListener(
        "message",
        (event) => {

            let data;


            try {

                data =
                    JSON.parse(
                        event.data
                    );

            } catch {

                return;

            }


            /* HISTORY */

            if (
                data.type === "history"
            ) {

                renderHistory(
                    data.messages || []
                );

                return;
            }


            /* NEW MESSAGE */

            if (
                data.type === "message"
            ) {

                addMessage(data);

                scrollToBottom();

                return;
            }


            /* ERROR */

            if (
                data.type === "error"
            ) {

                console.warn(
                    data.message
                );

            }

        }
    );


    /* ---------- CLOSE ---------- */

    socket.addEventListener(
        "close",
        () => {

            setConnectionStatus(false);


            if (
                !manuallyClosing
            ) {

                reconnectTimer =
                    setTimeout(
                        connect,
                        2000
                    );

            }

        }
    );


    /* ---------- ERROR ---------- */

    socket.addEventListener(
        "error",
        () => {

            setConnectionStatus(false);

        }
    );

}


/* =========================================================
   SEND MESSAGE
========================================================= */

composer.addEventListener(
    "submit",
    (event) => {

        event.preventDefault();


        const message =
            messageInput.value.trim();


        if (!message) {

            return;

        }


        if (
            !socket
            || socket.readyState !== WebSocket.OPEN
        ) {

            return;

        }


        socket.send(
            JSON.stringify({
                type: "message",
                message: message
            })
        );


        messageInput.value = "";

        messageInput.focus();

    }
);


/* =========================================================
   SETTINGS OPEN / CLOSE
========================================================= */

settingsButton.addEventListener(
    "click",
    () => {

        settingsBackdrop.hidden =
            false;

    }
);


closeSettings.addEventListener(
    "click",
    () => {

        settingsBackdrop.hidden =
            true;

    }
);


settingsBackdrop.addEventListener(
    "click",
    (event) => {

        if (
            event.target ===
            settingsBackdrop
        ) {

            settingsBackdrop.hidden =
                true;

        }

    }
);


/* =========================================================
   THEME SELECTOR
========================================================= */

const themeButtons =
    document.querySelectorAll(
        "[data-theme]"
    );


themeButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                currentTheme =
                    button.dataset.theme;


                document.body.dataset.theme =
                    currentTheme;


                localStorage.setItem(
                    "chatTheme",
                    currentTheme
                );


                updateSelections();

            }
        );

    }
);


/* =========================================================
   USER SELECTOR
========================================================= */

const nameButtons =
    document.querySelectorAll(
        "[data-name]"
    );


nameButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const newUser =
                    button.dataset.name;


                if (
                    newUser === currentUser
                ) {

                    return;

                }


                currentUser =
                    newUser;


                localStorage.setItem(
                    "chatUser",
                    currentUser
                );


                updateSelections();


                /*
                    Reconnect so the server sends
                    the history again and the
                    bubbles are recalculated for
                    the new user.
                */

                if (socket) {

                    manuallyClosing = true;

                    socket.close();

                    manuallyClosing = false;

                }


                connect();

            }
        );

    }
);


/* =========================================================
   UPDATE SELECTED BUTTONS
========================================================= */

function updateSelections() {


    themeButtons.forEach(
        (button) => {

            button.classList.toggle(
                "selected",
                button.dataset.theme
                    === currentTheme
            );

        }
    );


    nameButtons.forEach(
        (button) => {

            button.classList.toggle(
                "selected",
                button.dataset.name
                    === currentUser
            );

        }
    );

}


/* =========================================================
   START
========================================================= */

updateSelections();

connect();

messageInput.focus();
