const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

const PROMPT = `このレシート画像を解析して、以下のJSON形式で情報を抽出してください。
読み取れない・存在しない項目はnullにしてください。
JSONのみを返してください（マークダウンのコードブロック不要）。

【重要：OCR精度向上のための注意事項】
- 数字の誤認識に注意すること。特に「6と9」「5と8」「1と7」「0と6」は形が似ているため、画像をよく確認して正確に読み取ること。
- カタカナ・ひらがなの商品名は推測・補完せず、画像に印字された文字をそのまま読み取ること（例：「フランスパン」を「食パン」と変換しない）。
- 金額は整数（円）で返すこと。小数点不可。
- 数量は印字された実際の個数（通常1〜数個の小さな整数）を読み取ること。価格と混同しないこと。

{
  "receiptDate": "YYYY-MM-DD形式の日付、不明ならnull",
  "store": {
    "name": "店名",
    "address": "住所またはnull",
    "phone": "電話番号またはnull"
  },
  "items": [
    {
      "name": "商品名",
      "quantity": 数量（数値）,
      "unitPrice": 単価（数値）,
      "subtotal": 小計（数値）,
      "category": "food/drink/household/clothing/electronics/health/transport/entertainment/education/other のいずれか"
    }
  ],
  "payment": {
    "subtotal": 小計金額（数値）,
    "tax": 消費税額（数値またはnull）,
    "total": 合計金額（数値）,
    "method": "cash/credit/ic/qr/debit/other のいずれか",
    "discount": 値引き・割引・クーポン等の合計金額（数値、なければ0）,
    "txCount": 商品の種類数または取引明細行数（数値）,
    "customerUnitPrice": 客単価（数値またはnull）,
    "cumulativeSales": 信計売上・累計売上・日計売上（数値またはnull）
  },
  "category": "food/drink/household/clothing/electronics/health/transport/entertainment/education/other のいずれか",
  "ocrRawText": "レシートに書かれているテキスト全文",
  "confidence": 0から1の解析信頼度（数値）
}`;

async function fetchImagePart(url) {
  const res      = await axios.get(url, { responseType: "arraybuffer" });
  const base64   = Buffer.from(res.data).toString("base64");
  const mimeType = (res.headers["content-type"] || "image/jpeg").split(";")[0];
  return { inlineData: { data: base64, mimeType } };
}

async function runReceiptAnalysis(imageParts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent([PROMPT, ...imageParts]);

  const text      = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini の応答から JSON を取得できませんでした");

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    receiptDate: parsed.receiptDate  || todayStr(),
    store:       parsed.store        || { name: "", address: null, phone: null },
    items:       parsed.items        || [],
    payment:     { subtotal: 0, tax: null, total: 0, method: "cash", discount: 0, txCount: 0, ...(parsed.payment || {}) },
    category:    parsed.category     || "other",
    ocrRawText:  parsed.ocrRawText   || "",
    confidence:  parsed.confidence   ?? 0.9,
  };
}

async function analyzeReceiptImage(imageUrls) {
  const imageParts = await Promise.all(imageUrls.map(fetchImagePart));
  return runReceiptAnalysis(imageParts);
}

async function analyzeReceiptImageBuffer(buffer, mimeType) {
  return runReceiptAnalysis([{ inlineData: { data: buffer.toString("base64"), mimeType } }]);
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

const INVOICE_PROMPT = `この請求書画像を解析して、以下のJSON形式で情報を抽出してください。
読み取れない・存在しない項目はnullにしてください。
JSONのみを返してください（マークダウンのコードブロック不要）。

【注意】
- companyName は請求書を「発行した側」（発行元・差出人・請求元）の会社名を返すこと。請求先（宛先・御中）の名前は入れないこと。
- date は「請求日」「発行日」「納品日」の優先順で読み取り、YYYY-MM-DD形式で返すこと。
- 年が2桁表記（例：26.5.15 や 26年5月）の場合は必ず西暦2000年代として解釈すること（26→2026年）。平成・昭和の元号に変換しないこと（平成26年=2014年と絶対に混同しないこと）。
- 金額・数量・単価は整数または小数の数値で返すこと。
- 商品コードが存在しない場合はnullにすること。
- 合計金額は請求合計（税込の場合は税込金額）を返すこと。

{
  "companyName": "請求先（宛先）の会社名またはnull",
  "date": "YYYY-MM-DD形式の請求日または発行日、不明ならnull",
  "items": [
    {
      "code": "商品コードまたはnull",
      "name": "商品名",
      "quantity": 数量（数値）,
      "unitPrice": 単価（数値）,
      "amount": 金額（数値）
    }
  ],
  "total": 合計金額（数値）
}`;

async function analyzeInvoiceImage(imageUrls) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");

  const imageParts = await Promise.all(imageUrls.map(async (url) => {
    const res      = await axios.get(url, { responseType: "arraybuffer" });
    const base64   = Buffer.from(res.data).toString("base64");
    const mimeType = (res.headers["content-type"] || "image/jpeg").split(";")[0];
    return { inlineData: { data: base64, mimeType } };
  }));

  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent([INVOICE_PROMPT, ...imageParts]);

  const text      = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini の応答から JSON を取得できませんでした");

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    companyName: parsed.companyName || "",
    date:        parsed.date        || todayStr(),
    items:       (parsed.items || []).map(it => ({
      code:      it.code      || "",
      name:      it.name      || "",
      quantity:  Number(it.quantity)  || 0,
      unitPrice: Number(it.unitPrice) || 0,
      amount:    Number(it.amount)    || 0,
    })),
    total: Number(parsed.total) || 0,
  };
}

module.exports = { analyzeReceiptImage, analyzeReceiptImageBuffer, analyzeInvoiceImage };
