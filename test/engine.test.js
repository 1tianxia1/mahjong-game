// engine.test.js — 单元校验 + 全 AI 整局冒烟测试
const assert = require('assert');
const { Game } = require('../src/engine');
const VARIANTS = require('../src/variants');
const ai = require('../src/ai');
const { toCounts } = require('../src/tiles');

// 用“全 AI”钩子跑一整局，验证不抛异常、能正常结束
function aiHooks(players) {
  return {
    request: async (seat, prompt) => {
      const p = players.find(x => x.seat === seat);
      if (prompt.type === 'que') return { type: 'que', suit: ai.aiChooseQue(p) };
      if (prompt.type === 'turn') return ai.decideTurn(p, prompt);
      if (prompt.type === 'discardOnly') return { type: 'discard', tile: ai.aiDiscard(p) };
      if (prompt.type === 'claim') return ai.decideClaim(p, prompt, prompt.tile);
      return { type: 'pass' };
    },
    broadcast: () => {},
    log: () => {},
  };
}

async function smoke(variantKey, count) {
  const players = [];
  for (let i = 0; i < count; i++) players.push({ id: 'ai' + i, name: 'A' + i, isAI: true, seat: i, score: 0 });
  const g = new Game(VARIANTS[variantKey], players, aiHooks(players));
  await g.run();
  assert.strictEqual(g.phase, 'ended', `${variantKey}-${count} 未正常结束`);
  // 分数必须全部为有限数（防 NaN 计分回归，如 fanWeights 缺键）
  for (const p of players) assert.ok(Number.isFinite(p.score), `${variantKey}-${count} 玩家${p.seat}分数非法: ${p.score}`);
  console.log(`✓ ${VARIANTS[variantKey].name} ${count}人 结束，赢家=${g.winners.length}，比分=${players.map(p => p.score).join('/')}`);
}

// 单元：胡牌判定
function makePlayer(hand, melds, queMen) {
  return { hand: hand.slice(), melds: melds || [], queMen: queMen || null, score: 0 };
}

function testWins() {
  // 川麻标准胡：两门（m/p）+ 将，定缺 s
  const g = new Game(VARIANTS.sichuan, [], aiHooks([]));
  g.jinIndex = -1;
  let p = makePlayer([0,1,2,3,4,5,6,7,8, 9,10,11, 17,17], [], 's'); // 123m456m789m 123p 99p
  let r = g.evaluateWin(p, null, { selfDraw: true });
  assert.ok(r && r.win, '川麻标准胡应判胡');

  // 非胡：将不成对
  p = makePlayer([0,1,2,3,4,5,6,7,8, 9,9,10,11,17], [], 's'); // 123456789m 11p23p 9p
  r = g.evaluateWin(p, null, { selfDraw: true });
  assert.ok(!r, '非成牌应判不胡');

  // 七对
  p = makePlayer([0,0,1,1,2,2,3,3, 9,9,10,10,11,11], [], 's'); // 11m22m33m44m 11p22p33p
  r = g.evaluateWin(p, null, { selfDraw: true });
  assert.ok(r && r.win, '七对应判胡');

  // 缺一门违规：手里有定缺花色 -> 不胡
  p = makePlayer([0,1,2,3,4,5,6,7,8, 9,10,11, 17,17], [], 'm'); // 定缺万但却有万
  r = g.evaluateWin(p, null, { selfDraw: true });
  assert.ok(!r, '缺一门违规应不胡');

  // 福州：三金倒（3 张金牌直接胡）
  const gf = new Game(VARIANTS.fuzhou, [], aiHooks([]));
  gf.jinIndex = 0; // 1m 为金
  p = makePlayer([0,0,0, 5,6,7, 14,15,16, 23,24,25, 30,30], [], null);
  r = gf.evaluateWin(p, null, { selfDraw: true });
  assert.ok(r && r.win && r.special === 'threejin', '三金倒应判胡');

  // 福州：金牌做百搭补全顺子
  p = makePlayer([0,0, 2,3,4, 14,15,16, 23,24,25, 30,30, 5], [], null); // 两张金 + 345m + 456p + 789s + 55m 将? 需14张
  r = gf.evaluateWin(p, null, { selfDraw: true });
  assert.ok(r && r.win, '金牌百搭应判胡');

  console.log('✓ 胡牌判定单元测试通过');
}

(async () => {
  testWins();
  for (const v of ['ningde', 'fuzhou', 'sichuan']) {
    for (const c of [3, 4]) {
      await smoke(v, c);
    }
  }
  console.log('\n全部测试通过 🎉');
})().catch(e => { console.error('测试失败:', e); process.exit(1); });
