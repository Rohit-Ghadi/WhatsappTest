require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WEBHOOK_VERIFY_TOKEN,
  PORT = 3000,
} = process.env;

const WHATSAPP_API_URL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

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

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) {
    return res.sendStatus(200); // delivery receipts / status updates
  }

  const message = messages[0];
  const from = message.from; // sender's WhatsApp number
  const messageType = message.type;

  console.log(`Received ${messageType} message from ${from}`);

  if (messageType === "text") {
    const userText = message.text.body;
    console.log(`Text: ${userText}`);

    await sendTextMessage(from, `You said: "${userText}"`);
  } else {
    await sendTextMessage(from, "Sorry, I can only handle text messages for now.");
  }

  res.sendStatus(200);
});

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

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`WhatsApp webhook server running on port ${PORT}`);
});
