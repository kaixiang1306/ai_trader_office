// 5 個交易員的策略 + 共用的 applyDecision / recalcNav
// 在 Node (tick.mjs) 跑；前端 HTML 不直接 import，只用 metadata。

export const INITIAL = 100000;
export const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'ADA'];

export const TRADERS = [
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

export function makeInitialAccount() {
  return { cash: INITIAL, positions: {}, nav: INITIAL, pnl: 0, trades: 0, lastAction: '等待開市...', badge: 'idle' };
}

export function recalcNav(acct, prices) {
  const posVal = Object.entries(acct.positions).reduce((s, [coin, pos]) => {
    return s + pos.amount * (prices[coin] || pos.avgPrice);
  }, 0);
  acct.nav = acct.cash + posVal;
  acct.pnl = acct.nav - INITIAL;
}

export function applyDecision(trader, dec, acct, prices) {
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

export async function fetchPrices() {
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
