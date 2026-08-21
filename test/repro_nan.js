// 复现川麻血战到底 NaN 计分 bug
const { Game } = require('../src/engine');
const VARIANTS = require('../src/variants');
const ai = require('../src/ai');

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
    log: (msg) => { /* 由 game.messages 收集 */ },
  };
}

(async () => {
  for (let round = 1; round <= 50; round++) {
    for (const [variantKey, count] of [['sichuan', 3], ['sichuan', 4], ['ningde', 3], ['fuzhou', 3], ['ningde', 4], ['fuzhou', 4]]) {
      const players = [];
      for (let i = 0; i < count; i++) players.push({ id: 'ai' + i, name: 'A' + i, isAI: true, seat: i, score: 0 });
      const g = new Game(VARIANTS[variantKey], players, aiHooks(players));
      await g.run();
      const bad = players.some(p => !Number.isFinite(p.score));
      if (bad) {
        console.log(`\n❌ 第${round}轮 ${variantKey}-${count}人 NaN! 比分=${players.map(p => p.score).join('/')}`);
        console.log('=== 整局消息 ===');
        console.log(g.messages.join('\n'));
        console.log('=== 结算时各玩家 ===');
        for (const p of players) console.log(JSON.stringify({ seat: p.seat, score: p.score, isWinner: p.isWinner, lastWin: p.lastWin, hand: p.hand, melds: p.melds }));
        process.exit(1);
      }
    }
    if (round % 10 === 0) console.log(`已跑 ${round} 轮无 NaN`);
  }
  console.log('50 轮全部正常，无 NaN');
})();
