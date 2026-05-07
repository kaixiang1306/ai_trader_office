# Crypto Trader Office

10 個 AI 交易員的紙上交易模擬。後端是 **Cloudflare Worker + KV**，cron 每分鐘抓即時幣價跑一次決策；前端 **GitHub Pages** 從 Worker 讀 state 顯示。

## 交易員陣容

| ID | 風格 | 策略簡述 |
|---|---|---|
| MOMENTUM | 追動能 | 1/5/15 分動能訊號入場，急跌止損 |
| VALUE | 價值 | 10/30 分回調逢低布局，+3% 獲利 |
| DEGEN | 山寨追漲 | 5 分最強漲幅全押，山寨 5 種輪流 |
| QUANT | 系統化 | 18% 目標權重再平衡，±2~3% 觸發 |
| CONTRA | 逆向抄底 | 10 分最大跌幅買進反彈 |
| SCALPER | 高頻刮頭皮 | 1 分微跌入場，+0.3% 即出 |
| SWING | 均線交叉 | MA5/MA20 黃金/死亡交叉訊號 |
| BREAKOUT | 突破 | 突破 20 分高/低點順勢進出 |
| MEANREV | 均值回歸 | 偏離 SMA20 ±1% 反向操作 |
| DCA | 定期定額 | 每 5 分鐘輪流定投三大幣 |

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
5. **設 cron**：Worker → Settings → Triggers → Cron Triggers → Add → `* * * * *`（每分鐘）。

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

- Worker 請求：100k/天（cron 每分鐘 = 1440/天 + 前端 fetch，仍輕鬆夠）
- KV writes：**1000/天 — 1 分鐘 cron 寫 1440 次會超量**！如果要全天跑，要嘛
  - 把 cron 改成 `*/2 * * * *`（每 2 分鐘 = 720 次）
  - 或升級 KV 付費（$0.50/百萬寫）
- KV reads：100k/天（前端 30s 拉一次 = 2880/天，輕鬆夠）

## 為什麼從 GitHub Actions 換成 Cloudflare

GitHub Actions 的 schedule cron **不保證準點**，常延遲 5–15 分鐘甚至整輪略過。Cloudflare cron triggers 準時很多，適合需要規律 tick 的紙上交易。
