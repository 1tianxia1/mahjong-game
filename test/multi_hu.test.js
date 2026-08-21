// multi_hu.test.js — 一炮多响专项回归测试（R-004 / 严重规则 Bug 修复）
// 牌型与期望值已在真实引擎上实测验证（见 docs/architecture.md §7 T01）。
// 运行：node test/multi_hu.test.js
const assert = require('assert');
const { Game } = require('../src/engine');
const VARIANTS = require('../src/variants');

// 钩子： claim 提示里只要含 hu 就回 {type:'hu'}，否则过。
function huHooks(players) {
  return {
    request: async (seat, prompt) => {
      if (prompt && prompt.actions && prompt.actions.some(a => a.type === 'hu')) return { type: 'hu' };
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

// 覆盖某座位手牌与定缺，并重置结算态（deal() 之后调用）
function setHand(g, seat, hand, queMen) {
  const p = g.bySeat(seat);
  p.hand = hand.slice();
  p.queMen = queMen || null;
  p.isWinner = false;
  p.lastWin = null;
  p.score = 0;
}

async function testCollectBloodBattle() {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.sichuan, players, huHooks(players));
  g.deal();
  // 座位0 = 点炮者（打出 17 = 9筒）；座位1、3 同时可胡 9筒；座位2 必过
  setHand(g, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 's');
  setHand(g, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], 's'); // 123m456m789m 123p 9p 听 9p
  setHand(g, 2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null); // 无 17、无胡无碰
  setHand(g, 3, [18, 19, 20, 21, 22, 23, 24, 25, 26, 9, 10, 11, 17], 'm'); // 123s456s789s 123p 9p 听 9p

  const res = await g.resolveClaims(g.bySeat(0), 17);
  assert.ok(res && res.type === 'hu', '应返回 hu 结果');
  assert.ok(Array.isArray(res.seats), '返回契约应为 seats 数组');
  assert.strictEqual(res.seats.length, 2, '川麻血战应收集两家胡家');
  assert.deepStrictEqual(res.seats, [1, 3], '座位1、3 同时胡，应 [1,3]');
  console.log('✓ 用例1 · 血战多响收集 seats=[1,3]');
}

async function testSettleBloodBattle() {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.sichuan, players, huHooks(players));
  g.deal();
  setHand(g, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 's');
  setHand(g, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], 's');
  setHand(g, 2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null);
  setHand(g, 3, [18, 19, 20, 21, 22, 23, 24, 25, 26, 9, 10, 11, 17], 'm');

  const res = await g.resolveClaims(g.bySeat(0), 17);
  const handled = g.handleClaim(res, g.bySeat(0));
  assert.strictEqual(handled, true, 'handleClaim 应返回 true');

  const p0 = g.bySeat(0), p1 = g.bySeat(1), p3 = g.bySeat(3);
  assert.strictEqual(p1.score, 2, '座位1 应得 2 分');
  assert.strictEqual(p3.score, 2, '座位3 应得 2 分');
  assert.strictEqual(p0.score, -4, '座位0 应赔付两家共 -4 分');
  assert.strictEqual(p1.isWinner, true, '座位1 应为赢家');
  assert.strictEqual(p3.isWinner, true, '座位3 应为赢家');
  assert.strictEqual(g.winners.length, 2, 'winners 应为 2 家');
  for (const p of players) assert.ok(Number.isFinite(p.score), `座位${p.seat} 分数应有限`);
  assert.ok(g.messages.some(m => m.includes('一炮多响')), '日志应记录「一炮多响」');
  console.log('✓ 用例2 · 血战多响结算：座位1=+2 座位3=+2 座位0=-4，winners=2');
}

async function testNonBloodBattleNearest() {
  const players = makePlayers(4);
  const g = new Game(VARIANTS.ningde, players, huHooks(players));
  g.deal(); // ningde 有金牌，jinIndex 会被确定，但不影响 seat 收集断言
  setHand(g, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null);
  setHand(g, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], null);
  setHand(g, 2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null);
  setHand(g, 3, [18, 19, 20, 21, 22, 23, 24, 25, 26, 9, 10, 11, 17], null);

  const res = await g.resolveClaims(g.bySeat(0), 17);
  assert.ok(res && res.type === 'hu', '非血战也应返回 hu');
  assert.strictEqual(res.seats.length, 1, '非血战只结算 1 家');
  console.log('✓ 用例3 · 非血战(bloodBattle=false)只取最近一家');
}

async function testSeatOrdering() {
  // 让座位2 出牌，座位0 与座位3 同时可胡；断言下家优先 [3,0]
  const players = makePlayers(4);
  const g = new Game(VARIANTS.sichuan, players, huHooks(players));
  g.deal();
  setHand(g, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], 's'); // 座位0 可胡
  setHand(g, 1, [0, 1, 2, 18, 19, 20, 21, 22, 23, 24, 25, 26, 8], 'm'); // 含万→定缺违规，必过；无 17
  setHand(g, 2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 's'); // 点炮者
  setHand(g, 3, [18, 19, 20, 21, 22, 23, 24, 25, 26, 9, 10, 11, 17], 'm'); // 座位3 可胡

  const res = await g.resolveClaims(g.bySeat(2), 17);
  assert.ok(res && res.type === 'hu', '应返回 hu');
  assert.deepStrictEqual(res.seats, [3, 0], '座次排序应下家优先 [3,0]');
  console.log('✓ 用例4 · 座次排序 dist() 下家优先 seats=[3,0]');
}

async function testEndgameBoundary() {
  // 3 人血战两家同时胡 → 立即终局（winners 2 >= playerCount-1 2）
  const players = makePlayers(3);
  const g = new Game(VARIANTS.sichuan, players, huHooks(players));
  g.deal();
  setHand(g, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 's'); // 点炮者
  setHand(g, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], 's');
  setHand(g, 2, [18, 19, 20, 21, 22, 23, 24, 25, 26, 9, 10, 11, 17], 'm');

  const res = await g.resolveClaims(g.bySeat(0), 17);
  assert.ok(res && res.type === 'hu', '应返回 hu');
  g.handleClaim(res, g.bySeat(0));
  assert.strictEqual(g.phase, 'ended', '3 人两家胡应触发终局');
  assert.strictEqual(g.winners.length, 2, 'winners 应为 2 家（无漏结算）');
  console.log('✓ 用例5 · 3 人血战两家同时胡 → 终局且无漏结算');
}

(async () => {
  testCollectBloodBattle();
  testSettleBloodBattle();
  testNonBloodBattleNearest();
  testSeatOrdering();
  testEndgameBoundary();
  console.log('\n一炮多响专项测试全部通过 🎉');
})().catch(e => { console.error('一炮多响测试失败:', e); process.exit(1); });
