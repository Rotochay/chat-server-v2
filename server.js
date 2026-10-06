const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;

const app = express();
const server = http.createServer(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const MAX_HISTORY = 200;
const MAX_MESSAGE_LENGTH = 2000;
const HEARTBEAT_INTERVAL = 30000;

/* =========================================================
   USER CONFIGURATION
   =========================================================
   
   Users are controlled through Render environment variables.

   Example:

   CHAT_USER_1_NAME=aayush
   CHAT_USER_1_PASSWORD=...
   CHAT_USER_2_NAME=hari
   CHAT_USER_2_PASSWORD=...

   This means the frontend never contains passwords.
   ========================================================= */

const USER_COLORS = [
  {
    color: "#7b2ff7",
    foreground: "#ffffff"
  },
  {
    color: "#16c96b",
    foreground: "#07150d"
  },
  {
    color: "#5aa9ff",
    foreground: "#07101c"
  },
  {
    color: "#ff6fae",
    foreground: "#1a0710"
  },
  {
    color: "#ffc928",
    foreground: "#171000"
  },
  {
    color: "#ff7043",
    foreground: "#ffffff"
  },
  {
    color: "#00bfa6",
    foreground: "#031310"
  },
  {
    color: "#9b8cff",
    foreground: "#ffffff"
  }
];

function loadUsers() {
  const users = [];

  for (let i = 1; i <= 20; i++) {
    const rawName = process.env[`CHAT_USER_${i}_NAME`];
    const password = process.env[`CHAT_USER_${i}_PASSWORD`];

    /*
     * Empty slots are allowed.
     */
    if (!rawName && !password) {
      continue;
    }

    if (!rawName || !password) {
      throw new Error(
        `CHAT_USER_${i}_NAME and CHAT_USER_${i}_PASSWORD must both be set.`
      );
    }

    const username = rawName.trim().toLowerCase();

    if (!/^[a-z0-9_-]+$/.test(username)) {
      throw new Error(
        `Invalid username "${username}". Usernames may only contain letters, numbers, "_" and "-".`
      );
    }

    users.push({
      username,
      password,
      slot: users.length + 1,
      displayName: username.charAt(0).toUpperCase() + username.slice(1),
      color:
        USER_COLORS[users.length % USER_COLORS.length].color,
      foreground:
        USER_COLORS[users.length % USER_COLORS.length].foreground
    });
  }

  if (users.length === 0) {
    throw new Error(
      "No users configured. Add CHAT_USER_1_NAME/PASSWORD and the other user environment variables."
    );
  }

  const usernames = users.map((user) => user.username);
  const uniqueUsernames = new Set(usernames);

  if (uniqueUsernames.size !== usernames.length) {
    throw new Error("Duplicate chat usernames detected.");
  }

  return users;
}

const USERS = loadUsers();

const USER_MAP = new Map(
  USERS.map((user) => [user.username, user])
);

const ADMIN_USERNAME = (
  process.env.CHAT_ADMIN_USERNAME || "aayush"
)
  .trim()
  .toLowerCase();

const WIPE_CHAT_PASSWORD =
  process.env.WIPE_CHAT_PASSWORD || "";

if (!USER_MAP.has(ADMIN_USERNAME)) {
  throw new Error(
    `CHAT_ADMIN_USERNAME "${ADMIN_USERNAME}" does not match a configured user.`
  );
}

/*
 * Public information only.
 *
 * Passwords are NEVER sent to the browser.
 */
const PUBLIC_USERS = USERS.map((user) => ({
  username: user.username,
  displayName: user.displayName,
  slot: user.slot,
  color: user.color,
  foreground: user.foreground
}));

const ALLOWED_USERS = new Set(
  USERS.map((user) => user.username)
);

/* =========================================================
   PASSWORD VERIFICATION
   ========================================================= */

function verifySecret(expected, candidate) {
  if (
    typeof expected !== "string" ||
    typeof candidate !== "string"
  ) {
    return false;
  }

  const a = crypto
    .createHash("sha256")
    .update(candidate, "utf8")
    .digest();

  const b = crypto
    .createHash("sha256")
    .update(expected, "utf8")
    .digest();

  return crypto.timingSafeEqual(a, b);
}

function verifyPassword(username, candidate) {
  if (!ALLOWED_USERS.has(username)) {
    return false;
  }

  const user = USER_MAP.get(username);

  return verifySecret(
    user.password,
    String(candidate ?? "")
  );
}

function isAdmin(username) {
  return username === ADMIN_USERNAME;
}

/* =========================================================
   EXPRESS
   ========================================================= */

app.use(
  express.static(path.join(__dirname, "public"))
);

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      database: "error"
    });
  }
});

/* =========================================================
   DATABASE
   ========================================================= */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add your Render PostgreSQL database connection."
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_created_at_idx
    ON messages (created_at DESC)
  `);

  console.log("Database ready.");
}

async function getHistory() {
  const result = await pool.query(
    `
    SELECT id, username, message, created_at
    FROM (
      SELECT id, username, message, created_at
      FROM messages
      ORDER BY created_at DESC
      LIMIT $1
    ) recent
    ORDER BY created_at ASC
    `,
    [MAX_HISTORY]
  );

  return result.rows;
}

async function saveMessage(username, message) {
  const result = await pool.query(
    `
    INSERT INTO messages (username, message)
    VALUES ($1, $2)
    RETURNING id, username, message, created_at
    `,
    [username, message]
  );

  return result.rows[0];
}

async function wipeMessages() {
  await pool.query(
    "TRUNCATE TABLE messages RESTART IDENTITY"
  );
}

/* =========================================================
   WEBSOCKET
   ========================================================= */

const wss = new WebSocketServer({ server });

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const data = JSON.stringify(payload);

  for (const client of wss.clients) {
    if (
      client.readyState === client.OPEN &&
      client.username
    ) {
      client.send(data);
    }
  }
}

function onlineUsers() {
  const users = new Set();

  for (const client of wss.clients) {
    if (
      client.readyState === client.OPEN &&
      client.username
    ) {
      users.add(client.username);
    }
  }

  return [...users];
}

function broadcastPresence() {
  broadcast({
    type: "presence",
    users: onlineUsers()
  });
}

wss.on("connection", (ws) => {
  ws.username = null;
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      /* =====================================================
         LOGIN
         ===================================================== */

      if (data.type === "login") {
        const username = String(
          data.username || ""
        )
          .trim()
          .toLowerCase();

        const password = String(
          data.password || ""
        );

        if (
          !ALLOWED_USERS.has(username) ||
          !verifyPassword(username, password)
        ) {
          send(ws, {
            type: "login_error",
            message:
              "Incorrect username or password."
          });

          return;
        }

        ws.username = username;

        send(ws, {
          type: "login_success",
          username,
          canWipeChat: isAdmin(username),
          users: PUBLIC_USERS
        });

        try {
          send(ws, {
            type: "history",
            messages: await getHistory()
          });
        } catch (err) {
          console.error(
            "History error:",
            err
          );

          send(ws, {
            type: "error",
            message:
              "Could not load chat history."
          });
        }

        broadcastPresence();

        return;
      }

      /* =====================================================
         NORMAL MESSAGE
         ===================================================== */

      if (data.type === "message") {
        if (!ws.username) {
          send(ws, {
            type: "error",
            message: "Log in first."
          });

          return;
        }

        const message = String(
          data.message || ""
        ).trim();

        if (!message) return;

        if (
          message.length >
          MAX_MESSAGE_LENGTH
        ) {
          send(ws, {
            type: "error",
            message:
              `Message is too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`
          });

          return;
        }

        const saved = await saveMessage(
          ws.username,
          message
        );

        broadcast({
          type: "message",
          message: saved
        });

        return;
      }

      /* =====================================================
         WIPE CHAT
         ===================================================== */

      if (data.type === "wipe_chat") {
        if (!ws.username) {
          send(ws, {
            type: "wipe_error",
            message: "Log in first."
          });

          return;
        }

        if (!isAdmin(ws.username)) {
          send(ws, {
            type: "wipe_error",
            message:
              "You do not have permission to wipe the chat."
          });

          return;
        }

        if (
          !verifySecret(
            WIPE_CHAT_PASSWORD,
            String(data.password ?? "")
          )
        ) {
          send(ws, {
            type: "wipe_error",
            message:
              "Incorrect admin password."
          });

          return;
        }

        try {
          await wipeMessages();

          broadcast({
            type: "chat_wiped",
            by: ws.username
          });
        } catch (err) {
          console.error(
            "Wipe error:",
            err
          );

          send(ws, {
            type: "wipe_error",
            message:
              "Could not wipe the chat."
          });
        }

        return;
      }
    } catch (err) {
      console.error(
        "WebSocket message error:",
        err
      );

      send(ws, {
        type: "error",
        message:
          "Something went wrong."
      });
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      ws.username = null;
      broadcastPresence();
    }
  });

  ws.on("error", (err) => {
    console.error(
      "WebSocket error:",
      err.message
    );
  });
});

/* =========================================================
   HEARTBEAT
   ========================================================= */

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL);

wss.on("close", () => {
  clearInterval(heartbeat);
});

/* =========================================================
   START SERVER
   ========================================================= */

initDatabase()
  .then(() => {
    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Chat server listening on port ${PORT}`
        );

        console.log(
          `Configured users: ${USERS.map(
            (user) => user.username
          ).join(", ")}`
        );
      }
    );
  })
  .catch((err) => {
    console.error(
      "Startup failed:",
      err
    );

    process.exit(1);
  });
