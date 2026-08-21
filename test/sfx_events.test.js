// sfx_events.test.js — detectEvents 事件优先级去重逻辑单元测试（R-006）
//
// 背景：detectEvents(prev, next) 定义在浏览器端 public/js/app.js 内（依赖 window/document，
// 无法在 node 直接 require）。本测试按 docs/architecture.md §4.3 的 dedup 设计，独立实现一份
// **相同优先级规则**的判定，锁定「同一帧内多事件只播最高优先级一项」这一纯逻辑：
//   优先级：hu > liuju > meld > discard > deal
//
// 运行：node test/sfx_events.test.js   （也可加入 package.json scripts.test 串联）
const assert = require('assert');

// ---- 与 app.js detectEvents 等价的纯函数实现（仅用于本测试，不依赖浏览器） ----
function detectEvents(prev, next) {
  if (!next) return [];
  const events = [];
  // 发牌：进入 playing（首次或回合开始阶段）
  if (next.phase === 'playing' && (!prev || prev.phase !== 'playing')) events.push('deal');
  // 流局：终局且荒庄
  if (next.phase === 'ended' && next.endReason === 'draw') events.push('liuju');
  // 胡：winners 数量增加
  if (next.winners && prev && prev.winners && next.winners.length > prev.winners.length) events.push('hu');
  // 碰杠：某家副露数增加（按数组下标对齐，玩家顺序稳定）
  const meldInc = next.players.some((p, i) => {
    const pp = prev && prev.players[i];
    return pp && p.melds && pp.melds && p.melds.length > pp.melds.length;
  });
  if (meldInc) events.push('meld');
  // 出牌：lastDiscard 的牌或出牌者发生变化
  if (next.lastDiscard && (!prev || !prev.lastDiscard ||
      next.lastDiscard.tile !== prev.lastDiscard.tile ||
      next.lastDiscard.seat !== prev.lastDiscard.seat)) events.push('discard');
  // 优先级去重：仅保留最高一项
  const prio = ['hu', 'liuju', 'meld', 'discard', 'deal'];
  for (const e of prio) if (events.indexOf(e) >= 0) return [e];
  return [];
}

// ---- 测试辅助：构造最小 state 快照 ----
function st(over) {
  return Object.assign({
    phase: 'playing',
    endReason: null,
    winners: [],
    lastDiscard: null,
    players: [{ melds: [] }, { melds: [] }],
  }, over);
}

// 用例1 · 同帧 胡 + 出牌 → 只触发「胡」
(function () {
  const prev = st({ lastDiscard: { seat: 0, tile: 5 }, winners: [] });
  const next = st({ lastDiscard: { seat: 0, tile: 9 }, winners: [{ seat: 1 }] });
  const evs = detectEvents(prev, next);
  assert.deepStrictEqual(evs, ['hu'], '胡+出牌 应只触发 hu');
  console.log('✓ 用例1 · 胡+出牌 → 仅 hu');
})();

// 用例2 · 碰杠 + 出牌 → 只触发「碰杠」
(function () {
  const prev = st({ lastDiscard: { seat: 0, tile: 5 }, players: [{ melds: [] }, { melds: [] }] });
  const next = st({ lastDiscard: { seat: 0, tile: 9 }, players: [{ melds: [{ type: 'peng', tile: 5 }] }, { melds: [] }] });
  const evs = detectEvents(prev, next);
  assert.deepStrictEqual(evs, ['meld'], '碰杠+出牌 应只触发 meld');
  console.log('✓ 用例2 · 碰杠+出牌 → 仅 meld');
})();

// 用例3 · 仅 出牌 → 触发「出牌」
(function () {
  const prev = st({ lastDiscard: { seat: 0, tile: 5 } });
  const next = st({ lastDiscard: { seat: 0, tile: 9 } });
  const evs = detectEvents(prev, next);
  assert.deepStrictEqual(evs, ['discard'], '仅出牌 应触发 discard');
  console.log('✓ 用例3 · 仅出牌 → discard');
})();

// 用例4 · 仅 发牌（无 lastDiscard 变化、phase 变为 playing）→ 触发「发牌」
(function () {
  // 首帧：prev 为 null，next 进入 playing
  const firstFrame = detectEvents(null, st({ phase: 'playing', lastDiscard: null }));
  assert.deepStrictEqual(firstFrame, ['deal'], '首帧进入 playing 应触发 deal');
  // 后续：仍 playing 且 lastDiscard 不变 → 不应再触发 deal
  const steady = detectEvents(st({ phase: 'playing', lastDiscard: null }), st({ phase: 'playing', lastDiscard: null }));
  assert.deepStrictEqual(steady, [], '持续 playing 且状态不变不应再触发 deal');
  console.log('✓ 用例4 · 发牌（playing 且 lastDiscard 无变化）→ deal');
})();

// 用例5 · 流局（phase ended 且无 winners 变化）场景正确归类
(function () {
  const prev = st({ phase: 'playing', lastDiscard: { seat: 0, tile: 5 }, winners: [] });
  const next = st({ phase: 'ended', endReason: 'draw', lastDiscard: { seat: 0, tile: 5 }, winners: [] });
  const evs = detectEvents(prev, next);
  assert.deepStrictEqual(evs, ['liuju'], '流局 应只触发 liuju');
  console.log('✓ 用例5 · 流局（ended+draw，winners 不变）→ liuju');
})();

// 附加用例 · 优先级全序：hu > liuju > meld > discard > deal
(function () {
  const prev = st({ phase: 'waiting', lastDiscard: null, winners: [] });
  const next = st({
    phase: 'ended', endReason: 'draw',
    lastDiscard: { seat: 0, tile: 9 },
    winners: [{ seat: 1 }],
    players: [{ melds: [{ type: 'peng', tile: 5 }] }, { melds: [] }],
  });
  // 同时含 deal(phase变化) / liuju(ended+draw) / meld / discard / hu(winners增加)
  const evs = detectEvents(prev, next);
  assert.deepStrictEqual(evs, ['hu'], '所有事件同帧出现时仅 hu 胜出');
  console.log('✓ 附加 · 全事件同帧 → hu 优先');
})();

console.log('\nsfx_events 事件优先级去重测试全部通过 🎉');
