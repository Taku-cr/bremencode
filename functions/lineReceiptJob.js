const crypto = require("crypto");
const admin  = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { replyText, pushText, downloadLineContent } = require("./lineClient");
const { analyzeReceiptImageBuffer }     = require("./receiptAnalyzer");

function yen(n) {
  return `¥${Number(n || 0).toLocaleString()}`;
}

// 合計(１)＝各種売上（調理パン・焼きこみ・菓子パン・デニッシュ・フランスパン・ブレッド・
// 焼き菓子・ジュース・コーヒー・その他・未登録商品）を合わせた金額－値引き、として算出する。
// 部門ごとの仕分けは表示上のことで、明細（items）を単純合計すれば同じ値になる。
function itemsTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.subtotal) || Number(it.unitPrice) || 0), 0);
}

// ④整合性チェック: レシート内部で本来一致するはずの金額同士を突き合わせる。
// ・合計(１)（各種売上の合計-値引き）と合計(２)（決済手段内訳の合計）は通常同額
// ・合計(３)理論在高は、現金売上+入金-出金から計算した値と一致するはず
// 端数の丸め差は許容し、¥1超のズレだけを不整合として報告する。
function checkConsistency(analysis) {
  const p = analysis.payment || {};
  const issues = [];

  const total1 = itemsTotal(analysis.items) - (Number(p.discount) || 0);
  if (p.total2 != null && Math.abs(total1 - Number(p.total2)) > 1) {
    issues.push(`合計(１) ${yen(total1)} と合計(２) ${yen(p.total2)} が一致しません`);
  }

  if (p.cashBalance != null && p.cashSales != null) {
    const expectedBalance = (Number(p.cashSales) || 0) + (Number(p.cashIn) || 0) - (Number(p.cashOut) || 0);
    if (Math.abs(expectedBalance - Number(p.cashBalance)) > 1) {
      issues.push(`合計(３)理論在高 ${yen(p.cashBalance)} が、現金売上+入金-出金の計算値 ${yen(expectedBalance)} と一致しません`);
    }
  }

  return issues;
}

// ⑤結果通知: チェック結果に応じて確定/修正依頼のメッセージを組み立てる。
function formatReceiptSummary(a, issues) {
  const p = a.payment || {};
  const lines = ["レシートを解析しました🧾"];
  lines.push(`店舗: ${a.store?.name || "不明"}`);
  lines.push(`日付: ${a.receiptDate}`);
  if (a.items?.length) {
    lines.push("");
    lines.push("部門・個数・金額:");
    for (const it of a.items) {
      lines.push(`・${it.name}　${it.quantity ?? "-"}個　${yen(it.subtotal)}`);
    }
  }
  lines.push("");
  lines.push(`総点数: ${p.totalQty ?? "-"}`);
  lines.push(`組数: ${p.txCount ?? "-"}`);
  lines.push(`売上高(税込): ${yen(p.total)}`);
  lines.push(`値引き: ${yen(p.discount)}`);
  lines.push(`合計(１): ${yen(itemsTotal(a.items) - (Number(p.discount) || 0))}`);
  lines.push(`客単価: ${yen(p.customerUnitPrice)}`);
  lines.push(`現金売上: ${yen(p.cashSales)}`);
  lines.push(`信計売上: ${yen(p.cumulativeSales)}`);
  lines.push(`合計(２): ${yen(p.total2)}`);
  lines.push(`入金: ${yen(p.cashIn)}`);
  lines.push(`出金: ${yen(p.cashOut)}`);
  lines.push(`合計(３)理論在高: ${yen(p.cashBalance)}`);
  lines.push("");
  if (issues.length === 0) {
    lines.push("✅ 金額の整合性チェック: 問題ありませんでした。取引を確定しました。");
  } else {
    lines.push("⚠️ 金額に不整合があります:");
    issues.forEach(i => lines.push(`・${i}`));
    lines.push("");
    lines.push("「対象 金額」の形式で送っていただければLINEから修正できます（例: 焼き菓子 1200）。「終了」で終われます。");
  }
  lines.push("");
  lines.push("内容の確認・修正はアプリの「取引一覧」からも行えます。");
  // 不整合の修正が残っている間は出金ヒアリングを始めない（修正が全部終わってから出金入力に入る）
  if (issues.length === 0 && Number(p.cashOut) > 0) {
    const count = Math.max(1, Number(p.cashOutCount) || 1);
    lines.push("");
    lines.push(`出金が${count}件あります。品目と金額を教えてください（例: 電気代 3000円）。`);
    lines.push("1件ずつでも、改行区切りでまとめて送っていただいても構いません。");
  }
  return lines.join("\n");
}

// ユーザーの返信「品目名 金額」を1行分パースする（例: "電気代 3000円" → { name: "電気代", amount: 3000 }）
function parseExpenseReply(text) {
  const m = String(text || "").trim().match(/^(.*?)[\s、,]*([0-9][0-9,]*)\s*円?\s*$/);
  if (!m) return null;
  const name   = m[1].trim();
  const amount = Number(m[2].replace(/,/g, ""));
  if (!name || !Number.isFinite(amount) || amount <= 0) return null;
  return { name, amount };
}

// 複数行まとめての入力にも対応する（1行ごとに「品目名 金額」としてパースし、
// パースできた行だけを採用する。例: "牛まさ10000\n業務スーパー5000"）
function parseExpenseLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => parseExpenseReply(line))
    .filter(Boolean);
}

// クライアントSDKのref.put()と同様に、ダウンロードトークン付きURLを組み立てる
// （Admin SDKのsave()はトークンを自動発行しないため、明示的に付与する）
function buildDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

// 保存した取引のIDを返す（出金ヒアリングの結果を後から書き戻すために使う）
async function saveTransactionFromAnalysis(uid, analysis, imageUrl, storagePath, issues = []) {
  const items = analysis.items || [];
  const p     = analysis.payment || {};

  const income   = p.cashIn  ? [{ name: "入金", amount: p.cashIn }]  : [];
  const expenses = p.cashOut ? [{ name: "出金", amount: p.cashOut }] : [];

  const ref = await admin.firestore().collection("transactions").add({
    userId:      uid,
    receiptDate: analysis.receiptDate,
    store: {
      name:    analysis.store?.name    || "",
      address: analysis.store?.address || "",
      phone:   analysis.store?.phone   || ""
    },
    items,
    income,
    expenses,
    payment: {
      totalQty:          p.totalQty            || items.reduce((s, it) => s + (Number(it.quantity) || 0), 0),
      txCount:           p.txCount             || items.length,
      discount:          p.discount            || 0,
      total:             p.total               || 0,
      customerUnitPrice: p.customerUnitPrice   ?? null,
      cumulativeSales:   p.cumulativeSales     ?? null,
      cashSales:         p.cashSales           ?? null,
      total2:            p.total2              ?? null,
      cashOutCount:      p.cashOutCount        || 0,
      cashBalance:       p.cashBalance         ?? null,
    },
    category: analysis.category || "other",
    weather:  null,
    receipt:  { imageUrl, storagePath, ocrRawText: analysis.ocrRawText || null, confidence: analysis.confidence ?? null },
    notes:      "LINEから自動登録",
    consistencyIssues: issues,
    isVerified: false,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:  admin.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

// 出金の明細ヒアリングを開始する。同じ送信者の未完了の対話があれば上書きする
// （最新のレシートを優先する — 前の対話を放置されたまま延々残さないための自然な自己修復）。
async function startExpenseDialog({ lineUserId, transactionId, totalCount, expectedTotal }) {
  await admin.firestore().collection("lineExpenseDialogs").doc(lineUserId).set({
    transactionId,
    totalCount:   Math.max(1, Number(totalCount) || 1),
    expectedTotal: Number(expectedTotal) || 0,
    collected: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// LINEのテキスト返信を、進行中の出金ヒアリングへの回答として処理する。
// 対話中でなければ false を返す（呼び出し側で通常のテキスト処理にフォールバックする）。
async function handleExpenseDialogReply(lineUserId, text, replyToken) {
  const ref  = admin.firestore().collection("lineExpenseDialogs").doc(lineUserId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const dialog  = snap.data();
  const newRows = parseExpenseLines(text); // 1行でも複数行まとめてでもOK
  if (newRows.length === 0) {
    await replyText(replyToken, "「品目名 金額」の形式で送ってください（例: 電気代 3000円）。改行区切りでまとめて送ることもできます。もう一度お願いします。");
    return true;
  }

  const collected = [...(dialog.collected || []), ...newRows];

  if (collected.length < dialog.totalCount) {
    await ref.update({ collected, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    const remaining = dialog.totalCount - collected.length;
    await replyText(replyToken, `残り${remaining}件、品目と金額を教えてください（${collected.length + 1}件目から）。`);
    return true;
  }

  // 最後の1件を受け取った → 合計をレシートの出金合計と照合してから取引に保存する
  const sum = collected.reduce((s, c) => s + c.amount, 0);
  await admin.firestore().collection("transactions").doc(dialog.transactionId).update({
    expenses:  collected,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await ref.delete();

  const list = collected.map((c, i) => `${i + 1}. ${c.name} ${yen(c.amount)}`).join("\n");
  if (sum === dialog.expectedTotal) {
    await replyText(replyToken,
      `ありがとうございます。出金の内訳を${collected.length}件登録しました。\n${list}\n\n合計${yen(sum)}でレシートの出金合計と一致しました。`
    );
  } else {
    await replyText(replyToken,
      `出金の内訳を${collected.length}件登録しました。\n${list}\n\n入力の合計${yen(sum)}が、レシートの出金合計${yen(dialog.expectedTotal)}と一致しません。アプリの「取引一覧」から内容をご確認ください。`
    );
  }
  return true;
}

// 「対象 金額」の"対象"が payment のどのフィールドを指すかのエイリアス表。
// マッチしなければ明細（items）の品目名として扱う。
const CORRECTION_FIELD_ALIASES = {
  "値引き": "discount",
  "売上高": "total", "売上高(税込)": "total", "売上高（税込）": "total", "売上高税込": "total",
  "信計売上": "cumulativeSales",
  "現金売上": "cashSales",
  "合計2": "total2", "合計２": "total2", "合計(2)": "total2", "合計(２)": "total2",
  "理論在高": "cashBalance", "合計3": "cashBalance", "合計３": "cashBalance",
  "合計(3)": "cashBalance", "合計(３)": "cashBalance", "合計(３)理論在高": "cashBalance",
};
const CORRECTION_CANCEL_WORDS = ["終了", "やめる", "スキップ", "キャンセル", "以上"];

// 整合性チェックで不一致が出た取引について、LINEから直接修正できるようにする対話を開始する。
// pendingExpense を渡すと、この修正がすべて終わってから出金ヒアリングを始める
// （修正と出金入力を同時に走らせず、順番に片付ける）。
async function startCorrectionDialog({ lineUserId, transactionId, pendingExpense }) {
  await admin.firestore().collection("lineCorrectionDialogs").doc(lineUserId).set({
    transactionId,
    pendingExpense: pendingExpense || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// 修正対話の終了時（解決・キャンセルどちらも）に呼ぶ。保留していた出金ヒアリングがあれば
// ここで開始し、その案内をメッセージに追記する。
async function startPendingExpenseIfAny(lineUserId, dialog, baseMessage) {
  if (!dialog.pendingExpense) return baseMessage;
  await startExpenseDialog({ lineUserId, transactionId: dialog.transactionId, ...dialog.pendingExpense });
  const count = Math.max(1, Number(dialog.pendingExpense.totalCount) || 1);
  return `${baseMessage}\n\n出金が${count}件あります。品目と金額を教えてください（例: 電気代 3000円）。\n1件ずつでも、改行区切りでまとめて送っていただいても構いません。`;
}

// LINEのテキスト返信を、進行中の金額修正（整合性チェックの不一致修正）への回答として処理する。
// 「対象 金額」の対象は、値引き・売上高・信計売上などpaymentの主要項目か、明細の品目名。
// 品目名が既存の明細に無ければ新規の明細として追加する。
// 対話中でなければ false を返す（呼び出し側で通常のテキスト処理にフォールバックする）。
async function handleCorrectionDialogReply(lineUserId, text, replyToken) {
  const ref  = admin.firestore().collection("lineCorrectionDialogs").doc(lineUserId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const dialog  = snap.data();
  const trimmed = String(text || "").trim();

  if (CORRECTION_CANCEL_WORDS.includes(trimmed)) {
    await ref.delete();
    const msg = await startPendingExpenseIfAny(lineUserId, dialog, "修正を終了しました。残りはアプリの「取引一覧」から編集してください。");
    await replyText(replyToken, msg);
    return true;
  }

  const corrections = parseExpenseLines(text); // 「対象 金額」も同じ書式なので同じパーサーを使う
  if (corrections.length === 0) {
    await replyText(replyToken, "「対象 金額」の形式で送ってください（例: 焼き菓子 1200）。「終了」と送ると修正をやめられます。");
    return true;
  }

  const txRef  = admin.firestore().collection("transactions").doc(dialog.transactionId);
  const txSnap = await txRef.get();
  if (!txSnap.exists) {
    await ref.delete();
    await replyText(replyToken, "対象の取引が見つかりませんでした。アプリの「取引一覧」からご確認ください。");
    return true;
  }

  const tx      = txSnap.data();
  const items   = (tx.items || []).map(it => ({ ...it }));
  const payment = { ...(tx.payment || {}) };
  const applied = [];

  corrections.forEach(({ name, amount }) => {
    const field = CORRECTION_FIELD_ALIASES[name];
    if (field) {
      payment[field] = amount;
      applied.push(`${name} → ${yen(amount)}`);
      return;
    }
    const item = items.find(it => it.name === name);
    if (item) {
      item.subtotal = amount;
      applied.push(`${name}（明細） → ${yen(amount)}`);
    } else {
      items.push({ name, quantity: 1, unitPrice: amount, subtotal: amount, category: "other" });
      applied.push(`${name}（新規の明細として追加） → ${yen(amount)}`);
    }
  });

  const issues = checkConsistency({ items, payment });
  await txRef.update({
    items, payment,
    consistencyIssues: issues,
    isVerified: issues.length === 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const appliedList = applied.map(a => `・${a}`).join("\n");
  if (issues.length === 0) {
    await ref.delete();
    const msg = await startPendingExpenseIfAny(
      lineUserId, dialog,
      `修正しました:\n${appliedList}\n\n✅ 金額の整合性チェック: 問題ありませんでした。取引を確定しました。`
    );
    await replyText(replyToken, msg);
  } else {
    await ref.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await replyText(replyToken,
      `修正しました:\n${appliedList}\n\n⚠️ まだ不整合があります:\n${issues.map(i => `・${i}`).join("\n")}\n\n引き続き「対象 金額」で修正するか、「終了」で終えられます。`
    );
  }
  return true;
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
      const issues = checkConsistency(analysis);
      resultMessage = formatReceiptSummary(analysis, issues);
      analysis.__issues = issues; // 保存時に再利用（同じチェックを二度計算しない）
    } catch (err) {
      logger.error("LINEコンテンツのAI解析に失敗しました", err);
      resultMessage = "解析できません。もう一度送信し直してください。";
    }

    if (analysis) {
      const transactionId = await saveTransactionFromAnalysis(uid, analysis, imageUrl, storagePath, analysis.__issues);
      const p = analysis.payment || {};
      const hasExpense = Number(p.cashOut) > 0;
      const hasIssues  = analysis.__issues && analysis.__issues.length > 0;
      const expenseParams = { totalCount: p.cashOutCount, expectedTotal: p.cashOut };

      // 不整合の修正が残っている間は出金ヒアリングを始めない。
      // 修正が全部終わってから（startPendingExpenseIfAny経由で）出金入力に入る。
      if (hasIssues) {
        await startCorrectionDialog({
          lineUserId, transactionId,
          pendingExpense: hasExpense ? expenseParams : null
        });
      } else if (hasExpense) {
        await startExpenseDialog({ lineUserId, transactionId, ...expenseParams });
      }
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

module.exports = { processLineReceiptJob, handleExpenseDialogReply, handleCorrectionDialogReply, checkConsistency, itemsTotal, saveTransactionFromAnalysis, buildDownloadUrl };
