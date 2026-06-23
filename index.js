require("dotenv").config();
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const axios = require("axios");

const app = express();
app.use(express.json());

const {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WEBHOOK_VERIFY_TOKEN,
  RENDER_EXTERNAL_URL,
  PORT = 3000,
} = process.env;

const WHATSAPP_API_URL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// ── HTTP server (shared by Express + WebSocket) ─────────────────────────────
const server = http.createServer(app);

// ── WebSocket server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  console.log(`WebSocket client connected (${wss.clients.size} total)`);

  ws.send(JSON.stringify({ type: "connected", message: "Listening for WhatsApp messages..." }));

  ws.on("close", () => {
    console.log(`WebSocket client disconnected (${wss.clients.size} remaining)`);
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

// ── Webhook verification (GET) ──────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ── Incoming messages (POST) ────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const body = req.body;

  console.log("--- POST /webhook ---");
  console.log(JSON.stringify(body, null, 2));

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) {
    // Status updates / delivery receipts — broadcast those too
    if (value?.statuses) {
      broadcast({ type: "status", data: value.statuses[0] });
    }
    return res.sendStatus(200);
  }

  const message = messages[0];
  const from = message.from;
  const messageType = message.type;
  const contact = value?.contacts?.[0];

  console.log(`Received ${messageType} message from ${from}`);

  // Build a clean event object and broadcast to all WS clients
  const event = {
    type: "message",
    from,
    name: contact?.profile?.name ?? null,
    messageType,
    timestamp: message.timestamp,
    messageId: message.id,
    text: messageType === "text" ? message.text.body : null,
    media: ["image", "audio", "video", "document", "sticker"].includes(messageType)
      ? message[messageType]
      : null,
    location: messageType === "location" ? message.location : null,
    raw: message,
  };

  broadcast(event);

  // Echo reply for text messages
  if (messageType === "text") {
    await sendTextMessage(from, `You said: "${message.text.body}"`);
  }

  res.sendStatus(200);
});

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.sendStatus(200));

// ── Keep Render free tier alive ─────────────────────────────────────────────
if (RENDER_EXTERNAL_URL) {
  setInterval(() => {
    axios.get(`${RENDER_EXTERNAL_URL}/health`).catch(() => {});
  }, 14 * 60 * 1000);
}

// ── Helper: send a text message ─────────────────────────────────────────────
async function sendTextMessage(to, text) {
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`Message sent to ${to}: message_id=${response.data.messages?.[0]?.id}`);
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error("Failed to send message:", JSON.stringify(detail, null, 2));
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
