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

/*
 * Passwords are server-side only.
 *
 * Render environment variables override these defaults.
 */
const USER_PASSWORDS = {
  aayush: process.env.PASSWORD_AAYUSH || "chat-server-ADMIN",
  hari: process.env.PASSWORD_HARI || "chat-server-1",
  aditya: process.env.PASSWORD_ADITYA || "chat-server-2"
};

const WIPE_CHAT_PASSWORD =
  process.env.WIPE_CHAT_PASSWORD || "chat-server-ADMIN";

const ALLOWED_USERS = new Set(Object.keys(USER_PASSWORDS));

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
  if (!ALLOWED_USERS.has(username)) return false;

  return verifySecret(
    USER_PASSWORDS[username],
    String(candidate ?? "")
  );
}

/*
 * Only Aayush's account can use the wipe function.
 */
function isAdmin(username) {
  return username === "aayush";
}

app.use(express.static(path.join(__dirname, "public")));

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

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add a PostgreSQL database and set DATABASE_URL."
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

      /*
       * LOGIN
       */
      if (data.type === "login") {
        const username = String(
          data.username || ""
        )
          .trim()
          .toLowerCase();

        if (
          !ALLOWED_USERS.has(username) ||
          !verifyPassword(username, data.password)
        ) {
          send(ws, {
            type: "login_error",
            message: "Incorrect username or password."
          });

          return;
        }

        ws.username = username;

        send(ws, {
          type: "login_success",
          username,
          canWipeChat: isAdmin(username)
        });

        try {
          send(ws, {
            type: "history",
            messages: await getHistory()
          });
        } catch (err) {
          console.error("History error:", err);

          send(ws, {
            type: "error",
            message: "Could not load chat history."
          });
        }

        broadcastPresence();

        return;
      }

      /*
       * NORMAL MESSAGE
       */
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

        if (message.length > MAX_MESSAGE_LENGTH) {
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

      /*
       * WIPE CHAT
       */
      if (data.type === "wipe_chat") {
        if (!ws.username) {
          send(ws, {
            type: "wipe_error",
            message: "Log in first."
          });

          return;
        }

        /*
         * Server-side admin check.
         * Changing the frontend cannot bypass this.
         */
        if (!isAdmin(ws.username)) {
          send(ws, {
            type: "wipe_error",
            message:
              "You do not have permission to wipe the chat."
          });

          return;
        }

        /*
         * Verify the separate wipe password.
         */
        if (
          !verifySecret(
            WIPE_CHAT_PASSWORD,
            String(data.password ?? "")
          )
        ) {
          send(ws, {
            type: "wipe_error",
            message: "Incorrect admin password."
          });

          return;
        }

        try {
          await wipeMessages();

          /*
           * Tell every connected user immediately.
           */
          broadcast({
            type: "chat_wiped",
            by: ws.username
          });
        } catch (err) {
          console.error("Wipe error:", err);

          send(ws, {
            type: "wipe_error",
            message: "Could not wipe the chat."
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
        message: "Something went wrong."
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

/*
 * Keep WebSocket connections alive behind Render's proxy.
 */
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

/*
 * START SERVER
 */
initDatabase()
  .then(() => {
    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Chat server listening on port ${PORT}`
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
