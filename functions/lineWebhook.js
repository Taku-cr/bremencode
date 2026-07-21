const crypto = require("crypto");
const logger = require("firebase-functions/logger");

function isValidSignature(rawBody, signature, channelSecret) {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
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

  res.status(200).send("OK");
}

module.exports = { handleLineWebhook };
