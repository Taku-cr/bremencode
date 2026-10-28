// Bremenの明細の品名は、下の11種類のどれかだけにする（アプリ側 app.js の BREMEN_ITEM_NAMES と同じ内容に保つこと）。
const BREMEN_ITEM_NAMES = [
  "調理パン", "焼きこみ", "菓子パン", "デニッシュ", "フランスパン",
  "ブレッド", "焼き菓子", "ジュース", "コーヒー", "未登録商品", "その他"
];

// レジの精算書に部門が並ぶ順（1〜10番目）。11番目には「未登録商品」が付く。
// 読み取った品名が候補に当てはまらないとき、その明細が何番目にあるかで本来の部門を推定するのに使う。
const REGISTER_ORDER = [
  "調理パン", "焼きこみ", "菓子パン", "デニッシュ", "フランスパン",
  "ブレッド", "焼き菓子", "ジュース", "コーヒー", "その他", "未登録商品"
];

// 半角カナ・空白・「込」と「こ」の違いは同じものとして扱う
const norm = s => String(s || "").normalize("NFKC").replace(/[\s　]+/g, "").replace(/込/g, "こ");

function matchBremenName(name) {
  const n = norm(name);
  if (!n) return null;
  return BREMEN_ITEM_NAMES.find(c => norm(c) === n) || null;
}

// 明細の品名を11種類にそろえる。
//  1. 候補に当てはまる → その品名にする（表記ゆれの吸収）
//  2. 当てはまらない → 並び順で「その位置の部門」がまだ他の明細に使われていなければ、その部門にする
//  3. それでも決められない → 空欄にする（アプリで色付きの空欄として表示され、手で選ぶ）
// 変えた明細には、読み取った元の文字を ocrName に残す。changes は変更内容の一覧（LINEの返信で知らせる用）。
function normalizeBremenItems(items) {
  const list = (items || []).map(it => ({ ...it }));
  const canon = list.map(it => matchBremenName(it.name));
  const used = new Set(canon.filter(Boolean));
  const changes = [];

  list.forEach((it, i) => {
    const original = String(it.name || "");
    let next = canon[i], how = null;
    if (!next) {
      const guess = REGISTER_ORDER[i];
      if (guess && !used.has(guess)) { next = guess; used.add(guess); how = "order"; }
      else { next = ""; how = "blank"; }
    }
    if (next !== original) {
      if (original) it.ocrName = original;
      it.name = next;
      if (how) changes.push({ no: i + 1, from: original || "(品名なし)", to: next || null, amount: Number(it.subtotal) || 0, how });
    }
  });
  return { items: list, changes };
}

module.exports = { BREMEN_ITEM_NAMES, REGISTER_ORDER, matchBremenName, normalizeBremenItems };
