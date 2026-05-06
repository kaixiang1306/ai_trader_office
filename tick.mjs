// 由 GitHub Actions cron 每 5 分鐘執行一次
// 流程：讀 state.json → 抓最新幣價 → 跑每個交易員的策略 → 更新 state.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  TRADERS, INITIAL, COINS,
  makeInitialAccount, applyDecision, recalcNav, fetchPrices
} from './strategies.mjs';

const STATE_FILE = 'state.json';
const MAX_LOGS = 300;

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { console.error('parse state.json failed:', e.message); return null; }
}

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
    logs: []
  };
}

async function main() {
  let state = loadState() || freshState();
  if (!state.startedAt) state.startedAt = Date.now();
  if (!state.accounts) state.accounts = {};
  for (const t of TRADERS) {
    if (!state.accounts[t.id]) state.accounts[t.id] = makeInitialAccount();
  }
  if (!Array.isArray(state.logs)) state.logs = [];

  const { source, prices } = await fetchPrices();
  if (!prices || Object.keys(prices).length === 0) {
    console.error('No prices fetched, aborting tick');
    state.logs.unshift({
      time: new Date().toISOString(),
      traderId: null, type: 'err',
      msg: '幣價取得失敗，本輪略過'
    });
    state.logs = state.logs.slice(0, MAX_LOGS);
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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
          msg: '策略錯誤: ' + e.message
        });
      }
    }
  } else {
    state.logs.unshift({
      time: tickIso, traderId: null, type: 'info',
      msg: `首次取得價格 (來源: ${source})，下個 tick 開始決策`
    });
  }

  // 即使沒交易，也重算每個帳戶的 NAV（市價會浮動）
  for (const t of TRADERS) recalcNav(state.accounts[t.id], state.prices);

  state.logs = state.logs.slice(0, MAX_LOGS);

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Tick ${state.tickCount} done. source=${source} prices=${Object.keys(prices).length} trades_total=${state.totalTrades}`);
}

main().catch(e => { console.error(e); process.exit(1); });
