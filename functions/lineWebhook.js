const crypto = require("crypto");
const axios  = require("axios");
const admin  = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { analyzeReceiptImageBuffer } = require("./receiptAnalyzer");

const CATEGORY_LABEL = {
  food: "食費", drink: "飲料", household: "日用品", clothing: "衣類",
  electronics: "家電", health: "医療・健康", transport: "交通費",
  entertainment: "娯楽", education: "教育", other: "その他"
};

const LINE_REPLY_ENDPOINT  = "https://api.line.me/v2/bot/message/reply";
const LINE_CONTENT_ENDPOINT = "https://api-data.line.me/v2/bot/message";

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

// このBotは単一ユーザー運用のため、Firebase Authに登録された唯一のユーザーに紐付ける
async function getOwnerUid() {
  const { users } = await admin.auth().listUsers(1);
  if (!users.length) throw new Error("Firebase Authユーザーが存在しません");
  return users[0].uid;
}

async function downloadLineImage(messageId) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = await axios.get(`${LINE_CONTENT_ENDPOINT}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: "arraybuffer"
  });
  return {
    buffer:      Buffer.from(res.data),
    contentType: (res.headers["content-type"] || "image/jpeg").split(";")[0]
  };
}

function formatReceiptSummary(a) {
  const lines = ["レシートを解析しました🧾"];
  lines.push(`店舗: ${a.store?.name || "不明"}`);
  lines.push(`日付: ${a.receiptDate}`);
  if (a.items?.length) {
    lines.push("");
    lines.push("品目:");
    for (const it of a.items) {
      const price = it.subtotal ?? it.unitPrice ?? 0;
      lines.push(`・${it.name}　¥${Number(price).toLocaleString()}`);
    }
  }
  lines.push("");
  lines.push(`合計: ¥${Number(a.payment?.total || 0).toLocaleString()}`);
  lines.push(`カテゴリ: ${CATEGORY_LABEL[a.category] || a.category}`);
  lines.push("");
  lines.push("詳細の確認・保存はアプリの「レシート追加」画面から行ってください。");
  return lines.join("\n");
}

async function handleImageMessage(event) {
  const uid = await getOwnerUid();
  const { buffer, contentType } = await downloadLineImage(event.message.id);
  const ext         = contentType.includes("png") ? "png" : "jpg";
  const storagePath = `receipts/${uid}/${Date.now()}_line.${ext}`;

  await admin.storage().bucket().file(storagePath).save(buffer, { contentType });

  let analysis = null;
  let replyMessage;
  try {
    analysis = await analyzeReceiptImageBuffer(buffer, contentType);
    replyMessage = formatReceiptSummary(analysis);
  } catch (err) {
    logger.error("LINE画像のAI解析に失敗しました", err);
    replyMessage = "レシート画像を受け取りましたが、自動解析に失敗しました。アプリの「レシート追加」画面で手動解析してください。";
  }

  await admin.firestore().collection("lineReceipts").add({
    userId:      uid,
    storagePath,
    analysis,
    consumed:    false,
    createdAt:   admin.firestore.FieldValue.serverTimestamp()
  });

  await replyText(event.replyToken, replyMessage);
}

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type === "text")  { await replyText(event.replyToken, event.message.text); return; }
  if (event.message.type === "image") { await handleImageMessage(event); return; }
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
