const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({
    server
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: process.env.DATABASE_URL
        ? {
            rejectUnauthorized: false
        }
        : false
});

const PORT = process.env.PORT || 10000;

const ALLOWED_USERS = new Set([
    "aayush",
    "hari",
    "aditya"
]);

const MAX_HISTORY = 200;
const MAX_MESSAGE_LENGTH = 2000;


/* ---------------- DATABASE ---------------- */

async function setupDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    console.log("Database ready.");
}


async function getHistory() {

    const result = await pool.query(
        `
        SELECT
            id,
            username,
            message,
            created_at
        FROM messages
        ORDER BY created_at DESC, id DESC
        LIMIT $1
        `,
        [MAX_HISTORY]
    );

    return result.rows.reverse();
}


async function saveMessage(username, message) {

    const result = await pool.query(
        `
        INSERT INTO messages
            (username, message)
        VALUES
            ($1, $2)
        RETURNING
            id,
            username,
            message,
            created_at
        `,
        [
            username,
            message
        ]
    );

    return result.rows[0];
}


/* ---------------- HTTP ---------------- */

app.use(express.static("public"));


app.get("/health", async (req, res) => {

    try {

        await pool.query("SELECT 1");

        res.json({
            ok: true,
            database: true
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            ok: false,
            database: false
        });
    }
});


/* ---------------- WEBSOCKET ---------------- */

function broadcast(data) {

    const message = JSON.stringify(data);

    for (const client of wss.clients) {

        if (client.readyState === 1) {

            client.send(message);
        }
    }
}


wss.on("connection", async (ws) => {

    ws.username = null;

    console.log("WebSocket connected.");

    /*
        Send existing messages immediately.
    */

    try {

        const history = await getHistory();

        ws.send(
            JSON.stringify({
                type: "history",
                messages: history
            })
        );

    } catch (error) {

        console.error("History error:", error);

        ws.send(
            JSON.stringify({
                type: "error",
                message: "Could not load message history."
            })
        );
    }


    ws.on("message", async (raw) => {

        let data;

        try {

            data = JSON.parse(raw.toString());

        } catch {

            return;
        }


        /* ---------- IDENTIFY ---------- */

        if (data.type === "identify") {

            const username = String(data.username || "").toLowerCase();

            if (!ALLOWED_USERS.has(username)) {

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown user."
                    })
                );

                return;
            }

            ws.username = username;

            console.log(
                `${username} connected.`
            );

            return;
        }


        /* ---------- MESSAGE ---------- */

        if (data.type === "message") {

            if (!ws.username) {

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Choose a username first."
                    })
                );

                return;
            }


            if (typeof data.message !== "string") {

                return;
            }


            const message = data.message.trim();


            if (!message) {

                return;
            }


            if (message.length > MAX_MESSAGE_LENGTH) {

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Message is too long."
                    })
                );

                return;
            }


            try {

                const saved = await saveMessage(
                    ws.username,
                    message
                );

                broadcast({
                    type: "message",
                    ...saved
                });

            } catch (error) {

                console.error(
                    "Message save error:",
                    error
                );

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Message could not be saved."
                    })
                );
            }
        }
    });


    ws.on("close", () => {

        console.log(
            `${ws.username || "Unknown user"} disconnected.`
        );
    });
});


/* ---------------- START ---------------- */

setupDatabase()
    .then(() => {

        server.listen(
            PORT,
            () => {

                console.log(
                    `Chat server listening on port ${PORT}`
                );
            }
        );

    })
    .catch((error) => {

        console.error(
            "Database setup failed:",
            error
        );

        process.exit(1);
    });
