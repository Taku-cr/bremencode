const { onCall }                        = require("firebase-functions/v2/https");
const { setGlobalOptions }              = require("firebase-functions/v2");
const admin                             = require("firebase-admin");
const { analyzeReceiptImage, analyzeInvoiceImage } = require("./receiptAnalyzer");
const { getWeatherByCoords, getWeatherByCity } = require("./weatherService");

admin.initializeApp();
setGlobalOptions({ region: "asia-northeast1" });

// --------------------------------------------------------
// analyzeReceipt
//   入力: { imageUrl: string, storagePath?: string }
//   返却: AnalyzeReceiptResponse (schema.json 参照)
// --------------------------------------------------------
exports.analyzeReceipt = onCall(
  { timeoutSeconds: 120, memory: "512MiB", cors: true },
  async (request) => {
    if (!request.auth) {
      throw new Error("認証が必要です");
    }

    const { imageUrl, imageUrls } = request.data;
    const urls = imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : [];
    if (!urls.length) throw new Error("imageUrl または imageUrls は必須です");

    return analyzeReceiptImage(urls);
  }
);

// --------------------------------------------------------
// analyzeInvoice
//   入力: { imageUrls: string[] }
//   返却: { companyName, date, items, total }
// --------------------------------------------------------
exports.analyzeInvoice = onCall(
  { timeoutSeconds: 120, memory: "512MiB", cors: true },
  async (request) => {
    if (!request.auth) throw new Error("認証が必要です");
    const { imageUrls, imageUrl } = request.data;
    const urls = imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : [];
    if (!urls.length) throw new Error("imageUrl または imageUrls は必須です");
    return analyzeInvoiceImage(urls);
  }
);

// --------------------------------------------------------
// fetchWeather
//   入力: { lat?: number, lon?: number, city?: string, apiKey: string }
//   返却: WeatherData
// --------------------------------------------------------
exports.fetchWeather = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new Error("認証が必要です");

  const { lat, lon, city, apiKey } = request.data;
  if (!apiKey) throw new Error("apiKey は必須です");

  if (lat != null && lon != null) {
    return getWeatherByCoords(lat, lon, apiKey);
  }
  return getWeatherByCity(city || "Tokyo", apiKey);
});

// --------------------------------------------------------
// getMonthlyReport
//   入力: { month: "YYYY-MM" }
//   返却: { totalExpense, txCount, byCategory, byWeather }
// --------------------------------------------------------
exports.getMonthlyReport = onCall(async (request) => {
  if (!request.auth) throw new Error("認証が必要です");

  const { month } = request.data;
  if (!month) throw new Error("month は必須です (YYYY-MM)");

  const uid   = request.auth.uid;
  const start = month + "-01";
  const end   = month + "-31";

  const snap = await admin.firestore()
    .collection("transactions")
    .where("userId",      "==", uid)
    .where("receiptDate", ">=", start)
    .where("receiptDate", "<=", end)
    .get();

  const txs        = snap.docs.map(d => d.data());
  const byCategory = {};
  const byWeather  = {};

  txs.forEach(tx => {
    const amount = tx.payment?.total || 0;
    const cat    = tx.category || "other";
    byCategory[cat] = (byCategory[cat] || 0) + amount;

    if (tx.weather) {
      const cond         = tx.weather.condition || "Unknown";
      byWeather[cond]    = (byWeather[cond] || 0) + amount;
    }
  });

  return {
    month,
    totalExpense: txs.reduce((s, t) => s + (t.payment?.total || 0), 0),
    txCount:      txs.length,
    byCategory,
    byWeather
  };
});
