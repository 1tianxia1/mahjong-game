// WS 端到端整局冒烟测试：模拟一名真人（自动应答）联网对局，跑到结算。
// 验证链路：create -> lobby -> que -> playing -> (多轮动作) -> ended(结算)。
const WebSocket = require('ws');

function run(variant, playerCount, aiFill) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:3000');
    let states = 0, lastState = null, youSeat = null, err = null, ended = false;
    let phases = new Set();
    const done = (r) => { clearTimeout(timer); resolve(r); };
    const log = (...a) => console.log(`[${variant} ${playerCount}p]`, ...a);

    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'create', variant, playerCount, name: 'Tester', aiFill }));
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'created') {
        youSeat = m.seat;
        ws.send(JSON.stringify({ action: 'start' }));
      } else if (m.type === 'state') {
        lastState = m.state; states++; phases.add(m.state.phase);
        if (m.state.phase === 'ended') {
          ended = true;
          log('游戏结束 ✅ 比分=', m.state.players.map(p => `${p.seat}:${p.score}`).join(' '));
          ws.close();
          return done({ ok: true, variant, playerCount, states, scores: m.state.players.map(p => p.score) });
        }
      } else if (m.type === 'action') {
        const p = m.prompt;
        const me = lastState ? lastState.players.find(x => x.seat === youSeat) : null;
        if (p.type === 'que') {
          // 选手牌里数量最少的花色定缺；若无手牌信息则默认定缺 s
          if (!me || !me.hand) return ws.send(JSON.stringify({ action: 'action', move: { type: 'que', suit: 's' } }));
          const suits = { m: 0, p: 0, s: 0, z: 0 };
          me.hand.forEach(t => {
            const s = t < 9 ? 'm' : t < 18 ? 'p' : t < 27 ? 's' : 'z';
            suits[s]++;
          });
          // 优先定缺字牌（若有），否则定缺最少的花色
          const pick = suits.z > 0 ? 'z' : (['m', 'p', 's'].sort((a, b) => suits[a] - suits[b])[0]);
          return ws.send(JSON.stringify({ action: 'action', move: { type: 'que', suit: pick } }));
        }
        // 自己的回合：能自摸胡就胡，否则出第一张
        if (p.type === 'turn' || p.type === 'discardOnly') {
          if (p.options && p.options.includes('hu')) {
            return ws.send(JSON.stringify({ action: 'action', move: { type: 'hu' } }));
          }
          const tile = me && me.hand && me.hand.length ? me.hand[0] : 0;
          return ws.send(JSON.stringify({ action: 'action', move: { type: 'discard', tile } }));
        }
        // claim：能胡就胡（点炮胡），否则过
        if (p.options && p.options.includes('hu')) {
          return ws.send(JSON.stringify({ action: 'action', move: { type: 'hu' } }));
        }
        return ws.send(JSON.stringify({ action: 'action', move: { type: 'pass' } }));
      } else if (m.type === 'error') {
        err = m.message; log('ERROR', m.message); ws.close();
        return done({ ok: false, variant, playerCount, error: m.message });
      }
    });
    ws.on('error', (e) => { log('WS错误', e.message); done({ ok: false, variant, playerCount, error: e.message }); });
    ws.on('close', () => { if (!ended && !err) done({ ok: false, variant, playerCount, error: 'closed early', states }); });
    const timer = setTimeout(() => { log('超时, 已收帧=', states, 'phases=', [...phases].join(',')); ws.close(); done({ ok: false, variant, playerCount, error: 'timeout', states, phases: [...phases] }); }, 150000);
  });
}

(async () => {
  const cases = [
    ['ningde', 4, true],
    ['fuzhou', 4, true],
    ['sichuan', 4, true],
    ['sichuan', 3, true],
  ];
  let allOk = true;
  for (const [v, c, a] of cases) {
    const r = await run(v, c, a);
    if (!r.ok) { allOk = false; console.log('  ❌', v, c, 'p', JSON.stringify(r)); }
    else console.log('  ✅', v, c, 'p 收帧=', r.states, '比分=', r.scores.join('/'));
  }
  console.log(allOk ? '\n全部 WS 端到端整局测试通过 🎉' : '\n存在失败用例 ❌');
  process.exit(allOk ? 0 : 1);
})();
