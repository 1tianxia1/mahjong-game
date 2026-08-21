// room.js — 单个房间/牌局管理：真人连接、AI 补位、动作请求与状态广播
const { Game } = require('./engine');
const VARIANTS = require('./variants');
const ai = require('./ai');

class Room {
  constructor(id, config) {
    this.id = id;
    this.config = config;                 // {variant, playerCount, aiFill}
    this.players = [];                    // [{id,name,isAI,seat}]
    this.clients = new Map();             // seat -> ws (仅真人)
    this.wsSeat = new Map();              // ws -> seat
    this.pending = {};                    // seat -> {resolve, timer}
    this.game = null;
    this.started = false;
    this.aiCount = 0;
  }

  humanCount() { return this.players.filter(p => !p.isAI).length; }
  freeSeat() {
    for (let i = 0; i < this.config.playerCount; i++) if (!this.players.find(p => p.seat === i)) return i;
    return -1;
  }

  addHuman(ws, name) {
    const seat = this.freeSeat();
    if (seat < 0) return null;
    const p = { id: 'u_' + seat + '_' + Date.now(), name: name || ('玩家' + (seat + 1)), isAI: false, seat };
    this.players.push(p);
    this.clients.set(seat, ws);
    this.wsSeat.set(ws, seat);
    return p;
  }

  start() {
    if (this.started) return;
    // 用 AI 补满剩余座位（仅在开启 AI 补位时）
    if (this.config.aiFill) {
      for (let i = 0; i < this.config.playerCount; i++) {
        if (!this.players.find(p => p.seat === i)) {
          this.players.push({ id: 'ai' + i, name: '电脑' + (this.aiCount + 1), isAI: true, seat: i });
          this.aiCount++;
        }
      }
      this.players.sort((a, b) => a.seat - b.seat);
    }
    this.started = true;

    const hooks = {
      request: (seat, prompt) => this.request(seat, prompt),
      broadcast: () => this.broadcast(),
      log: () => {},
    };
    this.game = new Game(VARIANTS[this.config.variant], this.players, hooks);
    this.game.run();
  }

  timeoutMs(prompt) {
    if (prompt.type === 'claim') return 12000;
    if (prompt.type === 'que') return 15000;
    return 30000; // turn / discardOnly
  }

  autoResponse(player, prompt) {
    if (prompt.type === 'que') return { type: 'que', suit: ai.aiChooseQue(player) };
    if (prompt.type === 'turn' || prompt.type === 'discardOnly') return { type: 'discard', tile: ai.aiDiscard(player) };
    return { type: 'pass' };
  }

  request(seat, prompt) {
    const player = this.players.find(p => p.seat === seat);
    if (player.isAI) {
      return new Promise(resolve => {
        setTimeout(() => {
          let act;
          try {
            if (prompt.type === 'que') act = { type: 'que', suit: ai.aiChooseQue(player) };
            else if (prompt.type === 'turn') act = ai.decideTurn(player, prompt);
            else if (prompt.type === 'discardOnly') act = { type: 'discard', tile: ai.aiDiscard(player) };
            else if (prompt.type === 'claim') act = ai.decideClaim(player, prompt, prompt.tile);
            else act = { type: 'pass' };
          } catch (e) { act = { type: 'pass' }; }
          resolve(act);
        }, 450 + Math.random() * 500);
      });
    }
    // 真人：发提示并等待其回包
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        delete this.pending[seat];
        this.sendTo(seat, { type: 'timeout' });
        resolve(this.autoResponse(player, prompt));
      }, this.timeoutMs(prompt));
      this.pending[seat] = { resolve, timer };
      this.sendTo(seat, { type: 'action', prompt });
    });
  }

  // 处理真人的动作回包
  submitAction(seat, action) {
    const pend = this.pending[seat];
    if (!pend) return;
    clearTimeout(pend.timer);
    delete this.pending[seat];
    pend.resolve(action);
  }

  sendTo(seat, obj) {
    const ws = this.clients.get(seat);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  broadcast() {
    if (!this.game) return;
    const base = this.game.getState();
    for (const [seat, ws] of this.clients) {
      if (!ws || ws.readyState !== 1) continue;
      const st = JSON.parse(JSON.stringify(base));
      const me = this.players.find(p => p.seat === seat);
      st.players.forEach(pl => { pl.hand = (pl.seat === seat) ? me.hand.slice() : null; });
      st.youSeat = seat;
      ws.send(JSON.stringify({ type: 'state', state: st }));
    }
  }

  onClose(ws) {
    const seat = this.wsSeat.get(ws);
    if (seat == null) return;
    this.clients.delete(seat);
    this.wsSeat.delete(ws);
    // 断线真人转 AI，保证牌局继续
    const p = this.players.find(x => x.seat === seat);
    if (p && !p.isAI && this.game && this.game.phase === 'playing') {
      p.isAI = true;
      p.name = p.name + '(托管)';
      if (this.pending[seat]) {
        const pend = this.pending[seat];
        clearTimeout(pend.timer);
        delete this.pending[seat];
        pend.resolve(this.autoResponse(p, { type: 'turn' }));
      }
    }
  }
}

module.exports = { Room };
