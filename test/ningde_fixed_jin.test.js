// ningde_fixed_jin.test.js — 宁德麻将专项回归测试
// 覆盖 RULE-ND-001 ~ RULE-ND-005：112 张牌池 + 固定白板为金 + 已弃金牌数递减 + 白板百搭胡牌。
// 运行：node test/ningde_fixed_jin.test.js

const assert = require('assert');
const { Game } = require('../src/engine');
const VARIANTS = require('../src/variants');
const tiles = require('../src/tiles');
const { buildVariantTileBag, buildTileBag, VARIANT_TILE_SETS, getTileSet, getTileTypes } = tiles;

// ---------- 辅助：AI 钩子，用于需要 deal/run 的用例 ----------
function aiHooks(players) {
  return {
    request: async (seat, prompt) => {
      if (prompt.type === 'que') return { type: 'que', suit: 's' };
      if (prompt.type === 'turn') return { type: 'discard', tile: 0 };
      if (prompt.type === 'discardOnly') return { type: 'discard', tile: 0 };
      if (prompt.type === 'claim') return { type: 'pass' };
      return { type: 'pass' };
    },
    broadcast: () => {},
    log: () => {},
  };
}

function makePlayers(count) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push({ id: 'p' + i, name: 'P' + i, isAI: true, seat: i, score: 0 });
  return arr;
}

// ---- 用例 1 · VARIANT_TILE_SETS 数据正确 -----------------------------------
(function () {
  assert.strictEqual(VARIANT_TILE_SETS.ningde.totalTiles, 112);
  assert.strictEqual(VARIANT_TILE_SETS.ningde.fixedJinIndex, 33);
  assert.strictEqual(VARIANT_TILE_SETS.ningde.useHonors, false);

  assert.strictEqual(VARIANT_TILE_SETS.fuzhou.totalTiles, 136);
  assert.strictEqual(VARIANT_TILE_SETS.fuzhou.fixedJinIndex, null);
  assert.strictEqual(VARIANT_TILE_SETS.fuzhou.useHonors, true);

  assert.strictEqual(VARIANT_TILE_SETS.sichuan.totalTiles, 108);
  assert.strictEqual(VARIANT_TILE_SETS.sichuan.fixedJinIndex, null);
  assert.strictEqual(VARIANT_TILE_SETS.sichuan.useHonors, false);

  // getTileTypes 覆盖：宁德=28 型、福州=34 型、川麻=27 型
  assert.strictEqual(getTileTypes(VARIANTS.ningde).length, 28);
  assert.strictEqual(getTileTypes(VARIANTS.fuzhou).length, 34);
  assert.strictEqual(getTileTypes(VARIANTS.sichuan).length, 27);
  console.log('✓ 用例1 · VARIANT_TILE_SETS / getTileTypes 数据正确');
})();

// ---- 用例 2 · buildVariantTileBag 宁德 112 张 ------------------------------
(function () {
  const bag = buildVariantTileBag(VARIANTS.ningde);
  assert.strictEqual(bag.length, 112, '宁德牌池必须 112 张');
  for (let t = 27; t <= 32; t++) {
    assert.strictEqual(bag.indexOf(t), -1, `宁德牌池不应含字牌 ${t}`);
  }
  assert.strictEqual(bag.filter(t => t === 33).length, 4, '宁德牌池应含 4 张白板');
  const count026 = bag.filter(t => t >= 0 && t <= 26).length;
  assert.strictEqual(count026, 108, '宁德牌池 0..26 应合计 108 张');
  console.log('✓ 用例2 · buildVariantTileBag 宁德 112 张（0..26 × 4 + 33 × 4）');
})();

// ---- 用例 3 · buildVariantTileBag 福州 136 张 ------------------------------
(function () {
  const bag = buildVariantTileBag(VARIANTS.fuzhou);
  assert.strictEqual(bag.length, 136, '福州牌池必须 136 张');
  assert.strictEqual(bag.filter(t => t === 33).length, 4, '福州含 4 张白板');
  const countHonors = bag.filter(t => t >= 27 && t <= 32).length;
  assert.strictEqual(countHonors, 24, '福州 27..32 应合计 24 张（6 型 × 4）');
  console.log('✓ 用例3 · buildVariantTileBag 福州 136 张回归');
})();

// ---- 用例 4 · buildVariantTileBag 川麻 108 张 ------------------------------
(function () {
  const bag = buildVariantTileBag(VARIANTS.sichuan);
  assert.strictEqual(bag.length, 108, '川麻牌池必须 108 张');
  assert.strictEqual(bag.filter(t => t >= 27).length, 0, '川麻牌池不含任何字牌');
  console.log('✓ 用例4 · buildVariantTileBag 川麻 108 张回归');
})();

// ---- 用例 5 · 引擎 determineJin 固定金（宁德）------------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.ningde, players, aiHooks(players));
  g.deal();
  assert.strictEqual(g.jinIndex, 33, '宁德金牌应为 33（白板）');
  assert.strictEqual(g.jinDice, 0, '宁德应不消耗骰子');
  const total = g.wall.length + players.reduce((s, p) => s + p.hand.length, 0);
  assert.strictEqual(total, 112, '宁德开局 wall + 手牌 = 112');
  console.log('✓ 用例5 · 宁德 determineJin：jinIndex=33, jinDice=0, 牌池 112 张');
})();

// ---- 用例 6 · 引擎 determineJin 福州骰子（回归）----------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.fuzhou, players, aiHooks(players));
  g.deal();
  assert.ok(g.jinIndex >= 0 && g.jinIndex <= 33, '福州应骰子翻出有效金牌');
  assert.ok(g.jinDice >= 2 && g.jinDice <= 12, '福州骰子应在 [2..12] 区间');
  console.log('✓ 用例6 · 福州 determineJin：骰子分支正常');
})();

// ---- 用例 7 · 引擎 determineJin 川麻无金（回归）----------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.sichuan, players, aiHooks(players));
  g.deal();
  assert.strictEqual(g.jinIndex, -1, '川麻无金，jinIndex 保持 -1');
  console.log('✓ 用例7 · 川麻 determineJin：不触发翻金');
})();

// ---- 用例 8 · getState().meta 字段（宁德开局）-------------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.ningde, players, aiHooks(players));
  g.deal();
  const st = g.getState();
  assert.strictEqual(st.meta.basePoint, 1);
  assert.strictEqual(st.meta.useFixedJin, true);
  assert.strictEqual(st.meta.jinTileId, 33);
  assert.strictEqual(st.meta.jinTileName, '白');
  assert.strictEqual(st.meta.remainingJinCount, 4, '开局无出牌，金牌 4 张全部剩余');
  console.log('✓ 用例8 · 宁德 getState().meta 字段齐全且开局为 4');
})();

// ---- 用例 9 · computeRemainingJin 随出牌/碰杠递减 -------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.ningde, players, aiHooks(players));
  g.deal();

  assert.strictEqual(g.computeRemainingJin(), 4, '未出牌时应为 4');

  g.players[0].discards = [33];
  assert.strictEqual(g.computeRemainingJin(), 3, '弃 1 张白板 → 3');

  g.players[0].discards = [33, 33];
  assert.strictEqual(g.computeRemainingJin(), 2, '弃 2 张白板 → 2');

  g.players[0].discards = [33, 33];
  g.players[1].melds = [{ type: 'peng', tiles: [33, 33, 33] }];
  assert.strictEqual(g.computeRemainingJin(), 0, '弃 2 张 + 副露 3 张 → 0（下界钳制）');
  console.log('✓ 用例9 · computeRemainingJin 递减：4→3→2→0');
})();

// ---- 用例 10 · 福州 computeRemainingJin 恒为 0 ----------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.fuzhou, players, aiHooks(players));
  g.deal();
  assert.strictEqual(g.computeRemainingJin(), 0, '非 fixed-jin 玩法应恒为 0');
  console.log('✓ 用例10 · 福州 computeRemainingJin 恒为 0');
})();

// ---- 用例 11 · 宁德含白板手型能胡（白板百搭） ------------------------------
(function () {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.ningde, players, aiHooks(players));
  g.deal();
  const p = g.players[0];
  // 手牌（14 张）：123万、123筒、123条、白板白板白板、5万 5万
  // → 3 副顺子 + 白板做将 55 万（2 wild 补成 55）
  p.hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 33, 33, 33, 5, 5];
  p.melds = [];
  const res = g.evaluateWin(p, null, { selfDraw: true });
  assert.ok(res && res.win, '含 3 张白板的手型应能胡牌（白板做将）');
  console.log('✓ 用例11 · 宁德白板百搭：3 副顺子 + 白板做将 → 胡');
})();

// ---- 用例 12 · buildTileBag 兼容函数不被破坏 ------------------------------
(function () {
  const bag = buildTileBag(true);
  assert.strictEqual(bag.length, 136, 'buildTileBag(true) 应返回 136 张（兼容保留）');
  const bag2 = buildTileBag(false);
  assert.strictEqual(bag2.length, 108, 'buildTileBag(false) 应返回 108 张（兼容保留）');
  console.log('✓ 用例12 · buildTileBag 兼容保留');
})();

console.log('\nningde_fixed_jin 专项测试全部通过 🎉');
