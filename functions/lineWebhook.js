const crypto = require("crypto");
const admin  = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { replyText } = require("./lineClient");

function isValidSignature(rawBody, signature, channelSecret) {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

const OWNER_EMAIL = "bremen.cote@gmail.com";

// このBotは bremen.cote@gmail.com のアカウントに固定で紐付ける
async function getOwnerUid() {
  const user = await admin.auth().getUserByEmail(OWNER_EMAIL);
  return user.uid;
}

// LINEはWebhookの応答が遅い・失敗すると同じイベントを最大24時間ほど再送してくる。
// メッセージIDでの早取り（Firestoreのcreateはドキュメントが既存だと失敗する）により、
// 再送分は処理をスキップして重複解析・重複課金を防ぐ。
async function claimMessage(messageId) {
  try {
    await admin.firestore().collection("lineProcessedMessages").doc(messageId).create({
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (err) {
    return false;
  }
}

async function enqueueReceiptJob({ uid, lineUserId, messageId, isPdf }) {
  await admin.firestore().collection("lineJobs").add({
    uid, lineUserId, messageId, isPdf,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function handleImageMessage(event) {
  const messageId = event.message.id;
  if (!(await claimMessage(messageId))) {
    logger.info("LINE画像: 再送のためスキップ", { messageId });
    return;
  }

  const uid = await getOwnerUid();
  await replyText(event.replyToken, "読み込みました。解析を開始します。");
  await enqueueReceiptJob({ uid, lineUserId: event.source.userId, messageId, isPdf: false });
}

async function handleFileMessage(event) {
  const fileName = event.message.fileName || "";
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    await replyText(event.replyToken, "解析できません。対応しているのは画像またはPDFです。");
    return;
  }

  const messageId = event.message.id;
  if (!(await claimMessage(messageId))) {
    logger.info("LINE PDF: 再送のためスキップ", { messageId });
    return;
  }

  const uid = await getOwnerUid();
  await replyText(event.replyToken, "読み込みました。解析を開始します。");
  await enqueueReceiptJob({ uid, lineUserId: event.source.userId, messageId, isPdf: true });
}

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type === "text")  { await replyText(event.replyToken, event.message.text); return; }
  if (event.message.type === "image") { await handleImageMessage(event); return; }
  if (event.message.type === "file")  { await handleFileMessage(event); return; }
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
