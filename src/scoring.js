// scoring.js — 胡牌番种计算与算分
// 输入 ctx: { concealedCounts(34计数,含胡的那张牌,金牌仍记在其索引上),
//             melds, selfDraw, jinIndex, isRobKong, isGangFlower, isLastTile, variant }

const { suitOf } = require('./tiles');

// 递归分解（带百搭），可关闭顺子用于“碰碰胡”判定
function decompose(counts, needSets, needPair, wild, opts) {
  opts = opts || {};
  const allowSeq = opts.sequencesAllowed !== false;
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return needSets === 0 && !needPair && wild === 0;

  // 将（对子）
  if (needPair) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      if (decompose(counts, needSets, false, wild, opts)) { counts[i] += 2; return true; }
      counts[i] += 2;
    }
    if (counts[i] >= 1 && wild >= 1) {
      counts[i] -= 1; wild -= 1;
      if (decompose(counts, needSets, false, wild, opts)) { counts[i] += 1; wild += 1; return true; }
      counts[i] += 1; wild += 1;
    }
    if (wild >= 2) {
      wild -= 2;
      if (decompose(counts, needSets, false, wild, opts)) { wild += 2; return true; }
      wild += 2;
    }
  }
  // 刻子（含百搭）
  for (let w = 0; w <= 3; w++) {
    const need = 3 - w;
    if (w <= wild && counts[i] >= need && need >= 0) {
      counts[i] -= need; wild -= w;
      if (decompose(counts, needSets - 1, needPair, wild, opts)) { counts[i] += need; wild += w; return true; }
      counts[i] += need; wild += w;
    }
  }
  // 顺子
  if (allowSeq && i < 27 && (i % 9) <= 6) {
    for (let mask = 0; mask < 8; mask++) {
      let w = 0, valid = true;
      const needArr = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if ((mask >> k) & 1) w++;
        else {
          if (counts[i + k] < 1) { valid = false; break; }
          needArr[k] = 1;
        }
      }
      if (!valid || w > wild) continue;
      for (let k = 0; k < 3; k++) if (needArr[k]) counts[i + k]--;
      wild -= w;
      if (decompose(counts, needSets - 1, needPair, wild, opts)) {
        for (let k = 0; k < 3; k++) if (needArr[k]) counts[i + k]++;
        wild += w; return true;
      }
      for (let k = 0; k < 3; k++) if (needArr[k]) counts[i + k]++;
      wild += w;
    }
  }
  return false;
}

// 七对分析（含金牌百搭）
function analyzeSevenPairs(concealedCounts, jinIndex) {
  const wild = jinIndex >= 0 ? concealedCounts[jinIndex] : 0;
  const c = concealedCounts.slice();
  if (jinIndex >= 0) c[jinIndex] = 0;
  let pairs = 0, singles = 0, hasFour = false;
  for (let i = 0; i < 34; i++) {
    pairs += Math.floor(c[i] / 2);
    if (c[i] % 2) singles++;
    if (c[i] === 4) hasFour = true;
  }
  if (wild < singles) return null;
  const rem = wild - singles;
  if (rem % 2 !== 0) return null;
  if (pairs + singles + rem / 2 !== 7) return null;
  return { isQiDui: true, isLong: hasFour };
}

function sumCounts(counts) {
  let s = 0;
  for (const v of counts) s += v;
  return s;
}

// 所有牌（含副露）按花色归类，判断清一色
function suitSetOf(concealedCounts, melds, jinIndex) {
  const suits = new Set();
  let hasHonor = false;
  for (let i = 0; i < 34; i++) {
    if (concealedCounts[i] > 0) {
      if (i >= 27) hasHonor = true; else suits.add(Math.floor(i / 9));
    }
  }
  for (const m of melds) {
    for (const t of m.tiles) {
      if (t === jinIndex) continue; // 金作为百搭不计入花色
      if (t >= 27) hasHonor = true; else suits.add(Math.floor(t / 9));
    }
  }
  return { suits, hasHonor };
}

// 根数（川麻：某花色四张相同）
function countRoots(concealedCounts, melds, jinIndex) {
  const total = concealedCounts.slice();
  for (const m of melds) for (const t of m.tiles) if (t !== jinIndex) total[t]++;
  let roots = 0;
  for (let i = 0; i < 34; i++) if (i !== jinIndex && total[i] >= 4) roots++;
  return roots;
}

function computeFan(ctx) {
  const { concealedCounts, melds, selfDraw, jinIndex, isRobKong, isGangFlower, isLastTile, variant } = ctx;
  const w = variant.fanWeights;
  const names = [];
  let fan = 0;

  const wild = jinIndex >= 0 ? concealedCounts[jinIndex] : 0;
  const normCounts = concealedCounts.slice();
  if (jinIndex >= 0) normCounts[jinIndex] = 0; // 金作为百搭，不计入普通牌分解

  // 平胡（基础）
  fan += w.pinghu; names.push('平胡');

  // 门清（无吃/碰/补杠；暗杠可）
  const hasExposed = melds.some(m => ['peng', 'chi', 'bugang'].includes(m.type));
  if (!hasExposed) { fan += w.menghing; names.push('门清'); }

  // 碰碰胡
  const noChi = melds.every(m => m.type !== 'chi');
  if (noChi) {
    const tmp = normCounts.slice();
    if (decompose(tmp, 4 - melds.length, true, wild, { sequencesAllowed: false })) {
      fan += w.pengpeng; names.push('碰碰胡');
    }
  }

  // 清一色：全部牌同花色（m/p/s 中之一）且无字牌
  const { suits, hasHonor } = suitSetOf(concealedCounts, melds, jinIndex);
  if (suits.size === 1 && !hasHonor) { fan += w.qingyise; names.push('清一色'); }

  // 七对 / 龙七对
  const qi = analyzeSevenPairs(concealedCounts, jinIndex);
  if (qi && melds.length === 0) {
    if (qi.isLong) { fan += w.longqidui; names.push('龙七对'); }
    else { fan += w.qidui; names.push('七对'); }
  }

  // 金钩钓（四杠 + 将）
  const allGang = melds.length === 4 && melds.every(m => ['gang', 'angang', 'bugang'].includes(m.type));
  if (allGang && sumCounts(concealedCounts) === 2) { fan += w.jingou; names.push('金钩钓'); }

  // 自摸
  if (selfDraw) { fan += w.zimo; names.push('自摸'); }

  // 杠
  const gangCount = melds.filter(m => ['gang', 'angang', 'bugang'].includes(m.type)).length;
  if (gangCount > 0) { fan += w.gang * gangCount; names.push('杠x' + gangCount); }

  // 金牌加分
  if (variant.jin && wild > 0) { fan += w.jin * wild; names.push('金x' + wild); }

  // 根（川麻）
  if (variant.key === 'sichuan') {
    const gen = countRoots(concealedCounts, melds, jinIndex);
    if (gen > 0) { fan += w.gen * gen; names.push('根x' + gen); }
  }

  // 特殊番
  if (isGangFlower) { fan += w.gangshanghua; names.push('杠上花'); }
  if (isRobKong) { fan += w.qianggang; names.push('抢杠胡'); }
  if (isLastTile) { fan += w.haidilao; names.push('海底'); }

  // 算分
  let score;
  if (variant.scoring === 'double') score = variant.basePoint * Math.pow(2, Math.max(0, fan - 1));
  else score = variant.basePoint * fan;

  return { fan, names, score };
}

module.exports = { decompose, analyzeSevenPairs, computeFan, suitSetOf, countRoots };
