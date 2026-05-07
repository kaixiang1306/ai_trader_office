// Cloudflare Worker（單檔版，可直接貼到 Dashboard 編輯器）
// 內含：策略 + tick + HTTP /state 端點
//
// 部署方式（純網頁，不用 CLI）：
//   1. Cloudflare Dashboard → Workers & Pages → KV → Create namespace
//      名稱：trader-state（隨意）
//   2. Workers & Pages → Create → Create Worker → 命名（例如 ai-trader-office）
//   3. 進入 Worker → Edit code → 把這整個檔案內容貼上 → Deploy
//   4. Worker → Settings → Variables and Secrets → Bindings → Add → KV namespace
//      Variable name 必須是：TRADER_KV
//      KV namespace 選步驟 1 建的那個
//   5. Worker → Settings → Triggers → Cron Triggers → Add → 填 * * * * *（每分鐘）

// ─────────────────────────────────────────────────────────
// 策略邏輯
// ─────────────────────────────────────────────────────────
const INITIAL = 100000;
const HISTORY_LEN = 60; // 保留 60 個 tick (1 分鐘間隔 = 1 小時)

// ── 工具函式：歷史價格分析 ─────────────────────────────
function chgN(history, coin, n) {
  const h = history && history[coin];
  if (!h || h.length < n + 1) return null;
  const cur = h[h.length - 1];
  const prev = h[h.length - 1 - n];
  if (!prev) return null;
  return (cur - prev) / prev;
}

function sma(history, coin, n) {
  const h = history && history[coin];
  if (!h || h.length < n) return null;
  const slice = h.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function highN(history, coin, n) {
  const h = history && history[coin];
  if (!h || h.length < 2) return null;
  // 不含當前 tick，看前 n 個 tick 的高點
  const slice = h.slice(-n - 1, -1);
  if (!slice.length) return null;
  return Math.max(...slice);
}

function lowN(history, coin, n) {
  const h = history && history[coin];
  if (!h || h.length < 2) return null;
  const slice = h.slice(-n - 1, -1);
  if (!slice.length) return null;
  return Math.min(...slice);
}

const TRADERS = [
  // ── 1. MOMENTUM：追動能（短中期均上漲就追） ───────────
  {
    id: 'momentum', name: 'MOMENTUM', short: 'MOM', initials: 'MO', ci: 0,
    strategy: 'TREND FOLLOWER',
    desc: '追漲殺跌 · 動能策略',
    coins: ['BTC', 'ETH', 'SOL'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const chg1 = chgN(history, coin, 1);
        const chg5 = chgN(history, coin, 5);
        const chg15 = chgN(history, coin, 15);
        const pos = acct.positions[coin];

        // 入場：1 分急漲 0.4% 或 5 分累計 0.6% 以上
        if (acct.cash > 3000 && (
          (chg1 != null && chg1 > 0.004) ||
          (chg5 != null && chg5 > 0.006) ||
          (chg15 != null && chg15 > 0.012)
        )) {
          const usd = Math.min(acct.cash * 0.3, 15000);
          const tag = chg1 > 0.004 ? `1分 ${(chg1 * 100).toFixed(2)}%` :
            chg5 > 0.006 ? `5分 ${(chg5 * 100).toFixed(2)}%` :
              `15分 ${(chg15 * 100).toFixed(2)}%`;
          return { action: 'BUY', coin, usd, price: p, reason: `動能訊號 ${tag}，追進` };
        }
        // 出場：部分獲利 +2.5%
        if (pos && p > pos.avgPrice * 1.025) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.5, price: p, reason: `獲利 ${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%，部分了結` };
        }
        // 止損：1 分急跌 0.6% 或 5 分跌 1%
        if (pos && ((chg1 != null && chg1 < -0.006) || (chg5 != null && chg5 < -0.01))) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `急跌出場` };
        }
      }
      return { action: 'HOLD', reason: '等待動能訊號' };
    }
  },

  // ── 2. VALUE：價值買低（用較長窗口看回調） ───────────
  {
    id: 'value', name: 'VALUE', short: 'VAL', initials: 'VA', ci: 1,
    strategy: 'VALUE INVESTOR',
    desc: '低買高賣 · 價值策略',
    coins: ['BTC', 'ETH', 'BNB'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const chg10 = chgN(history, coin, 10);
        const chg30 = chgN(history, coin, 30);
        const pos = acct.positions[coin];

        // 入場：10 分跌 0.8% 或 30 分跌 1.5%
        if (acct.cash > 5000 && (
          (chg10 != null && chg10 < -0.008) ||
          (chg30 != null && chg30 < -0.015)
        )) {
          const usd = Math.min(acct.cash * 0.25, 12000);
          const tag = chg10 < -0.008 ? `10分 ${(chg10 * 100).toFixed(2)}%` : `30分 ${(chg30 * 100).toFixed(2)}%`;
          return { action: 'BUY', coin, usd, price: p, reason: `逢低佈局 ${tag}` };
        }
        // 獲利：+3%
        if (pos && p > pos.avgPrice * 1.03) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `達目標 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
        // 止損：-4%
        if (pos && p < pos.avgPrice * 0.96) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `停損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待更好買點' };
    }
  },

  // ── 3. DEGEN：山寨追漲（找最強漲幅） ─────────────────
  {
    id: 'degen', name: 'DEGEN', short: 'DEG', initials: 'DG', ci: 2,
    strategy: 'ALTCOIN HUNTER',
    desc: '高風險山寨 · 追漲策略',
    coins: ['SOL', 'DOGE', 'AVAX', 'ADA', 'XRP'],
    decide(prices, prevPrices, acct, history) {
      // 看 5 分鐘最強漲幅
      let bestCoin = null, bestChg = 0;
      for (const coin of this.coins) {
        const c = chgN(history, coin, 5);
        if (c != null && c > bestChg) { bestChg = c; bestCoin = coin; }
      }
      if (bestCoin && bestChg > 0.003 && acct.cash > 2000) {
        const usd = Math.min(acct.cash * 0.4, 20000);
        return { action: 'BUY', coin: bestCoin, usd, price: prices[bestCoin], reason: `5分最強 +${(bestChg * 100).toFixed(2)}%，全押` };
      }
      // 出場：每個持倉檢查
      for (const coin of this.coins) {
        const pos = acct.positions[coin];
        const p = prices[coin];
        if (!pos || !p) continue;
        if (p < pos.avgPrice * 0.96) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `山寨止損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
        if (p > pos.avgPrice * 1.05) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.6, price: p, reason: `山寨獲利 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
      }
      return { action: 'HOLD', reason: '搜尋下一個標的' };
    }
  },

  // ── 4. QUANT：系統化再平衡（門檻調小） ───────────────
  {
    id: 'quant', name: 'QUANT', short: 'QNT', initials: 'QT', ci: 3,
    strategy: 'SYSTEMATIC',
    desc: '系統化 · 分散配置',
    coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],
    decide(prices, prevPrices, acct, history) {
      const targetPct = 0.18;
      const nav = acct.cash + Object.entries(acct.positions).reduce((s, [c, p]) => s + p.amount * (prices[c] || p.avgPrice), 0);
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const pos = acct.positions[coin];
        const curVal = pos ? pos.amount * p : 0;
        const curPct = curVal / nav;

        // 補倉：低於目標 2%
        if (curPct < targetPct - 0.02 && acct.cash > 2000) {
          const usd = Math.min((targetPct - curPct) * nav, acct.cash * 0.25);
          return { action: 'BUY', coin, usd, price: p, reason: `再平衡 ${coin} (${(curPct * 100).toFixed(1)}% → ${(targetPct * 100).toFixed(0)}%)` };
        }
        // 減倉：高於目標 3%
        if (curPct > targetPct + 0.03 && pos) {
          const usd = (curPct - targetPct) * nav;
          return { action: 'SELL', coin, usd, price: p, reason: `再平衡 ${coin} (${(curPct * 100).toFixed(1)}% → ${(targetPct * 100).toFixed(0)}%)` };
        }
        // 量化止損：-5%
        if (pos && p < pos.avgPrice * 0.95) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `量化停損 -5%` };
        }
      }
      return { action: 'HOLD', reason: '組合均衡' };
    }
  },

  // ── 5. CONTRA：逆向抄底（找最弱） ────────────────────
  {
    id: 'contra', name: 'CONTRA', short: 'CTR', initials: 'CT', ci: 4,
    strategy: 'CONTRARIAN',
    desc: '逆向操作 · 抄底反彈',
    coins: ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA'],
    decide(prices, prevPrices, acct, history) {
      // 找 10 分鐘最大跌幅
      let worstCoin = null, worstChg = 0;
      for (const coin of this.coins) {
        const c = chgN(history, coin, 10);
        if (c != null && c < worstChg) { worstChg = c; worstCoin = coin; }
      }
      if (worstCoin && worstChg < -0.005 && acct.cash > 3000) {
        const usd = Math.min(acct.cash * 0.3, 15000);
        return { action: 'BUY', coin: worstCoin, usd, price: prices[worstCoin], reason: `逆向抄底 10分 ${(worstChg * 100).toFixed(2)}%` };
      }
      for (const coin of this.coins) {
        const pos = acct.positions[coin];
        const p = prices[coin];
        if (!pos || !p) continue;
        if (p > pos.avgPrice * 1.025) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.6, price: p, reason: `逆向獲利 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
        if (p < pos.avgPrice * 0.95) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `逆向停損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待過度反應' };
    }
  },

  // ── 6. SCALPER：高頻刮頭皮（單 tick 微跌就買、微漲就賣） ─
  {
    id: 'scalper', name: 'SCALPER', short: 'SCP', initials: 'SC', ci: 5,
    strategy: 'HIGH FREQUENCY',
    desc: '高頻刮頭皮 · 微利策略',
    coins: ['BTC', 'ETH', 'SOL', 'BNB'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const chg1 = chgN(history, coin, 1);
        const chg2 = chgN(history, coin, 2);
        const pos = acct.positions[coin];

        // 入場：1 分微跌 0.15%
        if (acct.cash > 1500 && chg1 != null && chg1 < -0.0015 && !pos) {
          const usd = Math.min(acct.cash * 0.15, 8000);
          return { action: 'BUY', coin, usd, price: p, reason: `刮頭皮入場 1分 ${(chg1 * 100).toFixed(2)}%` };
        }
        // 快速獲利：+0.3%
        if (pos && p > pos.avgPrice * 1.003) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `刮利 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
        // 快速止損：-0.5% 或連續 2 tick 跌
        if (pos && (p < pos.avgPrice * 0.995 || (chg2 != null && chg2 < -0.005))) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `快速止損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待微波動' };
    }
  },

  // ── 7. SWING：均線交叉（5 分均線 vs 20 分均線） ────────
  {
    id: 'swing', name: 'SWING', short: 'SWG', initials: 'SW', ci: 6,
    strategy: 'MA CROSSOVER',
    desc: '均線穿越 · 波段策略',
    coins: ['BTC', 'ETH', 'SOL', 'BNB'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const fast = sma(history, coin, 5);
        const slow = sma(history, coin, 20);
        if (fast == null || slow == null) continue;
        const pos = acct.positions[coin];
        const ratio = fast / slow;

        // 黃金交叉：fast > slow * 1.001 (0.1% 以上)
        if (ratio > 1.001 && acct.cash > 3000 && !pos) {
          const usd = Math.min(acct.cash * 0.3, 15000);
          return { action: 'BUY', coin, usd, price: p, reason: `黃金交叉 MA5/MA20=${ratio.toFixed(4)}` };
        }
        // 死亡交叉：fast < slow * 0.999
        if (ratio < 0.999 && pos) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `死亡交叉 MA5/MA20=${ratio.toFixed(4)}` };
        }
        // 獲利保護：+4%
        if (pos && p > pos.avgPrice * 1.04) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.5, price: p, reason: `波段獲利 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待交叉訊號' };
    }
  },

  // ── 8. BREAKOUT：突破策略（突破前 N 期高低點） ───────
  {
    id: 'breakout', name: 'BREAKOUT', short: 'BRK', initials: 'BR', ci: 7,
    strategy: 'BREAKOUT',
    desc: '突破策略 · 順勢進場',
    coins: ['BTC', 'ETH', 'SOL', 'AVAX', 'XRP'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const high20 = highN(history, coin, 20);
        const low20 = lowN(history, coin, 20);
        if (high20 == null || low20 == null) continue;
        const pos = acct.positions[coin];

        // 突破前 20 分最高
        if (p > high20 * 1.001 && acct.cash > 3000 && !pos) {
          const usd = Math.min(acct.cash * 0.35, 18000);
          return { action: 'BUY', coin, usd, price: p, reason: `突破 20分高 $${high20.toFixed(2)}` };
        }
        // 跌破 20 分最低
        if (pos && p < low20 * 0.999) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `跌破 20分低 $${low20.toFixed(2)}` };
        }
        // 移動止盈：從高點回落 2%
        if (pos && high20 && p < high20 * 0.98 && p > pos.avgPrice * 1.01) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.5, price: p, reason: `移動止盈，從高點回落` };
        }
      }
      return { action: 'HOLD', reason: '等待突破' };
    }
  },

  // ── 9. MEANREV：均值回歸（離 SMA 太遠就反向） ─────────
  {
    id: 'meanrev', name: 'MEANREV', short: 'MRV', initials: 'MR', ci: 8,
    strategy: 'MEAN REVERSION',
    desc: '均值回歸 · 反向操作',
    coins: ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'],
    decide(prices, prevPrices, acct, history) {
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const ma = sma(history, coin, 20);
        if (ma == null) continue;
        const pos = acct.positions[coin];
        const dev = (p - ma) / ma;

        // 跌離均值 1% → 買
        if (dev < -0.01 && acct.cash > 3000 && !pos) {
          const usd = Math.min(acct.cash * 0.3, 14000);
          return { action: 'BUY', coin, usd, price: p, reason: `偏離均值 ${(dev * 100).toFixed(2)}%，回歸買` };
        }
        // 漲離均值 1% → 賣（持倉中）
        if (pos && dev > 0.01) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `偏離均值 +${(dev * 100).toFixed(2)}%，回歸賣` };
        }
        // 止損：-3%
        if (pos && p < pos.avgPrice * 0.97) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `回歸失敗止損` };
        }
      }
      return { action: 'HOLD', reason: '價格貼近均值' };
    }
  },

  // ── 10. DCA：定期定額（每 N tick 強制買、達標就賣） ───
  {
    id: 'dca', name: 'DCA', short: 'DCA', initials: 'DC', ci: 9,
    strategy: 'DOLLAR COST AVG',
    desc: '定期定額 · 長期累積',
    coins: ['BTC', 'ETH', 'SOL'],
    decide(prices, prevPrices, acct, history) {
      // 先檢查獲利出場：+5%
      for (const coin of this.coins) {
        const pos = acct.positions[coin];
        const p = prices[coin];
        if (!pos || !p) continue;
        if (p > pos.avgPrice * 1.05) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.5, price: p, reason: `DCA 獲利 +${(((p / pos.avgPrice) - 1) * 100).toFixed(2)}%，賣半倉` };
        }
      }
      // 每 5 個 tick 輪流買一個幣（用 tick 數決定買哪個）
      const h = history && history.BTC;
      if (!h) return { action: 'HOLD', reason: '等待價格資料' };
      const tickIdx = h.length;
      if (tickIdx % 5 !== 0) return { action: 'HOLD', reason: `下次定投 ${5 - (tickIdx % 5)} 分鐘後` };
      const coin = this.coins[Math.floor(tickIdx / 5) % this.coins.length];
      const p = prices[coin];
      if (!p || acct.cash < 1500) return { action: 'HOLD', reason: '現金不足或無價格' };
      const usd = Math.min(acct.cash * 0.1, 5000);
      return { action: 'BUY', coin, usd, price: p, reason: `定期定額買 ${coin}` };
    }
  }
];

function makeInitialAccount() {
  return { cash: INITIAL, positions: {}, nav: INITIAL, pnl: 0, trades: 0, lastAction: '等待開市...', badge: 'idle' };
}

function recalcNav(acct, prices) {
  const posVal = Object.entries(acct.positions).reduce((s, [coin, pos]) => {
    return s + pos.amount * (prices[coin] || pos.avgPrice);
  }, 0);
  acct.nav = acct.cash + posVal;
  acct.pnl = acct.nav - INITIAL;
}

function applyDecision(trader, dec, acct, prices) {
  const { action, coin, usd, price, reason } = dec;
  if (!price || price <= 0) {
    acct.lastAction = reason || '觀望';
    acct.badge = 'hold';
    recalcNav(acct, prices);
    return { traderId: trader.id, type: 'hold', msg: reason || '觀望' };
  }
  recalcNav(acct, prices);

  if (action === 'BUY' && coin && usd > 0) {
    const actualUsd = Math.min(usd, acct.cash - 500);
    if (actualUsd < 100) {
      acct.lastAction = `現金不足，無法買 ${coin}`;
      acct.badge = 'idle';
      return { traderId: trader.id, type: 'hold', msg: `現金不足 (剩 $${acct.cash.toFixed(0)})，跳過` };
    }
    const amount = actualUsd / price;
    acct.cash -= actualUsd;
    if (!acct.positions[coin]) acct.positions[coin] = { amount: 0, avgPrice: 0 };
    const pos = acct.positions[coin];
    pos.avgPrice = (pos.amount * pos.avgPrice + actualUsd) / (pos.amount + amount);
    pos.amount += amount;
    acct.trades++;
    acct.lastAction = `買入 $${actualUsd.toFixed(0)} ${coin} @ $${price.toLocaleString()}`;
    acct.badge = 'bought';
    recalcNav(acct, prices);
    return { traderId: trader.id, type: 'buy', msg: `買 $${actualUsd.toFixed(0)} ${coin} @ $${price >= 1 ? price.toFixed(2) : price.toFixed(4)} — ${reason}` };
  }

  if (action === 'SELL' && coin && usd > 0 && acct.positions[coin]) {
    const pos = acct.positions[coin];
    const sellUsd = Math.min(usd, pos.amount * price);
    const sellAmt = sellUsd / price;
    if (sellAmt <= 0 || sellUsd < 10) {
      acct.lastAction = '部位過小，跳過';
      acct.badge = 'idle';
      return null;
    }
    const pnlTrade = sellAmt * (price - pos.avgPrice);
    acct.cash += sellUsd;
    pos.amount -= sellAmt;
    if (pos.amount < 0.00001) delete acct.positions[coin];
    acct.trades++;
    acct.lastAction = `賣出 $${sellUsd.toFixed(0)} ${coin} @ $${price.toLocaleString()}`;
    acct.badge = 'sold';
    recalcNav(acct, prices);
    return { traderId: trader.id, type: 'sell', msg: `賣 $${sellUsd.toFixed(0)} ${coin} @ $${price >= 1 ? price.toFixed(2) : price.toFixed(4)} 損益 ${pnlTrade >= 0 ? '+' : ''}$${pnlTrade.toFixed(0)} — ${reason}` };
  }

  acct.lastAction = reason || '觀望';
  acct.badge = 'hold';
  recalcNav(acct, prices);
  return { traderId: trader.id, type: 'hold', msg: reason || '觀望' };
}

async function fetchPrices() {
  const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,avalanche-2,cardano';
  const idMap = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP', dogecoin: 'DOGE', 'avalanche-2': 'AVAX', cardano: 'ADA' };
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    if (r.ok) {
      const d = await r.json();
      const out = {};
      for (const [id, v] of Object.entries(d)) {
        if (idMap[id] && typeof v.usd === 'number') out[idMap[id]] = v.usd;
      }
      if (Object.keys(out).length >= 4) return { source: 'coingecko', prices: out };
    }
  } catch (e) { /* fall through */ }

  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'ADAUSDT'];
  const symMap = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB', XRPUSDT: 'XRP', DOGEUSDT: 'DOGE', AVAXUSDT: 'AVAX', ADAUSDT: 'ADA' };
  const out = {};
  const results = await Promise.allSettled(symbols.map(s =>
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`).then(r => r.json())
  ));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value && r.value.price) {
      out[symMap[symbols[i]]] = parseFloat(r.value.price);
    }
  });
  return { source: 'binance', prices: out };
}

// ─────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────
const STATE_KEY = 'state';
const MAX_LOGS = 300;

function freshState() {
  const accounts = {};
  for (const t of TRADERS) accounts[t.id] = makeInitialAccount();
  return {
    startedAt: Date.now(),
    lastTickAt: null,
    tickCount: 0,
    totalTrades: 0,
    priceSource: null,
    prices: {},
    prevPrices: {},
    priceHistory: {},
    accounts,
    logs: [],
  };
}

async function loadState(env) {
  const raw = await env.TRADER_KV.get(STATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { console.error('parse state failed:', e.message); return null; }
}

async function saveState(env, state) {
  await env.TRADER_KV.put(STATE_KEY, JSON.stringify(state));
}

function pushHistory(state, prices) {
  if (!state.priceHistory) state.priceHistory = {};
  for (const [coin, p] of Object.entries(prices)) {
    if (typeof p !== 'number' || !isFinite(p) || p <= 0) continue;
    if (!state.priceHistory[coin]) state.priceHistory[coin] = [];
    state.priceHistory[coin].push(p);
    if (state.priceHistory[coin].length > HISTORY_LEN) {
      state.priceHistory[coin] = state.priceHistory[coin].slice(-HISTORY_LEN);
    }
  }
}

async function runTick(env) {
  let state = (await loadState(env)) || freshState();
  if (!state.startedAt) state.startedAt = Date.now();
  if (!state.accounts) state.accounts = {};
  if (!state.priceHistory) state.priceHistory = {};
  for (const t of TRADERS) {
    if (!state.accounts[t.id]) state.accounts[t.id] = makeInitialAccount();
  }
  if (!Array.isArray(state.logs)) state.logs = [];

  const { source, prices } = await fetchPrices();
  if (!prices || Object.keys(prices).length === 0) {
    state.logs.unshift({
      time: new Date().toISOString(),
      traderId: null, type: 'err',
      msg: '幣價取得失敗，本輪略過',
    });
    state.logs = state.logs.slice(0, MAX_LOGS);
    await saveState(env, state);
    return;
  }

  state.prevPrices = state.prices || {};
  state.prices = prices;
  state.priceSource = source;
  state.lastTickAt = Date.now();
  state.tickCount = (state.tickCount || 0) + 1;

  // 推進歷史價格 buffer
  pushHistory(state, prices);

  const tickIso = new Date(state.lastTickAt).toISOString();

  if (Object.keys(state.prevPrices).length > 0) {
    for (const trader of TRADERS) {
      const acct = state.accounts[trader.id];
      try {
        const decision = trader.decide(state.prices, state.prevPrices, acct, state.priceHistory);
        const log = applyDecision(trader, decision, acct, state.prices);
        if (log) {
          log.time = tickIso;
          state.logs.unshift(log);
          if (log.type === 'buy' || log.type === 'sell') state.totalTrades++;
        }
      } catch (e) {
        state.logs.unshift({
          time: tickIso, traderId: trader.id, type: 'err',
          msg: '策略錯誤: ' + e.message,
        });
      }
    }
  } else {
    state.logs.unshift({
      time: tickIso, traderId: null, type: 'info',
      msg: `首次取得價格 (來源: ${source})，下個 tick 開始決策`,
    });
  }

  for (const t of TRADERS) recalcNav(state.accounts[t.id], state.prices);
  state.logs = state.logs.slice(0, MAX_LOGS);

  await saveState(env, state);
  console.log(`Tick ${state.tickCount} done. source=${source} prices=${Object.keys(prices).length} trades_total=${state.totalTrades}`);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === '/state' || url.pathname === '/state.json' || url.pathname === '/') {
      const state = (await loadState(env)) || freshState();
      return new Response(JSON.stringify(state), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...CORS,
        },
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },
};
