const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

const PROMPT = `この画像は店舗の「売上精算書」（レジ締め帳票）です。以下のJSON形式で情報を抽出してください。
読み取れない・存在しない項目はnullにしてください。
JSONのみを返してください（マークダウンのコードブロック不要）。

【売上精算書のフォーマット（例）】
・店名
Bremen
・日付
2026年07月26日(日)
売上精算
・部門、個数、金額
 1 調理パン   189個   53,810
 2 焼きこみ   285個   56,470
-------------------------------
・総点数             977
・取引数             124
・組数              124
・商品合計(税抜)     ¥232,409
-------------------------------
[売上高(税込)]       232,747
-------------------------------
[値引き]           -3,600
-------------------------------
合計(１)         ¥229,147
客単価            ¥1,848
-------------------------------
現金売上      83件  153,779
信計売上      41件   75,368
（他の決済手段の内訳が続く）
-------------------------------
合計(２)         ¥229,147
-------------------------------
[理論在高]
釣銭準備                0
現金売上      83件  153,779
入金         0件        0
出金         1件     -770
-------------------------------
合計（3）         ¥153,009

【重要：OCR精度向上のための注意事項】
- 数字の誤認識に注意すること。特に「6と9」「5と8」「1と7」「0と6」は形が似ているため、画像をよく確認して正確に読み取ること。
- カタカナ・ひらがなの商品名は推測・補完せず、画像に印字された文字をそのまま読み取ること（例：「フランスパン」を「食パン」と変換しない）。
- 金額は整数（円）で返すこと。小数点不可。
- 数量は印字された実際の個数（通常1〜数個の小さな整数）を読み取ること。価格と混同しないこと。
- 「取引数」と「組数」は別の行なので混同しないこと。payment.txCount には「組数」の値を入れること。
- payment.total には[売上高(税込)]の金額（値引きされる前の金額）を入れること。「合計(１)」（値引き後の金額）ではない。
- payment.discount は[値引き]の金額を必ず正の数値で入れること（レシート上はマイナス表記でも、絶対値にすること）。
- 「合計(１)」（[売上高(税込)]から[値引き]を差し引いた後の金額）は保存しない。payment.totalとpayment.discountから計算できるため。
- 「合計(２)」（決済手段内訳の合計）は「合計(１)」と通常同額になる。payment.total2にはこちらの値を入れること。
- 「合計（３）」は理論在高（現金の理論残高）のことで、[理論在高]セクションの合計行を読み取ること。
- 「信計売上」は決済手段内訳の中の「信計売上」の金額（件数ではなく金額）を読み取ること。
- 「出金」の行には「N件」という件数が併記されている（例: 出金 1件 -770）。金額だけでなく、この件数もpayment.cashOutCountに読み取ること。

{
  "receiptDate": "YYYY-MM-DD形式の日付、不明ならnull",
  "store": {
    "name": "店名",
    "address": "住所またはnull",
    "phone": "電話番号またはnull"
  },
  "items": [
    {
      "name": "部門名（商品名）",
      "quantity": 個数（数値）,
      "unitPrice": 単価（数値、印字されていなければnull）,
      "subtotal": 金額（数値）,
      "category": "food/drink/household/clothing/electronics/health/transport/entertainment/education/other のいずれか"
    }
  ],
  "payment": {
    "totalQty": 総点数（数値）,
    "txCount": 組数（数値。取引数ではなく組数の値）,
    "discount": [値引き]の金額の絶対値（正の数値、なければ0。マイナス表記でも正の数値で返す）,
    "total": [売上高(税込)]の金額（値引き前の金額、数値）,
    "customerUnitPrice": 客単価（数値またはnull）,
    "cumulativeSales": 信計売上の金額（数値またはnull）,
    "cashSales": 現金売上の金額（数値またはnull）,
    "total2": 合計（２）の金額（数値またはnull）,
    "cashIn": 入金の金額（数値、なければ0）,
    "cashOut": 出金の金額（数値、なければ0。マイナス表記の場合は絶対値）,
    "cashOutCount": 出金の件数（数値。「出金 N件」のN。出金が無ければ0）,
    "cashBalance": 合計（３）（理論在高）の金額（数値またはnull）
  },
  "category": "food/drink/household/clothing/electronics/health/transport/entertainment/education/other のいずれか（部門構成から最も近いもの）",
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
    payment: {
      totalQty: 0, txCount: 0, discount: 0, total: 0,
      customerUnitPrice: null, cumulativeSales: null,
      cashSales: null, total2: null, cashIn: 0, cashOut: 0, cashOutCount: 0, cashBalance: null,
      ...(parsed.payment || {})
    },
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
