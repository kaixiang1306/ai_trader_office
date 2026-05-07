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
//   5. Worker → Settings → Triggers → Cron Triggers → Add → 填 */5 * * * *

// ─────────────────────────────────────────────────────────
// 策略邏輯
// ─────────────────────────────────────────────────────────
const INITIAL = 100000;

const TRADERS = [
  {
    id: 'momentum', name: 'MOMENTUM', short: 'MOM', initials: 'MO', ci: 0,
    strategy: 'TREND FOLLOWER',
    desc: '追漲殺跌 · 動能策略',
    coins: ['BTC', 'ETH', 'SOL'],
    decide(prices, prevPrices, acct) {
      for (const coin of this.coins) {
        const p = prices[coin], pp = prevPrices[coin];
        if (!p || !pp) continue;
        const chg = (p - pp) / pp;
        const pos = acct.positions[coin];
        if (chg > 0.015 && acct.cash > 5000) {
          const usd = Math.min(acct.cash * 0.4, 20000);
          return { action: 'BUY', coin, usd, price: p, reason: `漲幅 ${(chg * 100).toFixed(2)}%，追動能` };
        }
        if (chg < -0.02 && pos && pos.amount > 0) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `跌幅 ${(chg * 100).toFixed(2)}%，止損出場` };
        }
        if (pos && p > pos.avgPrice * 1.08) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.5, price: p, reason: `獲利 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%，部分了結` };
        }
      }
      return { action: 'HOLD', reason: '等待動能訊號' };
    }
  },
  {
    id: 'value', name: 'VALUE', short: 'VAL', initials: 'VA', ci: 1,
    strategy: 'VALUE INVESTOR',
    desc: '低買高賣 · 價值策略',
    coins: ['BTC', 'ETH', 'BNB'],
    decide(prices, prevPrices, acct) {
      for (const coin of this.coins) {
        const p = prices[coin], pp = prevPrices[coin];
        if (!p || !pp) continue;
        const chg = (p - pp) / pp;
        const pos = acct.positions[coin];
        if (chg < -0.03 && acct.cash > 8000) {
          const usd = Math.min(acct.cash * 0.35, 15000);
          return { action: 'BUY', coin, usd, price: p, reason: `回調 ${(chg * 100).toFixed(2)}%，逢低佈局` };
        }
        if (pos && p > pos.avgPrice * 1.12) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `達目標獲利 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%` };
        }
        if (pos && p < pos.avgPrice * 0.92) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `停損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待更好買點' };
    }
  },
  {
    id: 'degen', name: 'DEGEN', short: 'DEG', initials: 'DG', ci: 2,
    strategy: 'ALTCOIN HUNTER',
    desc: '高風險山寨 · 追漲策略',
    coins: ['SOL', 'DOGE', 'AVAX', 'ADA', 'XRP'],
    decide(prices, prevPrices, acct) {
      let bestCoin = null, bestChg = 0;
      for (const coin of this.coins) {
        const p = prices[coin], pp = prevPrices[coin];
        if (!p || !pp) continue;
        const chg = (p - pp) / pp;
        if (chg > bestChg) { bestChg = chg; bestCoin = coin; }
      }
      if (bestCoin && bestChg > 0.01 && acct.cash > 3000) {
        const usd = Math.min(acct.cash * 0.5, 25000);
        return { action: 'BUY', coin: bestCoin, usd, price: prices[bestCoin], reason: `最強漲幅 ${(bestChg * 100).toFixed(2)}%，全押` };
      }
      for (const coin of this.coins) {
        const pos = acct.positions[coin];
        const p = prices[coin];
        if (pos && p && p < pos.avgPrice * 0.93) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `山寨止損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%` };
        }
        if (pos && p && p > pos.avgPrice * 1.15) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.7, price: p, reason: `山寨獲利了結` };
        }
      }
      return { action: 'HOLD', reason: '搜尋下一個標的' };
    }
  },
  {
    id: 'quant', name: 'QUANT', short: 'QNT', initials: 'QT', ci: 3,
    strategy: 'SYSTEMATIC',
    desc: '系統化 · 分散配置',
    coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],
    decide(prices, prevPrices, acct) {
      const targetPct = 0.18;
      const nav = acct.cash + Object.entries(acct.positions).reduce((s, [c, p]) => s + p.amount * (prices[c] || p.avgPrice), 0);
      for (const coin of this.coins) {
        const p = prices[coin];
        if (!p) continue;
        const pos = acct.positions[coin];
        const curVal = pos ? pos.amount * p : 0;
        const curPct = curVal / nav;
        if (curPct < targetPct - 0.05 && acct.cash > 4000) {
          const usd = Math.min((targetPct - curPct) * nav, acct.cash * 0.3);
          return { action: 'BUY', coin, usd, price: p, reason: `再平衡補倉 ${coin}，目前 ${(curPct * 100).toFixed(1)}%` };
        }
        if (curPct > targetPct + 0.08 && pos) {
          const usd = (curPct - targetPct) * nav;
          return { action: 'SELL', coin, usd, price: p, reason: `再平衡減倉 ${coin}，目前 ${(curPct * 100).toFixed(1)}%` };
        }
        if (pos && p < pos.avgPrice * 0.9) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `量化停損 -10%` };
        }
      }
      return { action: 'HOLD', reason: '組合均衡，無需調整' };
    }
  },
  {
    id: 'contra', name: 'CONTRA', short: 'CTR', initials: 'CT', ci: 4,
    strategy: 'CONTRARIAN',
    desc: '逆向操作 · 抄底反彈',
    coins: ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA'],
    decide(prices, prevPrices, acct) {
      let worstCoin = null, worstChg = 0;
      for (const coin of this.coins) {
        const p = prices[coin], pp = prevPrices[coin];
        if (!p || !pp) continue;
        const chg = (p - pp) / pp;
        if (chg < worstChg) { worstChg = chg; worstCoin = coin; }
      }
      if (worstCoin && worstChg < -0.02 && acct.cash > 5000) {
        const usd = Math.min(acct.cash * 0.35, 18000);
        return { action: 'BUY', coin: worstCoin, usd, price: prices[worstCoin], reason: `逆向抄底跌幅 ${(worstChg * 100).toFixed(2)}%` };
      }
      for (const coin of this.coins) {
        const pos = acct.positions[coin];
        const p = prices[coin];
        if (pos && p && p > pos.avgPrice * 1.1) {
          return { action: 'SELL', coin, usd: pos.amount * p * 0.6, price: p, reason: `逆向獲利了結 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%` };
        }
        if (pos && p && p < pos.avgPrice * 0.88) {
          return { action: 'SELL', coin, usd: pos.amount * p, price: p, reason: `逆向停損 ${(((p / pos.avgPrice) - 1) * 100).toFixed(1)}%` };
        }
      }
      return { action: 'HOLD', reason: '等待市場過度反應' };
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
  if (!price || price <= 0) return null;
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

async function runTick(env) {
  let state = (await loadState(env)) || freshState();
  if (!state.startedAt) state.startedAt = Date.now();
  if (!state.accounts) state.accounts = {};
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

  const tickIso = new Date(state.lastTickAt).toISOString();

  if (Object.keys(state.prevPrices).length > 0) {
    for (const trader of TRADERS) {
      const acct = state.accounts[trader.id];
      try {
        const decision = trader.decide(state.prices, state.prevPrices, acct);
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
