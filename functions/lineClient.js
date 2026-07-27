const axios = require("axios");

const LINE_REPLY_ENDPOINT   = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_ENDPOINT    = "https://api.line.me/v2/bot/message/push";
const LINE_CONTENT_ENDPOINT = "https://api-data.line.me/v2/bot/message";

async function replyText(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  await axios.post(
    LINE_REPLY_ENDPOINT,
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

async function pushText(to, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  await axios.post(
    LINE_PUSH_ENDPOINT,
    { to, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

async function downloadLineContent(messageId) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = await axios.get(`${LINE_CONTENT_ENDPOINT}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: "arraybuffer"
  });
  return {
    buffer:      Buffer.from(res.data),
    contentType: (res.headers["content-type"] || "application/octet-stream").split(";")[0]
  };
}

module.exports = { replyText, pushText, downloadLineContent };
