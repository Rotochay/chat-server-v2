# Chat Server V2

Private three-account WebSocket chat with permanent PostgreSQL history.

## Accounts

- Aayush — `aayush`
- Hari — `hari`
- Aditya — `aditya`

## What changed from V1?

Messages are now stored in PostgreSQL.

Refreshing the page, losing the WebSocket connection, or leaving the site idle does not delete messages.

The server loads the latest 200 messages whenever a browser connects.

## Local setup

Requirements:

- Node.js 18+
- PostgreSQL

Install:

```bash
npm install
```

Set the database URL:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
```

Run:

```bash
npm start
```

Open:

```text
http://localhost:10000
```

## Render setup

Create a PostgreSQL database in Render.

Then create a Web Service from this repository.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Add the PostgreSQL connection string to the web service as:

```text
DATABASE_URL
```

The server automatically creates the `messages` table on first startup.

## Important

This V2 intentionally keeps the simple three-account prototype from the original project. It is not an authentication/security system. Anyone who can access the site can choose one of the three usernames.

For a later V3, add real authentication, message deletion, rate limiting, online presence, typing indicators, and better database management.
