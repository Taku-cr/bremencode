const crypto = require("crypto");
const axios  = require("axios");
const logger = require("firebase-functions/logger");

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

function isValidSignature(rawBody, signature, channelSecret) {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

async function replyText(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  await axios.post(
    LINE_REPLY_ENDPOINT,
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  await replyText(event.replyToken, event.message.text);
}

async function handleLineWebhook(req, res) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = req.get("x-line-signature");

  if (channelSecret && signature) {
    const valid = isValidSignature(req.rawBody, signature, channelSecret);
    if (!valid) {
      logger.warn("LINE署名検証に失敗しました");
      res.status(401).send("invalid signature");
      return;
    }
  }

  const events = req.body?.events || [];
  logger.info("LINE webhook received", { count: events.length });

  try {
    await Promise.all(events.map(handleEvent));
  } catch (err) {
    logger.error("LINE返信処理でエラーが発生しました", err);
  }

  res.status(200).send("OK");
}

module.exports = { handleLineWebhook };
