// engine.js — 麻将核心引擎（权威服务端逻辑）
// 设计：单局 Game 由 async 主循环驱动；通过 hooks.request 向每个座位索取动作
// （真人由房间转发到 WebSocket，AI 由房间直接算出）。所有并发都在单个 async 循环内
// 以 await 串行化，天然无竞态。

const { buildTileBag, buildVariantTileBag, toCounts, suitOf, numberOf, tileName, shuffle } = require('./tiles');
const { decompose, analyzeSevenPairs, computeFan } = require('./scoring');

class Game {
  constructor(variant, players, hooks) {
    this.variant = variant;
    this.players = players;           // [{id,name,isAI,seat}]
    this.hooks = hooks;               // {request, broadcast, log}
    this.playerCount = players.length;
    this.phase = 'waiting';
    this.current = 0;
    this.dealer = 0;
    this.wall = [];
    this.wallIdx = 0;
    this.jinIndex = -1;
    this.jinDice = 0;
    this.lastDiscard = null;          // {seat, tile}
    this.lastDrawn = null;            // {seat, tile}
    this.mustDiscardSeat = null;
    this.gangFlowerArmed = -1;
    this.winners = [];
    this.endReason = null;
    this.messages = [];
  }

  // ---------- 基础工具 ----------
  bySeat(seat) { return this.players.find(p => p.seat === seat); }
  isActive(p) { return !p.isWinner; }
  nextActive(seat) {
    for (let k = 1; k <= this.playerCount; k++) {
      const s = (seat + k) % this.playerCount;
      if (this.isActive(this.bySeat(s))) return s;
    }
    return seat;
  }
  prevActive(seat) {
    for (let k = 1; k <= this.playerCount; k++) {
      const s = (seat - k + this.playerCount) % this.playerCount;
      if (this.isActive(this.bySeat(s))) return s;
    }
    return seat;
  }
  log(msg) { this.messages.push(msg); if (this.hooks.log) this.hooks.log(msg); }
  broadcast() { if (this.hooks.broadcast) this.hooks.broadcast(); }
  request(seat, prompt) { return this.hooks.request(seat, prompt); }

  // ---------- 发牌 ----------
  deal() {
    this.wall = shuffle(buildVariantTileBag(this.variant));
    this.wallIdx = 0;
    for (const p of this.players) {
      p.hand = []; p.melds = []; p.discards = []; p.isWinner = false; p.lastWin = null;
      p.queMen = null; p.score = (p.score || 0);
    }
    for (let r = 0; r < 13; r++) for (const p of this.players) p.hand.push(this.wall[this.wallIdx++]);
    for (const p of this.players) p.hand.sort((a, b) => a - b);
    if (this.variant.jin) this.determineJin();
    this.dealer = this.players[0].seat;
    this.current = this.dealer;
  }

  determineJin() {
    // 宁德等 fixed-jin 玩法：金牌固定为白板，不消耗骰子
    if (this.variant.useFixedJin) {
      this.jinIndex = this.variant.jinTile;
      this.jinDice = 0;
      this.log(`宁德固定金：${tileName(this.jinIndex)}（4 张）`);
      return;
    }
    const dice = 2 + Math.floor(Math.random() * 11);
    const remaining = this.wall.length - this.wallIdx;
    const pos = this.wallIdx + (remaining - 1 - (dice % remaining) + remaining) % remaining;
    const t = this.wall[pos];
    let jin = t;
    if (t < 27) {
      jin = t + 1;
      if ((jin % 9) === 0) jin = t - 8; // 9 翻回 1
    }
    this.jinIndex = jin;
    this.jinDice = dice;
    this.log(`翻金：骰子${dice}，金牌为「${tileName(jin)}」`);
  }

  // ---------- 胡牌判定 ----------
  // opts: {selfDraw, rob, flower, last, ignoreMinFan}
  evaluateWin(player, winTile, opts) {
    opts = opts || {};
    const jinIndex = this.jinIndex;
    const hand = player.hand.slice();
    if (winTile != null) hand.push(winTile);
    const counts = toCounts(hand);
    const wild = jinIndex >= 0 ? counts[jinIndex] : 0;

    // 三金倒（直接胡）
    if (this.variant.threeJinWin > 0 && wild >= this.variant.threeJinWin) {
      const fan = computeFan({ concealedCounts: counts, melds: player.melds, selfDraw: !!opts.selfDraw, jinIndex, isRobKong: !!opts.rob, isGangFlower: !!opts.flower, isLastTile: !!opts.last, variant: this.variant });
      return { win: true, special: 'threejin', tile: winTile, ...fan };
    }
    // 川麻缺一门：胡牌时手上不能有定缺花色
    if (this.variant.queMen && player.queMen) {
      const base = { m: 0, p: 9, s: 18 }[player.queMen];
      for (let i = base; i < base + 9; i++) if (counts[i] > 0) return null;
      for (const m of player.melds) for (const t of m.tiles) if (t !== jinIndex && t >= base && t < base + 9) return null;
    }
    // 标准/七对
    const norm = counts.slice(); if (jinIndex >= 0) norm[jinIndex] = 0;
    let std = decompose(norm, 4 - player.melds.length, true, wild, {});
    let qd = false;
    if (!std) {
      const qi = analyzeSevenPairs(counts, jinIndex);
      if (qi && player.melds.length === 0) { std = true; qd = true; }
    }
    if (!std) return null;
    const fan = computeFan({ concealedCounts: counts, melds: player.melds, selfDraw: !!opts.selfDraw, jinIndex, isRobKong: !!opts.rob, isGangFlower: !!opts.flower, isLastTile: !!opts.last, variant: this.variant });
    if (!opts.ignoreMinFan && fan.fan < this.variant.minFan) return null;
    return { win: true, special: qd ? 'qidui' : 'standard', tile: winTile, ...fan };
  }

  isTenpai(player) {
    const maxType = this.variant.useHonors ? 34 : 27;
    for (let t = 0; t < maxType; t++) {
      if (this.evaluateWin(player, t, { selfDraw: true, ignoreMinFan: true })) return true;
    }
    return false;
  }

  // ---------- 动作可用性 ----------
  getSelfActions(player) {
    const acts = [{ type: 'discard' }];
    const res = this.evaluateWin(player, null, { selfDraw: true });
    if (res) acts.push({ type: 'hu', info: res });
    // 暗杠
    const c = toCounts(player.hand);
    for (let t = 0; t < 34; t++) if (c[t] === 4) acts.push({ type: 'angang', tile: t });
    // 补杠
    for (const m of player.melds) if (m.type === 'peng' && c[m.tile] >= 1) acts.push({ type: 'bugang', tile: m.tile });
    return acts;
  }

  getDiscardActions(player) {
    const acts = [{ type: 'discard' }];
    // 杠后摸牌可能自摸（含杠上花）
    const res = this.evaluateWin(player, null, { selfDraw: true });
    if (res) acts.push({ type: 'hu', info: res });
    const c = toCounts(player.hand);
    for (const m of player.melds) if (m.type === 'peng' && c[m.tile] >= 1) acts.push({ type: 'bugang', tile: m.tile });
    return acts;
  }

  getClaimActions(player, fromSeat, tile) {
    const acts = [];
    const res = this.evaluateWin(player, tile, { selfDraw: false });
    if (res) acts.push({ type: 'hu', info: res });
    const c = toCounts(player.hand);
    if (c[tile] >= 2) acts.push({ type: 'peng' });
    if (c[tile] >= 3) acts.push({ type: 'gang' });
    // 吃：仅限上家
    if (this.prevActive(player.seat) === fromSeat) {
      const opts = this.chiOptions(player, tile);
      if (opts.length) acts.push({ type: 'chi', options: opts });
    }
    return acts;
  }

  chiOptions(player, tile) {
    const opts = [];
    if (tile >= 27) return opts;
    const has = (x) => player.hand.filter(h => h === x).length;
    const combos = [[tile - 2, tile - 1], [tile - 1, tile + 1], [tile + 1, tile + 2]];
    for (const [a, b] of combos) {
      if (a < 0 || b > 33) continue;
      if (Math.floor(a / 9) !== Math.floor(tile / 9) || Math.floor(b / 9) !== Math.floor(tile / 9)) continue;
      if (has(a) > 0 && has(b) > 0) opts.push([a, b]);
    }
    return opts;
  }

  // ---------- 执行动作 ----------
  doDiscard(player, tile) {
    const idx = player.hand.indexOf(tile);
    if (idx < 0) { tile = player.hand[0]; }
    player.hand.splice(player.hand.indexOf(tile), 1);
    player.discards.push(tile);
    player.hand.sort((a, b) => a - b);
    this.lastDiscard = { seat: player.seat, tile };
    this.gangFlowerArmed = -1;
  }

  doSelfGang(player, act) {
    const tile = act.tile;
    if (act.type === 'angang') {
      for (let k = 0; k < 4; k++) player.hand.splice(player.hand.indexOf(tile), 1);
      player.melds.push({ type: 'angang', tile, tiles: [tile, tile, tile, tile], from: player.seat });
      this.applyGangScore(player, 'angang');
      const t = this.wall[this.wallIdx++]; if (t != null) player.hand.push(t);
      this.gangFlowerArmed = player.seat;
    } else if (act.type === 'bugang') {
      const m = player.melds.find(x => x.type === 'peng' && x.tile === tile);
      m.type = 'bugang'; m.tiles.push(tile);
      player.hand.splice(player.hand.indexOf(tile), 1);
      this.applyGangScore(player, 'bugang');
    }
    player.hand.sort((a, b) => a - b);
  }

  doMeldClaim(seat, discarder, act) {
    const p = this.bySeat(seat);
    const tile = act.tile;
    if (act.type === 'peng') {
      for (let k = 0; k < 2; k++) p.hand.splice(p.hand.indexOf(tile), 1);
      p.melds.push({ type: 'peng', tile, tiles: [tile, tile, tile], from: discarder.seat });
    } else if (act.type === 'gang') {
      for (let k = 0; k < 3; k++) p.hand.splice(p.hand.indexOf(tile), 1);
      p.melds.push({ type: 'gang', tile, tiles: [tile, tile, tile, tile], from: discarder.seat });
      this.applyGangScore(p, 'minggang', discarder);
      const t = this.wall[this.wallIdx++]; if (t != null) p.hand.push(t);
      this.gangFlowerArmed = seat;
    } else if (act.type === 'chi') {
      const [a, b] = act.tiles;
      p.hand.splice(p.hand.indexOf(a), 1);
      p.hand.splice(p.hand.indexOf(b), 1);
      const tiles = [a, b, tile].sort((x, y) => x - y);
      p.melds.push({ type: 'chi', tile, tiles, from: discarder.seat });
    }
    p.hand.sort((a, b) => a - b);
  }

  applyGangScore(player, kind, discarder) {
    const g = this.variant.gangScore;
    if (!g) return;
    if (kind === 'minggang') {
      if (discarder) { discarder.score -= g.minggang; player.score += g.minggang; this.log(`${player.name} 直杠，点杠者${discarder.name}付${g.minggang}`); }
    } else if (kind === 'angang') {
      for (const o of this.players) if (o.seat !== player.seat && this.isActive(o)) { o.score -= g.angang; player.score += g.angang; }
      this.log(`${player.name} 暗杠，每家付${g.angang}`);
    } else if (kind === 'bugang') {
      for (const o of this.players) if (o.seat !== player.seat && this.isActive(o)) { o.score -= g.bugang; player.score += g.bugang; }
      this.log(`${player.name} 补杠，每家付${g.bugang}`);
    }
  }

  doSelfHu(player, tile) {
    const flower = this.gangFlowerArmed === player.seat;
    const last = this.wall.length === 0;
    // tile 已在此之前加入手牌，故传 null
    const res = this.evaluateWin(player, null, { selfDraw: true, flower, last });
    const score = res.score;
    for (const o of this.players) if (o.seat !== player.seat && this.isActive(o)) { o.score -= score; player.score += score; }
    player.lastWin = { type: 'zimo', ...res };
    this.log(`${player.name} 自摸胡 ${res.names.join(' ')} +${score}`);
  }

  // 一炮多响：对 seats 中每一家分别复核并结算点炮胡；点炮者对每家全额赔付。
  doMultiRon(seats, discarder, tile, rob) {
    const last = this.wall.length === 0; // 循环外算一次，保证各家「海底」番一致
    const settled = [];
    for (const seat of seats) {
      const p = this.bySeat(seat);
      if (!p) continue;
      const res = this.evaluateWin(p, tile, { selfDraw: false, rob: !!rob, last });
      if (!res) { this.log(`[warn] ${p.name} 胡牌复核失败，跳过结算`); continue; } // 防御性复核
      discarder.score -= res.score;
      p.score += res.score;
      p.lastWin = { type: 'ron', from: discarder.seat, rob: !!rob, multi: seats.length > 1, ...res };
      this.log(`${p.name} 胡 ${discarder.name} 的 ${tileName(tile)} ${res.names.join(' ')} +${res.score}`);
      settled.push(seat);
    }
    if (settled.length > 1) this.log(`一炮多响：${settled.length} 家同时胡牌`);
    return settled;
  }

  // 兼容包装：既有 doRon 调用点（含测试）无需修改
  doRon(seat, discarder, tile, rob) { this.doMultiRon([seat], discarder, tile, rob); }

  // ---------- 主循环 ----------
  async run() {
    this.deal();
    if (this.variant.queMen) {
      for (const p of this.players) {
        if (!this.isActive(p)) continue;
        this.broadcast(); // 先广播发牌状态，再索取定缺，保证真人端先拿到手牌
        const act = await this.request(p.seat, { type: 'que', options: ['m', 'p', 's'] });
        p.queMen = act.suit;
        this.broadcast();
      }
      this.log('定缺完成，开局！');
    }
    this.phase = 'playing';
    this.broadcast();

    while (this.phase === 'playing') {
      if (this.mustDiscardSeat != null) {
        const seat = this.mustDiscardSeat; this.mustDiscardSeat = null;
        const p = this.bySeat(seat);
        const acts = this.getDiscardActions(p);
        const act = await this.request(seat, { type: 'discardOnly', actions: acts, hand: p.hand });
        const tile = (act.type === 'discard') ? act.tile : p.hand[0];
        this.doDiscard(p, tile); this.broadcast();
        const claim = await this.resolveClaims(p, tile);
        if (!this.handleClaim(claim, p)) this.advanceTurnFrom(seat);
        if (this.phase !== 'playing') break;
        continue;
      }
      // 摸牌
      if (this.wall.length === 0) { this.endGame('draw'); break; }
      const seat = this.current;
      const p = this.bySeat(seat);
      const tile = this.wall.shift();
      p.hand.push(tile);
      this.lastDrawn = { seat, tile };
      this.broadcast();

      const acts = this.getSelfActions(p);
      const act = await this.request(seat, { type: 'turn', actions: acts, drawn: tile });

      if (act.type === 'hu') {
        this.doSelfHu(p, tile);
        if (!this.continueAfterWin(seat)) break;
        this.current = this.nextActive(seat);
        continue;
      }
      if (act.type === 'angang' || act.type === 'bugang') {
        this.doSelfGang(p, act);
        this.broadcast();
        if (act.type === 'bugang') {
          const ron = await this.checkQiangGang(p, act.tile);
          if (ron) {
            const settled = this.doMultiRon(ron.seats, p, act.tile, true);
            if (settled.length) {
              if (!this.continueAfterMultiWin(settled)) break;
              this.current = this.nextActive(p.seat);
              continue;
            }
          }
        }
        this.mustDiscardSeat = seat;
        continue;
      }
      // 默认出牌（主路径与杠后补出牌路径统一走 handleClaim，逻辑同构不再单边遗漏）
      const discTile = (act.type === 'discard') ? act.tile : p.hand[0];
      this.doDiscard(p, discTile); this.broadcast();
      const claim = await this.resolveClaims(p, discTile);
      if (!this.handleClaim(claim, p)) this.advanceTurnFrom(seat);
      if (this.phase !== 'playing') break;
    }
  }

  // 抢杠：补杠时其他玩家可胡该牌
  async checkQiangGang(player, tile) {
    const reactors = this.players.filter(p => p.seat !== player.seat && this.isActive(p));
    const results = await Promise.all(reactors.map(p => {
      const acts = this.getClaimActions(p, player.seat, tile).filter(a => a.type === 'hu');
      if (acts.length === 0) return Promise.resolve(null);
      return this.request(p.seat, { type: 'claim', tile, actions: acts, from: player.seat })
        .then(a => (a && a.type === 'hu' ? p.seat : null));
    }));
    const n = this.playerCount;
    const dist = (s) => (s - player.seat + n) % n;
    const huSeats = results.filter(s => s != null).sort((a, b) => dist(a) - dist(b));
    if (!huSeats.length) return null;
    return { seats: this.variant.bloodBattle ? huSeats : [huSeats[0]] }; // ★{seat} → {seats}
  }

  async resolveClaims(discarder, tile) {
    const reactors = this.players.filter(p => p.seat !== discarder.seat && this.isActive(p));
    const results = await Promise.all(reactors.map(p => {
      const acts = this.getClaimActions(p, discarder.seat, tile);
      if (acts.length === 0) return Promise.resolve(null);
      return this.request(p.seat, { type: 'claim', tile, actions: acts, from: discarder.seat })
        .then(a => ({ seat: p.seat, a }));
    }));
    const n = this.playerCount;
    const dist = (seat) => (seat - discarder.seat + n) % n; // 下家=1 最小，上家最大

    const huSeats = [];
    let bestGang = null, bestChi = null;
    for (const r of results) {
      if (!r || !r.a || r.a.type === 'pass') continue;
      const a = r.a;
      if (a.type === 'hu') {
        huSeats.push(r.seat); // ★不再只留第一家
      } else if (a.type === 'peng' || a.type === 'gang') {
        if (!bestGang || dist(r.seat) < dist(bestGang.seat)) bestGang = { type: a.type, seat: r.seat, tile };
      } else if (a.type === 'chi') {
        if (!bestChi || dist(r.seat) < dist(bestChi.seat)) bestChi = { type: 'chi', seat: r.seat, tile, tiles: a.tiles };
      }
    }
    if (huSeats.length) {
      huSeats.sort((x, y) => dist(x) - dist(y)); // 下家优先
      const seats = this.variant.bloodBattle ? huSeats : [huSeats[0]];
      return { type: 'hu', seats, tile }; // ★契约变更：seat → seats
    }
    if (bestGang) return bestGang;
    if (bestChi) return bestChi;
    return null;
  }

  handleClaim(claim, discarder) {
    if (!claim) return false;
    if (claim.type === 'hu') {
      const seats = claim.seats || (claim.seat != null ? [claim.seat] : []); // 向后兼容旧契约
      const settled = this.doMultiRon(seats, discarder, claim.tile, false);
      if (settled.length === 0) return false; // 全部复核失败 → 视作无响应，正常轮转
      if (this.continueAfterMultiWin(settled)) this.current = this.nextActive(discarder.seat);
      return true; // 已处理，调用方不要再 advanceTurnFrom
    }
    this.doMeldClaim(claim.seat, discarder, claim);
    if (claim.type === 'gang') { /* 已补摸一张 */ }
    this.mustDiscardSeat = claim.seat;
    return true;
  }

  advanceTurnFrom(seat) {
    this.current = this.nextActive(seat);
  }

  // 仅置 isWinner + push winners，不判终局；幂等
  markWinner(seat) {
    const p = this.bySeat(seat);
    if (!p || p.isWinner) return; // 幂等
    p.isWinner = true;
    this.winners.push({ seat, name: p.name, info: p.lastWin });
  }

  // 返回 false=已 endGame（终局）；true=继续血战
  checkGameEnd() {
    if (!this.variant.bloodBattle) { this.endGame('hu'); return false; }
    if (this.winners.length >= this.playerCount - 1) { this.endGame('hu'); return false; }
    return true;
  }

  // 兼容包装：自摸/抢杠（单赢家）既有调用点零改动，语义与旧实现逐行等价
  continueAfterWin(seat) { this.markWinner(seat); return this.checkGameEnd(); }
  // 批量标记后再判一次终局（解决多胡家时 endGame 提前触发的漏结算问题）
  continueAfterMultiWin(seats) { for (const s of seats) this.markWinner(s); return this.checkGameEnd(); }

  endGame(reason) {
    this.phase = 'ended';
    this.endReason = reason;
    if (this.variant.key === 'sichuan' && this.variant.chaJiao) {
      for (const loser of this.players) {
        if (loser.isWinner) continue;
        if (!this.isTenpai(loser)) {
          for (const w of this.players) if (w.isWinner) { loser.score -= this.variant.chaJiao; w.score += this.variant.chaJiao; }
          this.log(`${loser.name} 查叫（未听牌），赔付每位胡牌者 ${this.variant.chaJiao}`);
        }
      }
    }
    this.log(reason === 'draw' ? '荒庄（流局）' : '本局结束');
    this.broadcast();
  }

  // 供房间构建下发状态
  getState() {
    return {
      variant: this.variant.key,
      variantName: this.variant.name,
      phase: this.phase,
      current: this.current,
      dealer: this.dealer,
      wallCount: this.wall.length,
      jinIndex: this.jinIndex,
      lastDiscard: this.lastDiscard,
      lastDrawn: this.lastDrawn,
      meta: {
        basePoint: this.variant.basePoint,
        useFixedJin: !!this.variant.useFixedJin,
        jinTileId: this.jinIndex,
        jinTileName: this.jinIndex >= 0 ? tileName(this.jinIndex) : null,
        remainingJinCount: this.computeRemainingJin(),
      },
      players: this.players.map(p => ({
        seat: p.seat, name: p.name, isAI: p.isAI, isWinner: p.isWinner,
        score: p.score || 0, handCount: (p.hand || []).length,
        queMen: p.queMen || null,
        melds: p.melds, discards: p.discards,
        lastWin: p.lastWin || null,
      })),
      winners: this.winners,
      endReason: this.endReason,
      messages: this.messages.slice(-30),
    };
  }

  // 剩余金牌数（仅 fixed-jin 玩法）：4 - 已副露到桌面上的金牌张数（弃牌 + 副露）
  computeRemainingJin() {
    if (!this.variant.useFixedJin) return 0;
    const j = this.jinIndex;
    let onTable = 0;
    for (const p of this.players) {
      for (const d of (p.discards || [])) if (d === j) onTable++;
      for (const m of (p.melds || [])) for (const t of (m.tiles || [])) if (t === j) onTable++;
    }
    return Math.max(0, 4 - onTable);
  }
}

module.exports = { Game, shuffle };
