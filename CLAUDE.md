# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Bremen is a single-user receipt/cash-ledger app for one shop, built on Firebase.
It has no build step: the frontend is a static `index.html` + `app.js` (vanilla JS,
Bootstrap 5, namespaced `firebase` JS SDK) served as-is by Firebase Hosting, and the
backend is Cloud Functions (`functions/`). There is no test suite or linter configured.

Access is restricted to a single Google account (`bremen.cote@gmail.com`), enforced at
three independent layers — keep all three in sync if the allowed email ever changes:
- `app.js` — `ALLOWED_EMAIL` check in the `onAuthStateChanged` handler (signs out anyone else)
- `firestore.rules` / `storage.rules` — `isAuth()` checks `request.auth.token.email`
- `functions/lineWebhook.js` — `getOwnerUid()` resolves the fixed owner via
  `admin.auth().getUserByEmail(OWNER_EMAIL)` (previously used `listUsers(1)`, which broke
  once more than one Auth user could exist)

## Commands

Run from the repo root unless noted:

- `firebase emulators:start` — local emulator suite (auth:9099, functions:5001, firestore:8080,
  hosting:5000, storage:9199, UI:4000). `app.js` auto-detects non-production hostnames
  (anything not in `PROD_HOSTS`) and points the SDK at these emulators instead of prod.
- `firebase deploy` — deploy everything; scope with `--only hosting`, `--only functions`,
  `--only firestore:rules`, or `--only storage`.
- `firebase deploy --only functions` — deploy backend only (also `npm run deploy` from `functions/`).

From `functions/`:
- `npm run serve` — `firebase emulators:start --only functions`
- `npm run shell` — `firebase functions:shell`
- `npm run logs` — `firebase functions:log`

Cloud Functions env vars (set via `functions/.env`, not committed): `LINE_CHANNEL_SECRET`,
`LINE_CHANNEL_ACCESS_TOKEN`, `GEMINI_API_KEY`. The weather function instead takes its API key
as a request parameter from the client, not an env var.

## Architecture

### Frontend (`index.html` + `app.js`)

One page, view-switched by `navigate()`; no router library, no bundler. `app.js` is organized
into clearly comment-delimited sections in this order: Auth, ルーター, 設定, ダッシュボード,
画像アップロード, LINEから届いたレシート画像, AI解析, 明細, 入金/出金, 天気取得, 取引保存,
取引一覧, 取引詳細モーダル, Excelエクスポート, Excel現金エクスポート, 予算, 請求書, ユーティリティ.
Grep for these Japanese section headers rather than guessing function names when navigating the file.

### Backend (`functions/`)

`index.js` wires six exported Cloud Functions (region `asia-northeast1`, set globally via
`setGlobalOptions`) to their implementations in sibling files:
- `analyzeReceipt` / `analyzeInvoice` (`receiptAnalyzer.js`) — Gemini-based image extraction
- `fetchWeather` (`weatherService.js`) — OpenWeatherMap lookup by coords or city
- `getMonthlyReport` — aggregates `transactions` by category/weather for a given month
- `lineWebhook` / `onLineReceiptJobCreated` (`lineWebhook.js`, `lineReceiptJob.js`) — LINE bot

### LINE bot flow

`lineWebhook` must ack fast (LINE retries aggressively on slow/failed responses), so it does
the minimum and defers everything else:
1. Verify the `x-line-signature` HMAC against `LINE_CHANNEL_SECRET`.
2. For an image/PDF message, `claimMessage()` does a Firestore `create()` (fails if the doc
   already exists) on `lineProcessedMessages/{messageId}` — this is the retry-dedupe guard.
   A prior bug (see git history) skipped this and produced dozens of duplicate transactions
   from repeated webhook retries of the same image.
3. Enqueue a `lineJobs/{jobId}` doc and reply immediately with "読み込みました。".
4. `onLineReceiptJobCreated` (Firestore trigger, not bound by webhook response time) downloads
   the LINE content, runs it through `analyzeReceiptImageBuffer()`, saves a `transactions` doc
   via `saveTransactionFromAnalysis()`, and pushes the formatted summary back over the LINE
   Push API (`lineClient.js`).

The Gemini prompt in `receiptAnalyzer.js` is tailored specifically to this shop's own
売上精算書 (register settlement slip) layout — store/date, per-department item lines, and the
payment block (総点数, 組数, 値引き, 合計(１), 客単価, 現金売上, 信計売上, 合計(２), 入金,
出金, 合計(３)理論在高). Changing the extracted fields means updating the prompt, the
`Transaction.payment` schema in `schema.json`, and both `saveTransactionFromAnalysis()` and
`formatReceiptSummary()` in `lineReceiptJob.js` together.

### Data model

Canonical shapes are documented in `schema.json` (JSON Schema, not enforced at runtime):
`Transaction` (`transactions/{id}`), `Budget` (`budgets/{userId}_{YYYY-MM}`), `LineReceipt`
(`lineReceipts/{id}`, an inbox of images not yet turned into a transaction), plus the
`analyzeReceipt` request/response shapes.
