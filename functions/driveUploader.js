const axios  = require("axios");
const admin  = require("firebase-admin");
const logger = require("firebase-functions/logger");

// 取引が作られたら、レシート画像（Firebase Storage上のファイル）をGoogleドライブの指定フォルダへコピーする。
// ドライブ側は、フォルダの持ち主のアカウントで動くGoogle Apps Scriptのウェブアプリが受け取って保存する
// （個人のマイドライブはサービスアカウントからの保存が容量制限で失敗するため）。
// DRIVE_UPLOAD_URL / DRIVE_UPLOAD_SECRET が未設定のときは何もしない。

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

function buildDriveFilename(txId, tx, storagePath, mimeType) {
  const fromPath = (String(storagePath || "").match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
  const ext   = EXT_BY_MIME[mimeType] || (fromPath ? fromPath.toLowerCase() : "jpg");
  const store = String(tx.store?.name || "").replace(/[\\/:*?"<>|\s]+/g, "");
  // 例: 2026-07-02_Bremen_Hq87VZf0.jpg（ドライブ上で日付順に並び、どの取引のものか分かる）
  return `${tx.receiptDate || "日付不明"}_${store || "レシート"}_${txId}.${ext}`;
}

async function uploadReceiptToDrive(txId) {
  const url    = process.env.DRIVE_UPLOAD_URL;
  const secret = process.env.DRIVE_UPLOAD_SECRET;
  if (!url || !secret) {
    logger.info("ドライブへの保存は未設定のためスキップ", { txId });
    return { skipped: "not-configured" };
  }

  // イベントのスナップショットではなく最新の取引を読む（再実行されても二重に保存しないため）
  const ref  = admin.firestore().collection("transactions").doc(txId);
  const snap = await ref.get();
  if (!snap.exists) return { skipped: "no-transaction" };
  const tx = snap.data();

  const storagePath = tx.receipt?.storagePath;
  if (!storagePath)           return { skipped: "no-image" };
  if (tx.receipt?.driveFileId) return { skipped: "already-uploaded" };

  const file = admin.storage().bucket().file(storagePath);
  const [buffer] = await file.download();
  const [meta]   = await file.getMetadata();
  const mimeType = meta.contentType || "image/jpeg";
  const filename = buildDriveFilename(txId, tx, storagePath, mimeType);

  // Apps Scriptはtext/plainで受けるのが確実（JSONとして送るとブラウザ以外でも事前確認が絡むことがある）
  const res = await axios.post(
    url,
    JSON.stringify({ secret, filename, mimeType, data: buffer.toString("base64") }),
    {
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      maxBodyLength: Infinity, maxContentLength: Infinity,
      timeout: 90000,
    }
  );

  const body = typeof res.data === "string" ? safeParse(res.data) : res.data;
  if (!body?.ok) {
    throw new Error(`ドライブへの保存に失敗: ${JSON.stringify(body)?.slice(0, 300)}`);
  }

  await ref.update({
    "receipt.driveFileId": body.id,
    "receipt.driveUrl":    body.url,
  });
  logger.info("レシートをドライブへ保存しました", { txId, filename, driveFileId: body.id, duplicate: !!body.duplicate });
  return { uploaded: true, filename, id: body.id };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

module.exports = { uploadReceiptToDrive, buildDriveFilename };
