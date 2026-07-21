// ============================================================
// Firebase 設定
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyAPrdoknyJJOAb9Xsfhi4kYUQ5dK6j60eM",
  authDomain:        "bremen-ae259.firebaseapp.com",
  projectId:         "bremen-ae259",
  storageBucket:     "bremen-ae259.firebasestorage.app",
  messagingSenderId: "867111275901",
  appId:             "1:867111275901:web:00ecc2dc7a9f52bd115014",
  measurementId:     "G-8H8TL2XQ9P"
};

firebase.initializeApp(firebaseConfig);

const auth      = firebase.auth();
const db        = firebase.firestore();
const storage   = firebase.storage();
const functions = firebase.app().functions("asia-northeast1");

// Firebase Hosting の本番ドメイン以外（localhost・同一LAN上のIPなど）で開いた場合のみローカルエミュレーターに接続する
const PROD_HOSTS = ["bremen-ae259.web.app", "bremen-ae259.firebaseapp.com"];
const EMULATOR_HOST = window.location.hostname;
const IS_LOCAL = !PROD_HOSTS.includes(EMULATOR_HOST);
if (IS_LOCAL) {
  auth.useEmulator(`http://${EMULATOR_HOST}:9099`);
  db.useEmulator(EMULATOR_HOST, 8080);
  storage.useEmulator(EMULATOR_HOST, 9199);
  functions.useEmulator(EMULATOR_HOST, 5001);
}

// ============================================================
// 定数
// ============================================================
const CATEGORIES = {
  food:          { label: "食費",       color: "#ef5350", icon: "fa-utensils" },
  transport:     { label: "交通費",     color: "#42a5f5", icon: "fa-train" },
  entertainment: { label: "娯楽",       color: "#ab47bc", icon: "fa-gamepad" },
  health:        { label: "医療・健康", color: "#26a69a", icon: "fa-heart-pulse" },
  clothing:      { label: "衣類",       color: "#ff7043", icon: "fa-shirt" },
  household:     { label: "日用品",     color: "#8d6e63", icon: "fa-house" },
  education:     { label: "教育",       color: "#5c6bc0", icon: "fa-book" },
  other:         { label: "その他",     color: "#78909c", icon: "fa-ellipsis" }
};

const PAYMENT_LABELS = {
  cash: "現金", credit: "クレジット", debit: "デビット",
  ic: "ICカード", qr: "QR決済", other: "その他"
};

const WEATHER_EMOJI = {
  Clear: "☀️", Clouds: "☁️", Rain: "🌧️", Drizzle: "🌦️",
  Thunderstorm: "⛈️", Snow: "❄️", Mist: "🌫️", Fog: "🌫️",
  Haze: "🌫️", Dust: "🌪️", Smoke: "🌫️", Tornado: "🌪️"
};

// ============================================================
// 状態
// ============================================================
let currentUser  = null;
let appSettings  = { weatherApiKey: "", city: "Tokyo", currency: "JPY" };
let allTxs       = [];
let currentPage  = 1;
const PAGE_SIZE  = 20;
let activeTxId   = null;
let receiptFiles = [null, null];
let weatherData  = null;
let receiptItems = [];
let incomeItems  = [];
let expenseItems = [];
let chartCat     = null;
let chartWx      = null;

// ============================================================
// Auth
// ============================================================
auth.onAuthStateChanged(user => {
  document.getElementById("loading-screen").style.display = "none";

  if (user) {
    currentUser = user;
    document.getElementById("login-screen").style.display  = "none";
    document.getElementById("main-app").style.display      = "block";

    document.getElementById("user-name").textContent = user.displayName || user.email;
    document.getElementById("user-avatar").src       = user.photoURL || "";
    document.getElementById("s-name").textContent    = user.displayName || "";
    document.getElementById("s-email").textContent   = user.email;
    document.getElementById("s-avatar").src          = user.photoURL || "";

    loadSettings();
    navigate("dashboard");
  } else {
    document.getElementById("login-screen").style.display  = "flex";
    document.getElementById("main-app").style.display      = "none";
  }
});

document.getElementById("btn-google-login").addEventListener("click", async () => {
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    const el = document.getElementById("login-error");
    el.classList.remove("d-none");
    el.textContent = "ログインに失敗しました: " + e.message;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => auth.signOut());

// ============================================================
// ルーター
// ============================================================
document.addEventListener("click", e => {
  const el = e.target.closest("[data-view]");
  if (el) { e.preventDefault(); navigate(el.dataset.view); }
});

function navigate(view) {
  document.querySelectorAll(".view").forEach(s => s.classList.remove("active"));
  document.querySelectorAll("#sidebar [data-view]").forEach(l => l.classList.remove("active"));

  const section = document.getElementById("view-" + view);
  if (section) section.classList.add("active");

  const link = document.querySelector(`#sidebar [data-view="${view}"]`);
  if (link) link.classList.add("active");

  const TITLES = {
    dashboard: "ダッシュボード", "add-receipt": "レシート追加",
    transactions: "取引一覧", budget: "予算管理", settings: "設定",
    "add-invoice": "請求書追加", invoices: "請求一覧"
  };
  document.getElementById("page-title").textContent = TITLES[view] || "";

  const now = new Date();
  document.getElementById("badge-month").textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月`;

  if (view === "dashboard")    loadDashboard();
  if (view === "transactions") loadTransactions();
  if (view === "budget")       loadBudget();
  if (view === "add-invoice")  initAddInvoice();
  if (view === "invoices")     loadInvoices();
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("show");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("show");
}

document.getElementById("btn-toggle-sidebar").addEventListener("click", openSidebar);
document.getElementById("btn-close-sidebar").addEventListener("click", closeSidebar);
document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);

// ナビリンクをタップしたらサイドバーを閉じる（スマホ）
document.querySelectorAll("#sidebar [data-view]").forEach(link => {
  link.addEventListener("click", () => {
    if (window.innerWidth < 768) closeSidebar();
  });
});

// ============================================================
// 設定
// ============================================================
function loadSettings() {
  const raw = localStorage.getItem("bremen_settings");
  if (raw) appSettings = { ...appSettings, ...JSON.parse(raw) };
  document.getElementById("s-weather-key").value = appSettings.weatherApiKey || "";
  document.getElementById("s-city").value        = appSettings.city || "Tokyo";
  document.getElementById("s-currency").value    = appSettings.currency || "JPY";
}

document.getElementById("btn-save-settings").addEventListener("click", () => {
  appSettings.weatherApiKey = document.getElementById("s-weather-key").value.trim();
  appSettings.city          = document.getElementById("s-city").value.trim() || "Tokyo";
  appSettings.currency      = document.getElementById("s-currency").value;
  localStorage.setItem("bremen_settings", JSON.stringify(appSettings));
  showToast("設定を保存しました", "success");
});

// ============================================================
// ダッシュボード
// ============================================================
async function loadDashboard() {
  const now   = new Date();
  const ym    = fmtYM(now);
  const start = ym + "-01";
  const end   = ym + "-31";

  try {
    const snap = await db.collection("transactions")
      .where("userId",      "==", currentUser.uid)
      .where("receiptDate", ">=", start)
      .where("receiptDate", "<=", end)
      .orderBy("receiptDate", "desc")
      .get();

    const txs   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const total = txs.reduce((s, t) => s + (t.payment?.total || 0), 0);

    document.getElementById("d-total").textContent = fmtCurrency(total);
    document.getElementById("d-count").textContent = txs.length + "件";

    const bdoc = await db.collection("budgets")
      .doc(`${currentUser.uid}_${ym}`)
      .get();
    if (bdoc.exists) {
      const remain = (bdoc.data().limits?.total || 0) - total;
      const el     = document.getElementById("d-remain");
      el.textContent   = fmtCurrency(Math.abs(remain));
      el.className     = "h3 fw-bold mt-1 mb-0 " + (remain >= 0 ? "text-success" : "text-danger");
      document.getElementById("d-remain-sub").textContent = remain >= 0 ? "残り" : "超過";
    }

    renderCategoryChart(txs);
    renderWeatherChart(txs);
    renderRecentTx(txs.slice(0, 6));
  } catch (err) {
    console.error("Dashboard:", err);
  }

  if (appSettings.weatherApiKey) {
    fetchWeather(appSettings.city)
      .then(w => {
        if (!w) return;
        document.getElementById("d-wx-temp").textContent = w.temp.toFixed(1) + "°C";
        document.getElementById("d-wx-desc").textContent = w.description;
        document.getElementById("d-wx-icon").textContent = WEATHER_EMOJI[w.condition] || "🌡️";
        document.getElementById("d-wx-loc").textContent  = w.location;
      })
      .catch(() => {});
  }
}

function renderRecentTx(txs) {
  const el = document.getElementById("d-recent");
  if (!txs.length) {
    el.innerHTML = '<div class="text-center text-muted py-4">取引データがありません</div>';
    return;
  }
  el.innerHTML = txs.map(tx => {
    const cat = CATEGORIES[tx.category] || CATEGORIES.other;
    return `
      <div class="d-flex align-items-center py-2 border-bottom tx-row" onclick="showTxDetail('${tx.id}')">
        <span class="badge-cat me-3" style="background:${cat.color}22;color:${cat.color}">
          <i class="fa-solid ${cat.icon} me-1"></i>${cat.label}
        </span>
        <div class="flex-grow-1">
          <div class="fw-bold">${esc(tx.store?.name || "不明")}</div>
          <div class="small text-muted">${tx.receiptDate || ""}</div>
        </div>
        ${tx.weather
          ? `<span class="badge-weather me-3">${WEATHER_EMOJI[tx.weather.condition] || "🌡️"} ${tx.weather.temp?.toFixed(1) || "--"}°C</span>`
          : ""}
        <div class="fw-bold">${fmtCurrency(tx.payment?.total || 0)}</div>
      </div>`;
  }).join("");
}

function renderCategoryChart(txs) {
  const totals = Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, 0]));
  txs.forEach(tx => { totals[tx.category || "other"] += tx.payment?.total || 0; });

  const keys   = Object.keys(CATEGORIES).filter(k => totals[k] > 0);
  const ctx    = document.getElementById("chart-category").getContext("2d");
  if (chartCat) chartCat.destroy();
  chartCat = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: keys.map(k => CATEGORIES[k].label),
      datasets: [{ data: keys.map(k => totals[k]), backgroundColor: keys.map(k => CATEGORIES[k].color), borderWidth: 2 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { font: { size: 11 } } },
        tooltip: { callbacks: { label: c => " " + fmtCurrency(c.parsed) } }
      }
    }
  });
}

function renderWeatherChart(txs) {
  const totals = {};
  txs.forEach(tx => {
    if (tx.weather) {
      const k = tx.weather.condition || "Unknown";
      totals[k] = (totals[k] || 0) + (tx.payment?.total || 0);
    }
  });

  const ctx = document.getElementById("chart-weather").getContext("2d");
  if (chartWx) chartWx.destroy();
  chartWx = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(totals).map(k => (WEATHER_EMOJI[k] || "❓") + " " + k),
      datasets: [{ label: "支出合計", data: Object.values(totals), backgroundColor: "#1e88e5aa", borderColor: "#1e88e5", borderWidth: 1 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => "¥" + v.toLocaleString() } } }
    }
  });
}

// ============================================================
// 画像アップロード
// ============================================================
[0, 1].forEach(idx => {
  const slot      = document.getElementById(`upload-slot-${idx}`);
  const fileInput = document.getElementById(`file-input-${idx}`);

  slot.addEventListener("dragover",  e => { e.preventDefault(); slot.classList.add("dragover"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));
  slot.addEventListener("drop", e => {
    e.preventDefault(); slot.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], idx);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0], idx);
  });
});

function handleFile(file, idx) {
  if (!file.type.startsWith("image/")) { showToast("画像ファイルを選択してください", "danger"); return; }
  if (file.size > 10 * 1024 * 1024)   { showToast("10MB 以下の画像を選択してください", "danger"); return; }
  receiptFiles[idx] = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById(`preview-img-${idx}`);
    img.src = e.target.result;
    img.classList.remove("d-none");
    document.getElementById(`upload-ph-${idx}`).classList.add("d-none");
    document.getElementById("btn-analyze").disabled = false;
  };
  reader.readAsDataURL(file);
}

function clearSlot(idx) {
  receiptFiles[idx] = null;
  document.getElementById(`file-input-${idx}`).value = "";
  document.getElementById(`preview-img-${idx}`).classList.add("d-none");
  document.getElementById(`upload-ph-${idx}`).classList.remove("d-none");
  if (!receiptFiles.some(Boolean)) document.getElementById("btn-analyze").disabled = true;
}

// ============================================================
// AI 解析
// ============================================================
document.getElementById("btn-analyze").addEventListener("click", async () => {
  const files = receiptFiles.filter(Boolean);
  if (!files.length) return;

  const progress = document.getElementById("analyze-progress");
  const status   = document.getElementById("analyze-status");
  progress.classList.remove("d-none");
  document.getElementById("btn-analyze").disabled = true;

  try {
    status.textContent = "画像をアップロード中...";
    const imageUrls    = [];
    const storagePaths = [];
    for (const file of files) {
      const path = `receipts/${currentUser.uid}/${Date.now()}_${file.name}`;
      const ref  = storage.ref(path);
      await ref.put(file);
      imageUrls.push(await ref.getDownloadURL());
      storagePaths.push(path);
    }

    status.textContent = "AI で解析中...";
    const fn     = functions.httpsCallable("analyzeReceipt");
    const result = await fn({ imageUrls, storagePath: storagePaths[0] });

    if (result.data) {
      applyAnalysisToForm(result.data);
      showToast("解析が完了しました", "success");
    }
  } catch (e) {
    console.error("Analyze:", e);
    const msg = (e.code === "functions/internal" || e.message?.includes("INTERNAL"))
      ? "AIサービスが混雑しています。しばらく待ってから再試行してください。"
      : "解析に失敗しました: " + (e.message || "不明なエラー");
    showToast(msg, "danger");
  } finally {
    progress.classList.add("d-none");
    document.getElementById("btn-analyze").disabled = false;
  }
});

function applyAnalysisToForm(data) {
  if (data.receiptDate)      document.getElementById("f-date").value     = data.receiptDate;
  if (data.store?.name)      document.getElementById("f-store").value    = data.store.name;
  if (data.category)         document.getElementById("f-category").value = data.category;
  if (data.payment?.discount) document.getElementById("f-discount").value = data.payment.discount;
  if (data.items?.length)    { receiptItems = data.items; renderItems(); }
  recalcTotals();
  if (data.payment?.txCount)           document.getElementById("f-tx-count").value             = data.payment.txCount;
  if (data.payment?.customerUnitPrice) document.getElementById("f-customer-unit-price").value  = data.payment.customerUnitPrice;
  if (data.payment?.cumulativeSales)   document.getElementById("f-cumulative-sales").value      = data.payment.cumulativeSales;
}

// ============================================================
// 明細
// ============================================================
document.getElementById("btn-add-item").addEventListener("click", () => {
  receiptItems.push({ name: "", quantity: 1, unitPrice: 0, subtotal: 0, category: "other" });
  renderItems();
});

function renderItems() {
  const el = document.getElementById("items-container");
  if (!receiptItems.length) { el.innerHTML = ""; return; }
  el.innerHTML = receiptItems.map((item, i) => {
    const subtotal    = Math.round(item.subtotal || item.unitPrice || 0);
    const rate        = item.taxRate ?? 10;
    const taxIncluded = Math.round(subtotal * (1 + rate / 100));
    return `
    <div class="row g-2 mb-2 align-items-center">
      <div class="col-3">
        <input type="text" class="form-control form-control-sm" placeholder="品名"
          value="${esc(item.name)}" oninput="updateItem(${i},'name',this.value)">
      </div>
      <div class="col-2">
        <input type="number" class="form-control form-control-sm" placeholder="数量" min="1"
          value="${item.quantity}" oninput="updateItem(${i},'quantity',+this.value)">
      </div>
      <div class="col-2">
        <div class="input-group input-group-sm">
          <span class="input-group-text">¥</span>
          <input type="number" class="form-control" placeholder="小計" min="0"
            value="${subtotal}" oninput="updateItem(${i},'subtotal',+this.value)">
        </div>
      </div>
      <div class="col-2">
        <select class="form-select form-select-sm" onchange="updateItem(${i},'taxRate',+this.value)">
          <option value="10" ${rate === 10 ? 'selected' : ''}>10%</option>
          <option value="8"  ${rate === 8  ? 'selected' : ''}>8%</option>
          <option value="0"  ${rate === 0  ? 'selected' : ''}>非課税</option>
        </select>
      </div>
      <div class="col-2">
        <div class="input-group input-group-sm">
          <span class="input-group-text">¥</span>
          <input type="number" class="form-control bg-light" placeholder="税込" min="0" readonly
            id="item-tax-${i}" value="${taxIncluded}">
        </div>
      </div>
      <div class="col-1 text-end">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeItem(${i})">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  `;}).join("");
}

function updateItem(i, field, val) {
  receiptItems[i][field] = val;
  if (field === "quantity" || field === "unitPrice") {
    receiptItems[i].subtotal = receiptItems[i].quantity * receiptItems[i].unitPrice;
  }
  if (field === "taxRate") {
    renderItems();
  } else if (field === "subtotal" || field === "quantity" || field === "unitPrice") {
    const base = Math.round(receiptItems[i].subtotal || receiptItems[i].unitPrice || 0);
    const rate = receiptItems[i].taxRate ?? 10;
    const el = document.getElementById(`item-tax-${i}`);
    if (el) el.value = Math.round(base * (1 + rate / 100));
  }
  recalcTotals();
}

function recalcTotals() {
  const subtotal   = receiptItems.reduce((s, it) => s + Math.round(it.subtotal || it.unitPrice || 0), 0);
  const total      = receiptItems.reduce((s, it) => {
    const base = Math.round(it.subtotal || it.unitPrice || 0);
    const rate = it.taxRate ?? 10;
    return s + Math.round(base * (1 + rate / 100));
  }, 0);
  const totalQty   = receiptItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const txCount    = receiptItems.length;
  const discount   = Number(document.getElementById("f-discount")?.value) || 0;
  const finalTotal = Math.max(0, total - discount);

  document.getElementById("f-subtotal").value   = subtotal;
  document.getElementById("f-total").value       = total;
  document.getElementById("f-total-qty").value   = totalQty;
  document.getElementById("f-tx-count").value    = txCount;
  document.getElementById("f-final-total").value = finalTotal;
  updateCashBalance();
}
function removeItem(i) { receiptItems.splice(i, 1); renderItems(); }

// ============================================================
// 入金 / 出金
// ============================================================
function addCashRow(type) {
  if (type === "income")  { incomeItems.push({ name: "", amount: 0 });  renderCash("income"); }
  else                    { expenseItems.push({ name: "", amount: 0 }); renderCash("expense"); }
}

function removeCashRow(type, i) {
  if (type === "income")  { incomeItems.splice(i, 1);  renderCash("income"); }
  else                    { expenseItems.splice(i, 1); renderCash("expense"); }
}

function updateCashRow(type, i, field, val) {
  const list = type === "income" ? incomeItems : expenseItems;
  list[i][field] = val;
  if (type === "expense") updateExpenseTotal();
}

function updateExpenseTotal() {
  const total = expenseItems.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const el = document.getElementById("f-expense-total");
  if (el) el.value = total || "";
  updateCashBalance();
}

function updateCashBalance() {
  const finalTotal      = Number(document.getElementById("f-final-total")?.value)      || 0;
  const cumulativeSales = Number(document.getElementById("f-cumulative-sales")?.value)  || 0;
  const expenseTotal    = Number(document.getElementById("f-expense-total")?.value)     || 0;
  const balance         = finalTotal - (cumulativeSales + expenseTotal);
  const el              = document.getElementById("f-cash-balance");
  if (el) el.value = balance || "";
}

function renderCash(type) {
  const list = type === "income" ? incomeItems : expenseItems;
  const el   = document.getElementById(`${type}-container`);
  if (type === "expense") updateExpenseTotal();
  const color = type === "income" ? "success" : "danger";
  el.innerHTML = list.map((row, i) => `
    <div class="row g-2 mb-2 align-items-center">
      <div class="col-6">
        <input type="text" class="form-control form-control-sm" placeholder="${type === "income" ? "入金名" : "出金名"}"
          value="${esc(row.name)}" oninput="updateCashRow('${type}',${i},'name',this.value)">
      </div>
      <div class="col-5">
        <div class="input-group input-group-sm">
          <span class="input-group-text">¥</span>
          <input type="number" class="form-control" placeholder="金額" min="0"
            value="${row.amount || ""}" oninput="updateCashRow('${type}',${i},'amount',+this.value)">
        </div>
      </div>
      <div class="col-1 text-end">
        <button type="button" class="btn btn-sm btn-outline-${color}" onclick="removeCashRow('${type}',${i})">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  `).join("");
}

// ============================================================
// 天気取得
// ============================================================
document.getElementById("btn-fetch-weather").addEventListener("click", async () => {
  if (!appSettings.weatherApiKey) {
    showToast("設定で OpenWeatherMap API キーを入力してください", "warning");
    navigate("settings");
    return;
  }
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
    );
    const w = await fetchWeather(null, pos.coords.latitude, pos.coords.longitude);
    if (w) applyWeather(w);
  } catch (e) {
    showToast("位置情報の取得に失敗しました", "warning");
  }
});

function applyWeather(w) {
  weatherData = w;
  document.getElementById("f-wx-icon").textContent = WEATHER_EMOJI[w.condition] || "🌡️";
  document.getElementById("f-wx-temp").textContent = `${w.temp.toFixed(1)}°C（体感 ${w.feelsLike.toFixed(1)}°C）`;
  document.getElementById("f-wx-desc").textContent = w.description;
  document.getElementById("f-wx-hum").textContent  = w.humidity + "%";
  document.getElementById("f-wx-wind").textContent = w.windSpeed.toFixed(1) + " m/s";
  document.getElementById("weather-display").classList.remove("d-none");
}

async function fetchWeather(city, lat, lon) {
  if (!appSettings.weatherApiKey) return null;
  const base = "https://api.openweathermap.org/data/2.5/weather";
  const key  = appSettings.weatherApiKey;
  const url  = (lat != null && lon != null)
    ? `${base}?lat=${lat}&lon=${lon}&units=metric&lang=ja&appid=${key}`
    : `${base}?q=${encodeURIComponent(city || "Tokyo")}&units=metric&lang=ja&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather API: " + res.status);
  const d = await res.json();
  return {
    condition:     d.weather[0].main,
    conditionCode: d.weather[0].id,
    description:   d.weather[0].description,
    icon:          d.weather[0].icon,
    temp:          d.main.temp,
    feelsLike:     d.main.feels_like,
    humidity:      d.main.humidity,
    windSpeed:     d.wind.speed,
    cloudiness:    d.clouds.all,
    location:      d.name + ", " + d.sys.country,
    lat:           d.coord.lat,
    lon:           d.coord.lon,
    fetchedAt:     new Date().toISOString()
  };
}

// ============================================================
// 取引保存
// ============================================================
document.getElementById("receipt-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>保存中...';

  try {
    let imageUrl = null, storagePath = null;
    const firstFile = receiptFiles.find(Boolean);
    if (firstFile) {
      storagePath = `receipts/${currentUser.uid}/${Date.now()}_${firstFile.name}`;
      const ref   = storage.ref(storagePath);
      await ref.put(firstFile);
      imageUrl = await ref.getDownloadURL();
    }

    const tx = {
      userId:      currentUser.uid,
      receiptDate: document.getElementById("f-date").value,
      store: {
        name:    document.getElementById("f-store").value.trim(),
        address: "",
        phone:   ""
      },
      items:    receiptItems.map(i => ({ ...i })),
      income:   incomeItems.filter(r => r.name || r.amount),
      expenses: expenseItems.filter(r => r.name || r.amount),
      payment: {
        subtotal:          Number(document.getElementById("f-subtotal").value)             || 0,
        tax:               Math.round((Number(document.getElementById("f-subtotal").value) || 0) * 0.1),
        total:             Number(document.getElementById("f-total").value)                || 0,
        discount:          Number(document.getElementById("f-discount").value)             || 0,
        totalQty:          Number(document.getElementById("f-total-qty").value)            || 0,
        txCount:           Number(document.getElementById("f-tx-count").value)             || 0,
        customerUnitPrice: Number(document.getElementById("f-customer-unit-price").value)  || null,
        cumulativeSales:   Number(document.getElementById("f-cumulative-sales").value)     || null,
      },
      category:   document.getElementById("f-category").value,
      weather:    weatherData || null,
      receipt:    { imageUrl, storagePath, ocrRawText: null, confidence: null },
      notes:      document.getElementById("f-notes").value.trim(),
      isVerified: true,
      createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("transactions").add(tx);
    showToast("取引を保存しました", "success");
    clearForm();
    navigate("transactions");
  } catch (err) {
    console.error("Save:", err);
    showToast("保存に失敗しました: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-2"></i>保存';
  }
});

function clearForm() {
  document.getElementById("receipt-form").reset();
  receiptItems = [];
  incomeItems  = [];
  expenseItems = [];
  weatherData  = null;
  document.getElementById("f-date").value = new Date().toISOString().split("T")[0];
  document.getElementById("items-container").innerHTML = "";
  document.getElementById("income-container").innerHTML = "";
  document.getElementById("expense-container").innerHTML = "";
  document.getElementById("weather-display").classList.add("d-none");
  clearSlot(0);
  clearSlot(1);
}

document.getElementById("btn-clear-form").addEventListener("click", clearForm);
document.getElementById("f-date").value = new Date().toISOString().split("T")[0];

// ============================================================
// 取引一覧
// ============================================================
async function loadTransactions() {
  const now = new Date();
  if (!document.getElementById("filter-month").value) {
    document.getElementById("filter-month").value = fmtYM(now);
  }
  await applyFilters();
}

document.getElementById("btn-filter").addEventListener("click", applyFilters);

async function applyFilters() {
  const month   = document.getElementById("filter-month").value;
  const cat     = document.getElementById("filter-category").value;
  const keyword = document.getElementById("filter-keyword").value.toLowerCase();

  try {
    let q = db.collection("transactions")
      .where("userId", "==", currentUser.uid)
      .orderBy("receiptDate", "desc");

    if (month) {
      q = q.where("receiptDate", ">=", month + "-01")
           .where("receiptDate", "<=", month + "-31");
    }
    if (cat) q = q.where("category", "==", cat);

    const snap = await q.get();
    let txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (keyword) {
      txs = txs.filter(t =>
        (t.store?.name || "").toLowerCase().includes(keyword) ||
        (t.notes       || "").toLowerCase().includes(keyword)
      );
    }

    allTxs       = txs;
    currentPage  = 1;
    renderTxTable();
  } catch (err) {
    console.error("Filter:", err);
    showToast("データ取得に失敗しました", "danger");
  }
}

function renderTxTable() {
  const tbody = document.getElementById("tx-tbody");
  const empty = document.getElementById("tx-empty");
  document.getElementById("tx-count-label").textContent = allTxs.length + "件";

  if (!allTxs.length) {
    tbody.innerHTML = "";
    empty.classList.remove("d-none");
    document.getElementById("tx-pages").innerHTML = "";
    return;
  }
  empty.classList.add("d-none");

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = allTxs.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = page.map(tx => {
    const cat = CATEGORIES[tx.category] || CATEGORIES.other;
    return `
      <tr class="tx-row" onclick="showTxDetail('${tx.id}')">
        <td>${tx.receiptDate || "--"}</td>
        <td>${esc(tx.store?.name || "不明")}</td>
        <td><span class="badge-cat" style="background:${cat.color}22;color:${cat.color}">${cat.label}</span></td>
        <td>${tx.weather ? `<span class="badge-weather">${WEATHER_EMOJI[tx.weather.condition] || "🌡️"} ${tx.weather.temp?.toFixed(1) || "--"}°C</span>` : ""}</td>
        <td class="text-end fw-bold">${fmtCurrency(tx.payment?.total || 0)}</td>
        <td class="text-muted small">${PAYMENT_LABELS[tx.payment?.method] || "--"}</td>
        <td><button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation();showTxDetail('${tx.id}')"><i class="fa-solid fa-eye"></i></button></td>
      </tr>`;
  }).join("");

  renderPagination();
}

function renderPagination() {
  const pages = Math.ceil(allTxs.length / PAGE_SIZE);
  const ul    = document.getElementById("tx-pages");
  if (pages <= 1) { ul.innerHTML = ""; return; }

  let html = `<li class="page-item ${currentPage === 1 ? "disabled" : ""}">
    <a class="page-link" href="#" onclick="goPage(${currentPage - 1})">前へ</a></li>`;
  for (let i = 1; i <= pages; i++) {
    html += `<li class="page-item ${i === currentPage ? "active" : ""}">
      <a class="page-link" href="#" onclick="goPage(${i})">${i}</a></li>`;
  }
  html += `<li class="page-item ${currentPage === pages ? "disabled" : ""}">
    <a class="page-link" href="#" onclick="goPage(${currentPage + 1})">次へ</a></li>`;
  ul.innerHTML = html;
}

function goPage(p) { currentPage = p; renderTxTable(); }

// ============================================================
// 取引詳細モーダル
// ============================================================
function showTxDetail(txId) {
  activeTxId = txId;
  const tx = allTxs.find(t => t.id === txId);
  if (!tx) return;

  const cat          = CATEGORIES[tx.category] || CATEGORIES.other;
  const expenseTotal = (tx.expenses || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const finalTotal   = (tx.payment?.total || 0) - (tx.payment?.discount || 0);
  const cashBalance  = finalTotal - ((tx.payment?.cumulativeSales || 0) + expenseTotal);
  const body         = document.getElementById("modal-tx-body");

  body.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <h6 class="text-muted small fw-bold text-uppercase">基本情報</h6>
        <table class="table table-sm">
          <tr><td class="text-muted">日付</td><td>${tx.receiptDate || "--"}</td></tr>
          <tr><td class="text-muted">店舗</td><td>${esc(tx.store?.name || "不明")}</td></tr>
          <tr><td class="text-muted">カテゴリ</td><td>
            <span class="badge-cat" style="background:${cat.color}22;color:${cat.color}">${cat.label}</span>
          </td></tr>
          <tr><td class="text-muted">支払方法</td><td>${PAYMENT_LABELS[tx.payment?.method] || "--"}</td></tr>
          <tr><td class="text-muted">小計</td><td>${fmtCurrency(tx.payment?.subtotal || 0)}</td></tr>
          <tr><td class="text-muted">消費税</td><td>${fmtCurrency(tx.payment?.tax || 0)}</td></tr>
          <tr><td class="fw-bold">合計</td><td class="fw-bold fs-5">${fmtCurrency(tx.payment?.total || 0)}</td></tr>
          <tr><td class="text-muted">値引き</td><td>${tx.payment?.discount ? `-${fmtCurrency(tx.payment.discount)}` : "--"}</td></tr>
          <tr><td class="fw-bold">値引き後合計</td><td class="fw-bold">${fmtCurrency(finalTotal)}</td></tr>
          <tr><td class="text-muted">客数</td><td>${tx.payment?.txCount ?? "--"} 件</td></tr>
          <tr><td class="text-muted">客単価</td><td>${tx.payment?.customerUnitPrice != null ? fmtCurrency(tx.payment.customerUnitPrice) : "--"}</td></tr>
          <tr><td class="text-muted">信計売上</td><td>${tx.payment?.cumulativeSales != null ? fmtCurrency(tx.payment.cumulativeSales) : "--"}</td></tr>
          <tr><td class="text-muted text-danger">出金合計</td><td class="text-danger">${expenseTotal ? `-${fmtCurrency(expenseTotal)}` : "--"}</td></tr>
          <tr><td class="fw-bold text-primary">現金残高</td><td class="fw-bold text-primary">${fmtCurrency(cashBalance)}</td></tr>
        </table>
        ${tx.notes ? `<div class="small"><span class="text-muted">メモ: </span>${esc(tx.notes)}</div>` : ""}
        ${tx.tags?.length ? `<div class="mt-2">${tx.tags.map(t => `<span class="badge bg-secondary me-1">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="col-md-6">
        ${tx.weather ? `
          <h6 class="text-muted small fw-bold text-uppercase">天気情報</h6>
          <div class="p-3 rounded mb-3" style="background:#e3f2fd;">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="fs-3">${WEATHER_EMOJI[tx.weather.condition] || "🌡️"}</span>
              <div>
                <div class="fw-bold">${tx.weather.temp?.toFixed(1) || "--"}°C</div>
                <div class="small text-muted">${tx.weather.description || "--"}</div>
              </div>
            </div>
            <div class="small text-muted">
              💧 湿度 ${tx.weather.humidity || "--"}% &nbsp;
              💨 風速 ${tx.weather.windSpeed?.toFixed(1) || "--"} m/s
            </div>
            <div class="small text-muted mt-1">📍 ${tx.weather.location || "--"}</div>
          </div>` : ""}
        ${tx.receipt?.imageUrl ? `
          <h6 class="text-muted small fw-bold text-uppercase">レシート画像</h6>
          <img src="${tx.receipt.imageUrl}" class="img-fluid rounded mb-3" style="max-height:200px;" alt="">` : ""}
        ${tx.items?.length ? `
          <h6 class="text-muted small fw-bold text-uppercase">明細</h6>
          <table class="table table-sm">
            <thead><tr><th>品名</th><th>数量</th><th class="text-end">小計</th></tr></thead>
            <tbody>${tx.items.map(i =>
              `<tr><td>${esc(i.name)}</td><td>${i.quantity}</td><td class="text-end">${fmtCurrency(i.subtotal || i.unitPrice)}</td></tr>`
            ).join("")}</tbody>
          </table>` : ""}
      </div>
    </div>`;

  new bootstrap.Modal(document.getElementById("modal-tx")).show();
}

document.getElementById("btn-delete-tx").addEventListener("click", async () => {
  if (!activeTxId || !confirm("この取引を削除しますか？")) return;
  try {
    await db.collection("transactions").doc(activeTxId).delete();
    showToast("削除しました", "success");
    bootstrap.Modal.getInstance(document.getElementById("modal-tx")).hide();
    allTxs = allTxs.filter(t => t.id !== activeTxId);
    renderTxTable();
  } catch (e) {
    showToast("削除に失敗しました", "danger");
  }
});

// ============================================================
// Excelエクスポート
// ============================================================
async function exportToExcel() {
  if (!allTxs.length) { showToast("エクスポートするデータがありません", "warning"); return; }

  const DAYS      = ["日", "月", "火", "水", "木", "金", "土"];
  const PROD_COLS = ["調理パン", "焼きこみ", "菓子パン", "焼き菓子", "フランスパン", "デニッシュ", "ブレッド", "ジュース", "コーヒー", "未登録商品", "その他"];
  const HEADERS   = ["月日", "曜日", "気温", "天気", "コメント", "個数", "客単価", "客数", "売上", "入金", "同志社", "bremen合計", "①売上合計", "値引き", ...PROD_COLS, "②売上合計"];

  const toLocalStr = d =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const byDate = {};
  allTxs.forEach(tx => {
    const k = tx.receiptDate || "";
    if (!byDate[k]) byDate[k] = [];
    byDate[k].push(tx);
  });

  const periodStartOf = dateStr => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return d >= 21 ? new Date(y, m - 1, 21) : new Date(y, m - 2, 21);
  };

  const periodMap = new Map();
  Object.keys(byDate).forEach(ds => {
    const ps  = periodStartOf(ds);
    const key = toLocalStr(ps);
    if (!periodMap.has(key)) periodMap.set(key, ps);
  });

  const wb   = new ExcelJS.Workbook();
  const thin = { style: "thin" };

  [...periodMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, start]) => {
      const end       = new Date(start.getFullYear(), start.getMonth() + 1, 20);
      const sheetName = `${start.getMonth()+1}.${start.getDate()}-${end.getMonth()+1}.${end.getDate()}`;
      const ws        = wb.addWorksheet(sheetName);

      ws.addRow(HEADERS);

      let cur = new Date(start);
      while (cur <= end) {
        const ds  = toLocalStr(cur);
        const txs = byDate[ds] || [];

        const weather    = txs.find(t => t.weather)?.weather;
        const notes      = [...new Set(txs.map(t => t.notes).filter(Boolean))].join("、");
        const totalSales = txs.reduce((s, t) => s + (t.payment?.total    || 0), 0);
        const discount   = txs.reduce((s, t) => s + (t.payment?.discount || 0), 0);
        const txCount    = txs.reduce((s, t) => s + (t.payment?.txCount  || 0), 0);
        const totalQty   = txs.reduce((s, t) =>
          s + (t.payment?.totalQty || (t.items || []).reduce((is, item) => is + (Number(item.quantity) || 0), 0)), 0);
        const cup        = txs.find(t => t.payment?.customerUnitPrice)?.payment.customerUnitPrice ?? null;
        const cumSales   = txs.reduce((s, t) => s + (t.payment?.cumulativeSales || 0), 0);

        const allInc         = txs.flatMap(t => t.income || []);
        const doshisha       = allInc.filter(r => r.name === "同志社").reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const nonDoshishaInc = allInc.filter(r => r.name !== "同志社").reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const bremenTotal    = totalSales + nonDoshishaInc + doshisha;

        const prod = Object.fromEntries(PROD_COLS.map(p => [p, 0]));
        let hasUnnamedItems = false;
        txs.forEach(t => (t.items || []).forEach(item => {
          const amt  = Number(item.subtotal) || Number(item.unitPrice) || 0;
          const name = item.name || "";
          const col  = PROD_COLS.slice(0, -2).find(c => name === c);
          if (col)                    prod[col]         += amt;
          else if (name === "その他")  prod["その他"]     += amt;
          else if (!name)           { prod["未登録商品"] += amt; hasUnnamedItems = true; }
        }));

        ws.addRow([
          `${cur.getMonth()+1}/${cur.getDate()}`,
          DAYS[cur.getDay()],
          weather?.temp ?? "",
          weather?.condition || "",
          notes,
          totalQty       || "",
          cup            ?? "",
          txCount        || "",
          totalSales     || "",
          nonDoshishaInc || "",
          doshisha       || "",
          bremenTotal    || "",
          "",
          discount ? -discount : "",
          ...PROD_COLS.map(p =>
            p === "未登録商品" ? (hasUnnamedItems ? prod[p] : "") : (prod[p] || "")
          ),
          (PROD_COLS.reduce((s, p) => s + (prod[p] || 0), 0) - discount) || "",
        ]);
        cur.setDate(cur.getDate() + 1);
      }

      // A1:Z31 に罫線を適用
      for (let r = 1; r <= 31; r++) {
        for (let c = 1; c <= 26; c++) {
          ws.getCell(r, c).border = { top: thin, bottom: thin, left: thin, right: thin };
        }
      }
    });

  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = "bremen_export.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Excel現金エクスポート
// ============================================================
async function exportToCashExcel() {
  if (!allTxs.length) { showToast("エクスポートするデータがありません", "warning"); return; }

  const byDate = {};
  allTxs.forEach(tx => {
    const k = tx.receiptDate || "";
    if (!byDate[k]) byDate[k] = [];
    byDate[k].push(tx);
  });
  const sortedDates = Object.keys(byDate).sort();

  // 全データ行を収集
  const rows = [];
  sortedDates.forEach(ds => {
    const txs = byDate[ds];
    const d   = new Date(ds + "T00:00:00");
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
    txs.forEach(tx => {
      const finalTotal = (tx.payment?.total || 0) - (tx.payment?.discount || 0);
      const cumSales   = tx.payment?.cumulativeSales || 0;
      const expTotal   = (tx.expenses || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const cashBal    = finalTotal - cumSales - expTotal;
      rows.push({ label, desc: "売上",                incomeAmt: finalTotal, expenseAmt: 0,        delta: +finalTotal });
      rows.push({ label, desc: "クレジット　電子マネー", incomeAmt: 0,          expenseAmt: cumSales, delta: -cumSales   });
      (tx.expenses || []).forEach(exp => {
        const amt = Number(exp.amount) || 0;
        if (amt > 0) rows.push({ label, desc: exp.name || "出金", incomeAmt: 0, expenseAmt: amt, delta: -amt });
      });
      rows.push({ label, desc: "京信へ",               incomeAmt: 0,          expenseAmt: cashBal,  delta: -cashBal    });
    });
  });

  const ROWS_PER_SHEET = 35; // row3=ヘッダー, row4=先月繰越, row5-39=データ, row40=合計
  const wb  = new ExcelJS.Workbook();
  const thin = { style: "thin" };

  const buildSheet = (sheetNum, startBal, sheetRows) => {
    const name = sheetNum === 1 ? "現金出納帳" : `現金出納帳${sheetNum}`;
    const ws   = wb.addWorksheet(name);
    ws.columns = [
      { width: 14 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];
    ws.addRow(["出納帳", "", "", "営業所名", "bremen"]);
    ws.addRow([]);
    ws.addRow(["月日", "摘要", "入金", "出金", "残高"]);
    ws.addRow(["", "先月繰越", "", "", startBal]);

    let balance = startBal, totalIncome = 0, totalExpense = 0;
    sheetRows.forEach(row => {
      balance      += row.delta;
      totalIncome  += row.incomeAmt;
      totalExpense += row.expenseAmt;
      ws.addRow([row.label, row.desc, row.incomeAmt || "", row.expenseAmt || "", balance]);
    });

    while (ws.rowCount < 39) ws.addRow([]);
    ws.addRow(["", "合　計", totalIncome || "", totalExpense || "", balance || ""]);

    for (let r = 3; r <= 40; r++) {
      for (let c = 1; c <= 5; c++) {
        ws.getCell(r, c).border = { top: thin, bottom: thin, left: thin, right: thin };
      }
    }
    return balance;
  };

  if (rows.length === 0) {
    buildSheet(1, 113500, []);
  } else {
    let pageNum = 1, startBal = 113500;
    for (let i = 0; i < rows.length; i += ROWS_PER_SHEET) {
      startBal = buildSheet(pageNum, startBal, rows.slice(i, i + ROWS_PER_SHEET));
      pageNum++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = "bremen_現金.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 予算
// ============================================================
function loadBudget() {
  const now = new Date();
  const ym  = fmtYM(now);
  if (!document.getElementById("budget-month").value) {
    document.getElementById("budget-month").value = ym;
  }
  renderBudgetInputs();
  loadBudgetData(ym);
}

document.getElementById("budget-month").addEventListener("change", e => loadBudgetData(e.target.value));

function renderBudgetInputs() {
  document.getElementById("budget-inputs").innerHTML = Object.entries(CATEGORIES).map(([k, cat]) => `
    <div class="d-flex align-items-center mb-3">
      <span style="width:120px;" class="small fw-bold">
        <i class="fa-solid ${cat.icon} me-2" style="color:${cat.color}"></i>${cat.label}
      </span>
      <div class="input-group input-group-sm">
        <span class="input-group-text">¥</span>
        <input type="number" class="form-control budget-input" id="bi-${k}" min="0" placeholder="0" oninput="updateBudgetTotal()">
      </div>
    </div>`
  ).join("");
}

function updateBudgetTotal() {
  let t = 0;
  document.querySelectorAll(".budget-input").forEach(el => { t += Number(el.value) || 0; });
  document.getElementById("budget-total-display").textContent = fmtCurrency(t);
}

async function loadBudgetData(month) {
  if (!currentUser || !month) return;
  try {
    const doc = await db.collection("budgets").doc(`${currentUser.uid}_${month}`).get();
    if (doc.exists) {
      const limits = doc.data().limits || {};
      Object.keys(CATEGORIES).forEach(k => {
        const el = document.getElementById("bi-" + k);
        if (el && limits[k]) el.value = limits[k];
      });
      updateBudgetTotal();
    }

    const snap = await db.collection("transactions")
      .where("userId",      "==", currentUser.uid)
      .where("receiptDate", ">=", month + "-01")
      .where("receiptDate", "<=", month + "-31")
      .get();
    renderBudgetProgress(snap.docs.map(d => d.data()));
  } catch (err) {
    console.error("Budget:", err);
  }
}

function renderBudgetProgress(txs) {
  const spent = {};
  txs.forEach(tx => {
    const k = tx.category || "other";
    spent[k] = (spent[k] || 0) + (tx.payment?.total || 0);
  });

  document.getElementById("budget-progress").innerHTML = Object.entries(CATEGORIES).map(([k, cat]) => {
    const limit = Number(document.getElementById("bi-" + k)?.value) || 0;
    const s     = spent[k] || 0;
    const pct   = limit > 0 ? Math.min((s / limit) * 100, 100) : 0;
    const over  = s > limit && limit > 0;
    return `
      <div class="budget-progress mb-3">
        <div class="d-flex justify-content-between mb-1">
          <span class="small fw-bold">
            <i class="fa-solid ${cat.icon} me-1" style="color:${cat.color}"></i>${cat.label}
          </span>
          <span class="small ${over ? "text-over fw-bold" : "text-muted"}">
            ${fmtCurrency(s)} / ${limit > 0 ? fmtCurrency(limit) : "未設定"}
          </span>
        </div>
        <div class="progress">
          <div class="progress-bar" role="progressbar" style="width:${pct}%;background:${over ? "#c62828" : cat.color};"></div>
        </div>
      </div>`;
  }).join("");
}

document.getElementById("btn-save-budget").addEventListener("click", async () => {
  const month = document.getElementById("budget-month").value;
  if (!month) { showToast("月を選択してください", "warning"); return; }

  const limits = {};
  Object.keys(CATEGORIES).forEach(k => { limits[k] = Number(document.getElementById("bi-" + k)?.value) || 0; });
  limits.total = Object.values(limits).reduce((s, v) => s + v, 0);

  try {
    await db.collection("budgets").doc(`${currentUser.uid}_${month}`).set({
      userId: currentUser.uid, month, limits,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast("予算を保存しました", "success");
  } catch (err) {
    showToast("保存に失敗しました", "danger");
  }
});

// ============================================================
// 請求書
// ============================================================
let invoiceItems = [];
let invoiceFile  = null;

function initAddInvoice() {
  const today = new Date();
  document.getElementById("inv-date").value =
    `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  invoiceItems = [{ code: "", name: "", quantity: 1, unitPrice: 0, amount: 0 }];
  renderInvoiceItems();
  recalcInvoiceTotal();
}

// 画像アップロード
document.addEventListener("DOMContentLoaded", () => {
  const slot  = document.getElementById("inv-upload-slot");
  const input = document.getElementById("inv-file-input");
  if (!slot || !input) return;

  slot.addEventListener("dragover",  e => { e.preventDefault(); slot.classList.add("dragover"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));
  slot.addEventListener("drop", e => {
    e.preventDefault(); slot.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleInvoiceFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => {
    if (input.files[0]) handleInvoiceFile(input.files[0]);
  });
});

function handleInvoiceFile(file) {
  if (!file.type.startsWith("image/")) { showToast("画像ファイルを選択してください", "danger"); return; }
  if (file.size > 10 * 1024 * 1024)   { showToast("10MB 以下の画像を選択してください", "danger"); return; }
  invoiceFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById("inv-preview-img");
    img.src = e.target.result;
    img.classList.remove("d-none");
    document.getElementById("inv-upload-ph").classList.add("d-none");
    document.getElementById("btn-analyze-inv").disabled = false;
  };
  reader.readAsDataURL(file);
}

function clearInvoiceSlot() {
  invoiceFile = null;
  document.getElementById("inv-file-input").value = "";
  document.getElementById("inv-preview-img").classList.add("d-none");
  document.getElementById("inv-upload-ph").classList.remove("d-none");
  document.getElementById("btn-analyze-inv").disabled = true;
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-analyze-inv");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!invoiceFile) return;
    const progress = document.getElementById("inv-analyze-progress");
    const status   = document.getElementById("inv-analyze-status");
    progress.classList.remove("d-none");
    btn.disabled = true;
    try {
      status.textContent = "画像をアップロード中...";
      const path = `invoices/${currentUser.uid}/${Date.now()}_${invoiceFile.name}`;
      const ref  = storage.ref(path);
      await ref.put(invoiceFile);
      const url  = await ref.getDownloadURL();

      status.textContent = "AI で解析中...";
      const fn     = functions.httpsCallable("analyzeInvoice");
      const result = await fn({ imageUrls: [url] });

      if (result.data) applyInvoiceAnalysis(result.data);
      showToast("解析が完了しました", "success");
    } catch (e) {
      console.error("InvoiceAnalyze:", e);
      showToast("解析に失敗しました: " + (e.message || "不明なエラー"), "danger");
    } finally {
      progress.classList.add("d-none");
      btn.disabled = false;
    }
  });
});

function applyInvoiceAnalysis(data) {
  if (data.companyName) document.getElementById("inv-company").value = data.companyName;
  if (data.date)        document.getElementById("inv-date").value    = data.date;
  if (data.items?.length) {
    invoiceItems = data.items.map(it => ({
      code:      it.code      || "",
      name:      it.name      || "",
      quantity:  Number(it.quantity)  || 0,
      unitPrice: Number(it.unitPrice) || 0,
      amount:    Number(it.amount)    || 0,
    }));
    renderInvoiceItems();
  }
  recalcInvoiceTotal();
}

function addInvoiceItem() {
  invoiceItems.push({ code: "", name: "", quantity: 1, unitPrice: 0, amount: 0 });
  renderInvoiceItems();
}

function removeInvoiceItem(i) {
  invoiceItems.splice(i, 1);
  renderInvoiceItems();
  recalcInvoiceTotal();
}

function updateInvoiceItem(i, field, val) {
  invoiceItems[i][field] = (field === "quantity" || field === "unitPrice") ? (Number(val) || 0) : val;
  if (field === "quantity" || field === "unitPrice") {
    invoiceItems[i].amount = invoiceItems[i].quantity * invoiceItems[i].unitPrice;
    const el = document.getElementById(`inv-amount-${i}`);
    if (el) el.value = invoiceItems[i].amount || "";
  }
  recalcInvoiceTotal();
}

function recalcInvoiceTotal() {
  const total = invoiceItems.reduce((s, it) => s + (it.amount || 0), 0);
  const el = document.getElementById("inv-total");
  if (el) el.textContent = `¥${total.toLocaleString()}`;
}

function renderInvoiceItems() {
  const tbody = document.getElementById("inv-items-body");
  if (!tbody) return;
  tbody.innerHTML = invoiceItems.map((it, i) => `
    <tr>
      <td><input type="text" class="form-control form-control-sm" value="${it.code}"
        oninput="updateInvoiceItem(${i},'code',this.value)"></td>
      <td><input type="text" class="form-control form-control-sm" value="${it.name}"
        oninput="updateInvoiceItem(${i},'name',this.value)"></td>
      <td><input type="number" class="form-control form-control-sm" value="${it.quantity || ""}" min="0"
        oninput="updateInvoiceItem(${i},'quantity',this.value)"></td>
      <td><input type="number" class="form-control form-control-sm" value="${it.unitPrice || ""}" min="0"
        oninput="updateInvoiceItem(${i},'unitPrice',this.value)"></td>
      <td><input type="number" class="form-control form-control-sm bg-light" id="inv-amount-${i}"
        value="${it.amount || ""}" readonly></td>
      <td><button class="btn btn-sm btn-link text-danger p-0" onclick="removeInvoiceItem(${i})">
        <i class="fa-solid fa-xmark"></i></button></td>
    </tr>`).join("");
}

async function saveInvoice() {
  const company = document.getElementById("inv-company").value.trim();
  const date    = document.getElementById("inv-date").value;
  if (!company) { showToast("会社名を入力してください", "warning"); return; }
  if (!date)    { showToast("日付を入力してください", "warning"); return; }

  const items = invoiceItems.map(it => ({
    code: it.code, name: it.name,
    quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount,
  }));
  const total = items.reduce((s, it) => s + (it.amount || 0), 0);

  try {
    await db.collection("invoices").add({
      userId:      currentUser.uid,
      companyName: company,
      date,
      items,
      total,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast("請求書を保存しました", "success");
    document.getElementById("inv-company").value = "";
    invoiceItems = [{ code: "", name: "", quantity: 1, unitPrice: 0, amount: 0 }];
    renderInvoiceItems();
    recalcInvoiceTotal();
  } catch (err) {
    console.error(err);
    showToast("保存に失敗しました", "danger");
  }
}

async function loadInvoices() {
  const container = document.getElementById("inv-list-body");
  if (!container) return;
  container.innerHTML = `<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>`;

  try {
    const snap = await db.collection("invoices")
      .where("userId", "==", currentUser.uid)
      .orderBy("date", "desc")
      .get();

    if (snap.empty) {
      container.innerHTML = `<div class="text-center text-muted py-4">請求書がありません</div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead class="table-light">
            <tr><th>日付</th><th>会社名</th><th class="text-end">合計</th><th></th></tr>
          </thead>
          <tbody>
            ${snap.docs.map(doc => {
              const d = doc.data();
              return `<tr style="cursor:pointer" onclick="showInvoiceDetail('${doc.id}')">
                <td>${d.date || ""}</td>
                <td>${d.companyName || ""}</td>
                <td class="text-end fw-bold">¥${(d.total || 0).toLocaleString()}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-danger"
                    onclick="event.stopPropagation();deleteInvoice('${doc.id}')">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="text-danger small">読み込みに失敗しました</div>`;
  }
}

async function showInvoiceDetail(id) {
  try {
    const doc = await db.collection("invoices").doc(id).get();
    if (!doc.exists) return;
    const inv = doc.data();

    document.getElementById("modal-inv-body").innerHTML = `
      <div class="row mb-3">
        <div class="col"><strong>会社名：</strong>${inv.companyName || ""}</div>
        <div class="col text-end"><strong>日付：</strong>${inv.date || ""}</div>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-bordered mb-0">
          <thead class="table-light">
            <tr>
              <th>商品コード</th><th>商品名</th>
              <th class="text-end">数量</th>
              <th class="text-end">単価</th>
              <th class="text-end">金額</th>
            </tr>
          </thead>
          <tbody>
            ${(inv.items || []).map(it => `
              <tr>
                <td>${it.code || ""}</td>
                <td>${it.name || ""}</td>
                <td class="text-end">${it.quantity ?? ""}</td>
                <td class="text-end">¥${(it.unitPrice || 0).toLocaleString()}</td>
                <td class="text-end">¥${(it.amount || 0).toLocaleString()}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr class="table-light">
              <td colspan="4" class="text-end fw-bold">合計</td>
              <td class="text-end fw-bold">¥${(inv.total || 0).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    document.getElementById("btn-delete-inv").onclick = () => deleteInvoice(id);
    new bootstrap.Modal(document.getElementById("modal-inv")).show();
  } catch (err) {
    console.error(err);
    showToast("読み込みに失敗しました", "danger");
  }
}

async function deleteInvoice(id) {
  if (!confirm("この請求書を削除しますか？")) return;
  try {
    await db.collection("invoices").doc(id).delete();
    bootstrap.Modal.getInstance(document.getElementById("modal-inv"))?.hide();
    showToast("削除しました", "success");
    loadInvoices();
  } catch (err) {
    console.error(err);
    showToast("削除に失敗しました", "danger");
  }
}

// ============================================================
// ユーティリティ
// ============================================================
function fmtCurrency(amount) {
  if (appSettings.currency === "USD") return "$" + (amount / 100).toFixed(2);
  return "¥" + Math.round(amount).toLocaleString();
}

function fmtYM(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, type = "info") {
  const el   = document.getElementById("app-toast");
  const body = document.getElementById("toast-body");
  el.className  = `toast align-items-center border-0 text-bg-${type}`;
  body.textContent = msg;
  new bootstrap.Toast(el, { delay: 3000 }).show();
}

// グローバルアクセスが必要な関数
window.showTxDetail = showTxDetail;
window.goPage       = goPage;
window.updateItem   = updateItem;
window.removeItem   = removeItem;
