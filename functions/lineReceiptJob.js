const crypto = require("crypto");
const admin  = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { pushText, downloadLineContent } = require("./lineClient");
const { analyzeReceiptImageBuffer }     = require("./receiptAnalyzer");

const CATEGORY_LABEL = {
  food: "食費", drink: "飲料", household: "日用品", clothing: "衣類",
  electronics: "家電", health: "医療・健康", transport: "交通費",
  entertainment: "娯楽", education: "教育", other: "その他"
};

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
  lines.push("取引として自動保存しました。内容の確認・修正はアプリの「取引一覧」から行ってください。");
  return lines.join("\n");
}

// クライアントSDKのref.put()と同様に、ダウンロードトークン付きURLを組み立てる
// （Admin SDKのsave()はトークンを自動発行しないため、明示的に付与する）
function buildDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function saveTransactionFromAnalysis(uid, analysis, imageUrl, storagePath) {
  const items = analysis.items || [];
  await admin.firestore().collection("transactions").add({
    userId:      uid,
    receiptDate: analysis.receiptDate,
    store: {
      name:    analysis.store?.name    || "",
      address: analysis.store?.address || "",
      phone:   analysis.store?.phone   || ""
    },
    items,
    income:   [],
    expenses: [],
    payment: {
      subtotal:          analysis.payment?.subtotal          || 0,
      tax:               analysis.payment?.tax               ?? null,
      total:             analysis.payment?.total              || 0,
      method:            analysis.payment?.method             || "other",
      discount:          analysis.payment?.discount           || 0,
      totalQty:          items.reduce((s, it) => s + (Number(it.quantity) || 0), 0),
      txCount:           analysis.payment?.txCount            || items.length,
      customerUnitPrice: analysis.payment?.customerUnitPrice ?? null,
      cumulativeSales:   analysis.payment?.cumulativeSales   ?? null,
    },
    category: analysis.category || "other",
    weather:  null,
    receipt:  { imageUrl, storagePath, ocrRawText: analysis.ocrRawText || null, confidence: analysis.confidence ?? null },
    notes:      "LINEから自動登録",
    isVerified: false,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:  admin.firestore.FieldValue.serverTimestamp()
  });
}

// lineWebhook がWebhook応答を返した後、Firestoreトリガー経由で非同期に実行される。
// LINEのWebhook応答時間に縛られないため、Gemini解析がどれだけ時間を要しても再送は発生しない。
async function processLineReceiptJob(job) {
  const { uid, lineUserId, messageId, isPdf } = job;

  try {
    const { buffer, contentType } = await downloadLineContent(messageId);
    const finalContentType = isPdf ? "application/pdf" : contentType;
    const ext         = isPdf ? "pdf" : (contentType.includes("png") ? "png" : "jpg");
    const storagePath = `receipts/${uid}/${Date.now()}_line.${ext}`;
    const downloadToken = crypto.randomUUID();

    const bucket = admin.storage().bucket();
    await bucket.file(storagePath).save(buffer, {
      contentType: finalContentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } }
    });
    const imageUrl = buildDownloadUrl(bucket.name, storagePath, downloadToken);

    let analysis = null;
    let resultMessage;
    try {
      analysis = await analyzeReceiptImageBuffer(buffer, finalContentType);
      resultMessage = formatReceiptSummary(analysis);
    } catch (err) {
      logger.error("LINEコンテンツのAI解析に失敗しました", err);
      resultMessage = "解析できません。もう一度送信し直してください。";
    }

    if (analysis) {
      await saveTransactionFromAnalysis(uid, analysis, imageUrl, storagePath);
    } else {
      // 解析に失敗した場合は保存せず、アップロード済みの画像も削除する
      await bucket.file(storagePath).delete().catch(() => {});
    }

    await pushText(lineUserId, resultMessage);
  } catch (err) {
    logger.error("LINEコンテンツの処理に失敗しました", err);
    await pushText(lineUserId, "解析できません。");
  }
}

module.exports = { processLineReceiptJob, saveTransactionFromAnalysis, buildDownloadUrl };
