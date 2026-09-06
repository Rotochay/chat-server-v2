const express = require("express");
const http = require("http");
const path = require("path");
const { Pool } = require("pg");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;
const app = express();
const server = http.createServer(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const ALLOWED_USERS = new Set(["aayush", "hari", "aditya"]);
const MAX_HISTORY = 200;
const MAX_MESSAGE_LENGTH = 2000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, database: "error" });
  }
});

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add a PostgreSQL database and set DATABASE_URL.");
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
  const result = await pool.query(`
    SELECT id, username, message, created_at
    FROM (
      SELECT id, username, message, created_at
      FROM messages
      ORDER BY created_at DESC
      LIMIT $1
    ) recent
    ORDER BY created_at ASC
  `, [MAX_HISTORY]);

  return result.rows;
}

async function saveMessage(username, message) {
  const result = await pool.query(`
    INSERT INTO messages (username, message)
    VALUES ($1, $2)
    RETURNING id, username, message, created_at
  `, [username, message]);

  return result.rows[0];
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
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

wss.on("connection", async (ws) => {
  ws.username = null;

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

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "identify") {
        const username = String(data.username || "").trim().toLowerCase();

        if (!ALLOWED_USERS.has(username)) {
          send(ws, {
            type: "error",
            message: "That username is not allowed."
          });
          return;
        }

        ws.username = username;
        send(ws, {
          type: "identified",
          username
        });
        return;
      }

      if (data.type === "message") {
        if (!ws.username) {
          send(ws, {
            type: "error",
            message: "Choose a username first."
          });
          return;
        }

        const message = String(data.message || "").trim();

        if (!message) return;

        if (message.length > MAX_MESSAGE_LENGTH) {
          send(ws, {
            type: "error",
            message: `Message is too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`
          });
          return;
        }

        const saved = await saveMessage(ws.username, message);

        broadcast({
          type: "message",
          message: saved
        });
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
      send(ws, {
        type: "error",
        message: "Something went wrong."
      });
    }
  });
});

initDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Chat server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
