# Crypto Trader Office

5 個 AI 交易員的紙上交易模擬。後端是 **GitHub Actions cron**，每 5 分鐘抓即時幣價跑一次決策；前端 **GitHub Pages** 純讀取 `state.json` 顯示。

打開網頁就看得到目前進度，不需要你手動「開始交易」。

## 架構

```
GitHub Actions (cron */5 * * * *)
        │
        ▼
   tick.mjs ── fetch CoinGecko/Binance ──► 跑 5 個策略 ──► 寫 state.json ──► commit
        │
        ▼
GitHub Pages (main branch root)
        │
        ▼
crypto_trader_office.html  ◄─── 每 30 秒 fetch state.json
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `crypto_trader_office.html` | 前端 UI，純讀取 `state.json` |
| `strategies.mjs` | 5 個交易員的策略邏輯（純函數） |
| `tick.mjs` | Actions 跑的 tick 腳本 |
| `state.json` | 持久化狀態（每 tick 由 Actions 覆寫） |
| `.github/workflows/trade.yml` | cron 排程 |

## 上線步驟

1. **建 git repo 並推到 GitHub**

   ```pwsh
   cd "C:\Users\kai81\OneDrive\文件\ai_git\ai_trader_office"
   git init
   git add .
   git commit -m "init: crypto trader office"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<repo 名>.git
   git push -u origin main
   ```

2. **開 GitHub Pages**：repo Settings → Pages → Source 選 `main` branch、`/ (root)`、Save。
   等 1 分鐘後網址會是 `https://<你的帳號>.github.io/<repo 名>/crypto_trader_office.html`

3. **開 Actions 寫入權限**：repo Settings → Actions → General → 「Workflow permissions」選 **Read and write permissions**。否則 workflow 沒法 push state.json。

4. **手動觸發第一次 tick**（不想等 5 分鐘）：repo Actions → Trading Tick → Run workflow。

之後每 5 分鐘自動跑，網頁打開隨時看得到最新狀態。

## 常見問題

**Q: state.json 一直 commit 進 main，repo 會不會變很肥？**
會，每天 ~288 commits。可以接受。如果之後想清乾淨：
- 改成把 state.json 推到一個 orphan branch（如 `state` branch）並 force push。前端改 fetch raw.githubusercontent.com。
- 或定期 `git filter-branch` / GitHub 提供的 squash 工具清理。

**Q: cron 真的會準時每 5 分鐘嗎？**
GitHub 對 schedule cron 不保證準點，有時會延遲 5–15 分鐘，高峰期可能整輪略過。對紙上交易夠用。

**Q: free tier 額度？**
- 公開 repo：Actions 完全免費
- 私有 repo：每月 2000 分鐘，每次 tick 約 15 秒，288 次 × 15s × 30 天 ≈ 2160 分鐘，**會超過**。建議公開 repo。

**Q: 60 天沒人 push 會被停掉？**
是的，GitHub 會自動停用無活動 repo 的 schedule workflow。tick 本身會 push，所以不會觸發停用。

**Q: 想改策略？**
編輯 `strategies.mjs` 裡的 `TRADERS` 陣列。每個交易員的 `decide(prices, prevPrices, acct)` 回傳 `{ action: 'BUY'|'SELL'|'HOLD', coin, usd, price, reason }`。

**Q: 想重置？**
刪掉 repo 的 `state.json`（或改回初始版本），下次 tick 會新建。

## 本地測試

```pwsh
node tick.mjs       # 跑一次 tick，會更新 state.json
# 然後用任何 static server 開 HTML，例如：
python -m http.server 8000
# 瀏覽器開 http://localhost:8000/crypto_trader_office.html
```
