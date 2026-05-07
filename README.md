# Crypto Trader Office

5 個 AI 交易員的紙上交易模擬。後端是 **Cloudflare Worker + KV**，cron 每 5 分鐘抓即時幣價跑一次決策；前端 **GitHub Pages** 從 Worker 讀 state 顯示。

打開網頁就看得到目前進度，不需要你手動「開始交易」。

## 架構

```
Cloudflare Worker (cron */5 * * * *)
        │
        ▼
   抓 CoinGecko/Binance 幣價 ──► 跑 5 個策略 ──► 寫入 KV (state)
                                                    │
                                                    ▼
                                          GET /state（HTTP endpoint）
                                                    ▲
                                                    │ 每 30 秒 fetch
GitHub Pages ── index.html ─────────────────────────┘
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 前端 UI（GitHub Pages 首頁），fetch Worker 的 `/state` |
| `worker-bundled.js` | Worker 的原始碼（本地保存版）。改策略時編輯這個檔，再貼回 Cloudflare 編輯器 |

## 部署

### Cloudflare Worker（後端）

純網頁後台操作，不用 CLI：

1. **建 KV namespace**：Dashboard → Workers & Pages → KV → Create a namespace（名稱隨意，例如 `trader-state`）。
2. **建 Worker**：Workers & Pages → Create → Create Worker → 取名（例如 `ai-trader-office`）→ Deploy。
3. **貼程式碼**：Worker → Edit code → 把 `worker-bundled.js` 整個內容貼上 → Deploy。
4. **綁 KV**：Worker → Settings → Bindings → Add → KV namespace。Variable name 必須是 `TRADER_KV`，namespace 選步驟 1 建的。
5. **設 cron**：Worker → Settings → Triggers → Cron Triggers → Add → `*/5 * * * *`。

驗證：開瀏覽器訪問 `https://<你的 worker>.workers.dev/state`，看到 JSON 即成功。

### GitHub Pages（前端）

1. repo Settings → Pages → Source 選 `main` branch、`/ (root)`。
2. 編輯 `index.html` 找 `STATE_URL`，把它換成你的 Worker 網址：
   ```js
   const STATE_URL = 'https://<你的 worker>.workers.dev/state';
   ```
3. push 到 main，Pages 會自動上線。

## 改策略

編輯 `worker-bundled.js` 中的 `TRADERS` 陣列，每個交易員的 `decide(prices, prevPrices, acct)` 回傳 `{ action: 'BUY'|'SELL'|'HOLD', coin, usd, price, reason }`。

改完之後：複製整個檔案內容 → 貼回 Cloudflare Worker 的 Edit code → Deploy。

## 重置 state

Cloudflare Dashboard → Workers & Pages → KV → 你的 namespace → 刪掉 `state` 這個 key。下個 tick 自動建初始狀態。

## 額度（Cloudflare 免費方案）

- Worker 請求：100k/天（cron 每 5 分鐘 = 288/天 + 前端 fetch，輕鬆夠）
- KV writes：1000/天（一天 288 寫，夠）
- KV reads：100k/天

## 為什麼從 GitHub Actions 換成 Cloudflare

GitHub Actions 的 schedule cron **不保證準點**，常延遲 5–15 分鐘甚至整輪略過。Cloudflare cron triggers 準時很多，適合需要規律 tick 的紙上交易。
