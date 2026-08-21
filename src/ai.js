// ai.js — AI 机器人决策（空座位补位用）
// 策略力求“不太蠢但简单”：胡必胡、合理碰杠、出牌优先打孤张；川麻先打定缺花色。

const { suitOf, numberOf, isHonor } = require('./tiles');

function handCounts(hand) {
  const c = new Array(34).fill(0);
  for (const t of hand) c[t]++;
  return c;
}

// 计算某张牌的“保留价值”，越低越该打
function tileValue(hand, t) {
  const c = handCounts(hand);
  let v = 0;
  if (c[t] >= 3) v += 10;
  else if (c[t] === 2) v += 6;
  // 邻接（组成顺子潜力）
  if (c[t - 1] > 0) v += 3;
  if (c[t + 1] > 0) v += 3;
  if (c[t - 2] > 0) v += 1;
  if (c[t + 2] > 0) v += 1;
  if (isHonor(t) && c[t] === 1) v -= 3;       // 孤张字牌最该打
  if (!isHonor(t)) {
    const n = numberOf(t);
    if (n === 1 || n === 9) v -= 1;            // 幺九略降
  }
  return v;
}

function aiDiscard(player) {
  const hand = player.hand;
  let candidates = hand.slice();
  // 川麻定缺：必须先打缺门花色
  if (player.queMen) {
    const base = { m: 0, p: 9, s: 18 }[player.queMen];
    const qm = hand.filter(t => t >= base && t < base + 9);
    if (qm.length) candidates = qm;
  }
  let best = candidates[0], bestV = Infinity;
  for (const t of candidates) {
    const v = tileValue(hand, t) + Math.random() * 0.5;
    if (v < bestV) { bestV = v; best = t; }
  }
  return best;
}

function aiChooseQue(player) {
  const c = handCounts(player.hand);
  const suits = { m: 0, p: 0, s: 0 };
  for (let t = 0; t < 27; t++) {
    const s = ['m', 'p', 's'][Math.floor(t / 9)];
    suits[s] += c[t];
  }
  // 选张数最少的花色定缺
  let min = 'm', minN = Infinity;
  for (const s of ['m', 'p', 's']) if (suits[s] < minN) { minN = suits[s]; min = s; }
  return min;
}

function decideTurn(player, prompt) {
  for (const a of prompt.actions) {
    if (a.type === 'hu') return { type: 'hu' };
  }
  // 暗杠（自己摸齐四张）：安全且加点，执行
  for (const a of prompt.actions) {
    if (a.type === 'angang') return { type: 'angang', tile: a.tile };
  }
  // 默认出牌
  return { type: 'discard', tile: aiDiscard(player) };
}

function decideClaim(player, prompt, tile) {
  for (const a of prompt.actions) {
    if (a.type === 'hu') return { type: 'hu' };
  }
  // 直杠（别人点杠）：安全吃分
  for (const a of prompt.actions) {
    if (a.type === 'gang') return { type: 'gang', tile };
  }
  // 碰：若两张并非顺子潜力则碰（避免拆顺子）
  for (const a of prompt.actions) {
    if (a.type === 'peng') {
      const hand = player.hand;
      const neighbors = hand.filter(h => h === tile - 1 || h === tile + 1).length;
      const isHonorTile = isHonor(tile);
      if (isHonorTile || neighbors === 0) return { type: 'peng', tile };
    }
  }
  return { type: 'pass' };
}

module.exports = { aiChooseQue, aiDiscard, decideTurn, decideClaim };
