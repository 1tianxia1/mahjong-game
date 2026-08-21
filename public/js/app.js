// app.js — 前端逻辑：大厅、联机、牌桌渲染、动作交互
// 本轮改造：R-001 牌面图形化 / R-002 两步出牌+飞出 / R-003 动作按钮增强 / R-005 牌桌信息 / R-006 音效
(function () {
  const $ = (id) => document.getElementById(id);
  let ws = null;
  let state = null;          // 最近一次 state
  let prompt = null;         // 最近一次 action 提示
  let mySeat = null;
  let myRoom = null;
  let selectedVariant = 'ningde';
  let selectedCount = 4;
  let myName = '';

  // 两步出牌选中态（R-002）
  let selectedIdx = null;    // 选中的手牌在 hand 数组中的下标（区分同值重复牌）
  let selectedTile = null;   // 选中的牌索引值（提交用）

  // 音效入口（sound.js 提供的 window.Sfx；静音/未初始化时静默）
  function playSfx(type) { if (window.Sfx) window.Sfx.play(type); }

  // ---------- 大厅交互 ----------
  document.querySelectorAll('#variantSeg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#variantSeg button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); selectedVariant = b.dataset.v;
  });
  document.querySelectorAll('#countSeg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#countSeg button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); selectedCount = parseInt(b.dataset.c, 10);
  });

  $('createBtn').onclick = () => {
    myName = ($('nameInput').value || '').trim() || ('玩家' + Math.floor(Math.random() * 1000));
    send({ action: 'create', variant: selectedVariant, playerCount: selectedCount, name: myName, aiFill: $('aiFill').checked });
  };
  $('joinBtn').onclick = () => {
    const rid = ($('roomInput').value || '').trim().toUpperCase();
    if (!rid) { $('lobbyStatus').textContent = '请输入房间号'; return; }
    myName = ($('nameInput').value || '').trim() || ('玩家' + Math.floor(Math.random() * 1000));
    send({ action: 'join', roomId: rid, name: myName });
  };
  $('startBtn').onclick = () => send({ action: 'start' });
  $('leaveBtn').onclick = () => location.reload();
  $('copyInvite').onclick = () => {
    const url = location.origin + location.pathname + '?room=' + myRoom;
    const showLink = () => { $('waitHint').textContent = '邀请链接：' + url; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showLink, showLink);
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (e) { /* 忽略 */ }
      showLink();
    }
  };

  // 静音开关（R-006）
  const muteBtn = $('muteBtn');
  if (muteBtn) {
    const syncMute = () => { if (window.Sfx) muteBtn.textContent = window.Sfx.isMuted() ? '🔇' : '🔊'; };
    syncMute();
    muteBtn.onclick = () => { if (window.Sfx) { const m = window.Sfx.toggleMuted(); muteBtn.textContent = m ? '🔇' : '🔊'; } };
  }

  // 自动加入 ?room=
  const params = new URLSearchParams(location.search);
  const autoRoom = params.get('room');

  // ---------- WebSocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      if (autoRoom && !myRoom) {
        myName = ($('nameInput').value || '').trim() || ('玩家' + Math.floor(Math.random() * 1000));
        send({ action: 'join', roomId: autoRoom.toUpperCase(), name: myName });
      }
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connect, 1500);
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function handle(m) {
    switch (m.type) {
      case 'created':
      case 'joined':
        myRoom = m.roomId; mySeat = m.seat;
        show('waitroom');
        $('waitRoomId').textContent = m.roomId;
        break;
      case 'error':
        $('lobbyStatus').textContent = m.message;
        $('waitHint').textContent = m.message;
        break;
      case 'lobby':
        renderLobby(m);
        break;
      case 'action':
        prompt = m.prompt;
        clearSelection();                 // prompt 变更时清空选中态（R-002）
        if ($('table').classList.contains('hidden')) showTable();
        renderAction();
        break;
      case 'timeout':
        prompt = null; clearSelection(); renderAction();
        break;
      case 'state': {
        const prev = state;              // 保留上一帧用于事件差分（R-006）
        state = m.state;
        const evs = detectEvents(prev, state);
        if (evs.length) playSfx(evs[0]);
        renderBoard();
        if (state.phase === 'ended') renderResult();
        if ((state.phase === 'playing' || state.phase === 'ended') && $('table').classList.contains('hidden')) showTable();
        break;
      }
    }
  }

  function renderLobby(m) {
    const list = $('playerList');
    list.innerHTML = '';
    (m.players || []).forEach(p => {
      const div = document.createElement('div');
      div.className = 'pl';
      div.innerHTML = `<span>${p.name}${p.seat === mySeat ? '（你）' : ''}</span>` +
        (p.isAI ? '<span class="badge ai">AI</span>' : '<span class="badge human">真人</span>');
      list.appendChild(div);
    });
    $('waitInfo').textContent = `模式：${VARIANT_NAME(m.config.variant)} ｜ ${m.config.playerCount}人 ｜ ${m.started ? '进行中' : '等待开始'}`;
    if (m.started) { show('table'); $('variantLabel').textContent = VARIANT_NAME(m.config.variant); $('roomLabel').textContent = '房间 ' + myRoom; $('seatLabel').textContent = '座位 ' + (mySeat + 1); }
  }

  function VARIANT_NAME(k) { return { ningde: '宁德麻将', fuzhou: '福州麻将', sichuan: '川麻(血战)' }[k] || k; }

  function showTable() {
    show('table');
    $('variantLabel').textContent = VARIANT_NAME((state && state.variant) || selectedVariant);
    $('roomLabel').textContent = '房间 ' + myRoom;
    $('seatLabel').textContent = '座位 ' + (mySeat + 1);
  }

  // ---------- 牌面渲染（唯一牌面出口，R-001） ----------
  function tileFaceHTML(i) {
    const suit = Math.floor(i / 9);
    if (suit === 3) {
      const idx = i - 27;
      const ch = ['东', '南', '西', '北', '中', '发', '白'][idx];
      const hc = ['h-dong', 'h-nan', 'h-xi', 'h-bei', 'h-zhong', 'h-fa', 'h-bai'][idx];
      return `<span class="honor ${hc}">${ch}</span>`;
    }
    if (suit === 0) {
      return `<span class="rank">${'一二三四五六七八九'[i % 9]}</span><span class="wan">萬</span>`;
    }
    // 筒 / 条：CSS 点阵（筒=圆点 / 条=竖竹条）
    const suitCls = suit === 1 ? 'p' : 's';
    return `<span class="pips n${(i % 9) + 1}">${pipsHTML((i % 9) + 1, suitCls)}</span>`;
  }
  function pipsHTML(n, suitCls) {
    let s = '';
    for (let k = 0; k < n; k++) s += `<i class="pip ${suitCls}"></i>`;
    return s;
  }
  function tileHTML(i, extraCls, attrs) {
    const suit = Math.floor(i / 9);
    const suitCls = ['m', 'p', 's', 'z'][suit];
    const jin = state && state.jinIndex === i ? ' jin' : '';
    const extra = extraCls ? ' ' + extraCls : '';
    const at = attrs ? ' ' + attrs : '';
    return `<div class="tile ${suitCls}${jin}${extra}"${at}>${tileFaceHTML(i)}${jin ? '<b class="jin-mark">金</b>' : ''}</div>`;
  }
  function tilesHTML(arr, sizeCls, withIdx) {
    return (arr || []).map((i, idx) => {
      const at = withIdx ? `data-idx="${idx}" data-tile="${i}"` : '';
      return tileHTML(i, sizeCls, at);
    }).join('');
  }

  function renderBoard() {
    if (!state) return;
    const board = $('board');
    // 注意：不执行 board.innerHTML = '' —— 四个 .seat[data-corner] 与 .center-disc
    // 是 index.html 的静态结构，只覆写它们各自的 innerHTML；清空会销毁座位导致全空。
    const n = state.players.length;

    // 按 youSeat 旋转视角：当前玩家始终在 SE（自家底部）；其余三家用 NW/NE/SW
    // 顺序 [自家=SE, 对家=NW, 右家=NE, 左家=SW] 对应 offset 0/1/2/3
    const cornerByOffset = ['SE', 'NW', 'NE', 'SW'];
    const legacyPosByOffset = ['bottom', 'top', 'right', 'left'];
    const seatMeta = {}; // seatMeta[seat] = {corner, legacyPos}
    for (let seat = 0; seat < n; seat++) {
      const offset = ((seat - state.youSeat) % n + n) % n;
      seatMeta[seat] = { corner: cornerByOffset[offset], legacyPos: legacyPosByOffset[offset] };
    }

    state.players.forEach(pl => {
      const m = seatMeta[pl.seat] || { corner: 'SE', legacyPos: 'bottom' };
      const seatDiv = document.querySelector(`.seat[data-corner="${m.corner}"]`);
      if (!seatDiv) return;
      // 兼容 v1 的选择器（.seat.bottom / .seat.right / .seat.top / .seat.left），供 selectTile / confirmDiscard / enableHandDiscard 沿用
      seatDiv.className = 'seat ' + m.legacyPos;
      seatDiv.setAttribute('data-corner', m.corner);

      if (state.phase === 'playing' && pl.seat === state.current) seatDiv.classList.add('active');
      if (pl.isWinner) seatDiv.classList.add('winner');

      const sc = pl.score || 0;
      const scCls = sc > 0 ? 'pos' : (sc < 0 ? 'neg' : 'zero');
      let html = `<div class="name">`;
      html += `<span class="avatar s${pl.seat % 6}">${avatarText(pl.name)}</span>`;
      html += `<span>${pl.name}`;
      if (pl.seat === state.dealer) html += ' <span class="badge dealer">庄</span>';
      if (pl.isAI) html += ' <span class="badge">AI</span>';
      if (pl.isWinner) html += ' <span class="badge win">胡</span>';
      if (pl.queMen) html += ` <span class="que">缺${PLAIN(pl.queMen)}</span>`;
      html += ` <span class="score ${scCls}">${sc > 0 ? '+' : ''}${sc}</span>`;
      html += `</span></div>`;

      // 副露（small）
      html += `<div class="melds">${(pl.melds || []).map(m => tilesHTML(m.tiles, 'small')).join('')}</div>`;
      if (pl.hand) {
        // 自己的手牌：带 data-idx / data-tile 供两步出牌
        html += `<div class="myhand hand" data-seat="${pl.seat}">${tilesHTML(pl.hand, '', true)}</div>`;
      } else {
        html += `<div class="hand-count">手牌 ${pl.handCount}</div>`;
        html += `<div class="melds">${backTiles(pl.handCount)}</div>`;
      }
      // 弃牌区（mini）
      html += `<div class="discards">${tilesHTML(pl.discards || [], 'mini')}</div>`;
      seatDiv.innerHTML = html;

      // 最后一张弃牌高亮（防御性判定）
      if (state.lastDiscard && pl.seat === state.lastDiscard.seat) {
        const last = (pl.discards || []).slice(-1)[0];
        if (last === state.lastDiscard.tile) {
          const discDiv = seatDiv.querySelector('.discards');
          if (discDiv && discDiv.lastElementChild) discDiv.lastElementChild.classList.add('last-discard');
        }
      }
      // 选中态幂等重放（两步出牌选中态重渲染后由 selectedIdx 恢复）
      if (pl.hand && pl.seat === state.youSeat && selectedIdx != null && pl.hand[selectedIdx] != null) {
        const mh = seatDiv.querySelector('.myhand');
        if (mh && mh.children[selectedIdx]) mh.children[selectedIdx].classList.add('sel');
      }
    });

    // 中央信息盘：剩余牌 + 轮到 + 金牌（meta 驱动宁德「白板 × N」/ 福州「金牌 XXX」）
    renderCenterDisc();

    // 四边牌墙：仅开局首次进入 playing 时填充一次
    renderWall();

    const log = $('log');
    log.innerHTML = (state.messages || []).map(x => `<div>${x}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  function renderCenterDisc() {
    const disc = $('centerDisc');
    if (!disc) return;
    const cur = state.players.find(p => p.seat === state.current);
    let html = `<span class="wall-count">${state.wallCount}</span><span>剩余牌</span>`;
    if (state.phase === 'playing') {
      html += `<div class="chip">轮到 <b>${cur ? cur.name : '—'}</b></div>`;
    } else if (state.phase === 'ended') {
      html += `<div class="chip hu-chip">本局结束</div>`;
    } else {
      html += `<div class="chip">准备中</div>`;
    }
    // 底分（来自 meta.basePoint）
    if (state.meta && state.meta.basePoint) {
      html += `<div class="chip base-chip">底分 ${state.meta.basePoint}</div>`;
    }
    // 金牌信息：宁德 fixed-jin 走「白板 × N」；否则走 v1「金牌 XXX」
    if (state.meta && state.meta.useFixedJin) {
      html += `<div class="chip jin-chip">白板 × ${state.meta.remainingJinCount}</div>`;
    } else if (state.jinIndex >= 0) {
      html += `<div class="chip jin-chip">金牌 ${JINNAME(state.jinIndex)}</div>`;
    }
    if (state.variant === 'sichuan' && state.winners && state.winners.length) {
      html += `<div class="chip">已胡 ${state.winners.length} 家</div>`;
    }
    disc.innerHTML = html;
  }

  function renderWall() {
    // 仅在 phase='playing' 且牌墙 DOM 尚未填充时填充；后续帧直接跳过，避免每帧重建
    if (state.phase !== 'playing') return;
    const counts = { top: 18, bottom: 18, left: 7, right: 7 };
    let anyEmpty = false;
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const el = document.querySelector(`.wall[data-side="${side}"]`);
      if (!el) continue;
      if (el.children.length === 0) {
        anyEmpty = true;
        const N = counts[side];
        const frag = document.createDocumentFragment();
        for (let i = 0; i < N; i++) {
          const t = document.createElement('div');
          t.className = 'wall-tile';
          frag.appendChild(t);
        }
        el.appendChild(frag);
      }
    }
    if (anyEmpty) {
      const felt = document.querySelector('.table-felt');
      if (felt) Fx.pingIfFirstFrame(felt, 'wall-fadein');
    }
  }

  function avatarText(name) {
    if (!name || !name.trim()) return '?';
    const s = name.trim();
    const ch = s.charAt(0);
    // 中文（含繁体、日文汉字）保留原字符；其他按大写
    const code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) return ch;
    return ch.toUpperCase();
  }

  function PLAIN(s) { return { m: '万', p: '筒', s: '条' }[s] || s; }
  function JINNAME(i) { const suit = Math.floor(i / 9); return suit === 3 ? ['东', '南', '西', '北', '中', '发', '白'][i - 27] : (i % 9 + 1) + ['万', '筒', '条'][suit]; }
  function backTiles(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="tile back small"></div>'; return s; }

  // ---------- 两步出牌（R-002） ----------
  function selectTile(idx, tile) {
    selectedIdx = idx; selectedTile = tile;
    document.querySelectorAll('.myhand .tile.sel').forEach(t => t.classList.remove('sel'));
    const mh = document.querySelector('.seat.bottom .myhand');
    if (mh && mh.children[idx]) mh.children[idx].classList.add('sel');
    renderAction(); // 追加「出牌」确认按钮
  }
  function clearSelection() {
    selectedIdx = null; selectedTile = null;
    document.querySelectorAll('.myhand .tile.sel').forEach(t => t.classList.remove('sel'));
  }
  function confirmDiscard() {
    if (selectedIdx == null || selectedTile == null) return;
    const tile = selectedTile;
    const mh = document.querySelector('.seat.bottom .myhand');
    const el = mh ? mh.children[selectedIdx] : null;
    // 先发 WS（不等待动画，避免占用回合倒计时）
    if (prompt && (prompt.type === 'turn' || prompt.type === 'discardOnly')) {
      sendAction({ type: 'discard', tile });
    }
    // 再播飞出动画（独立 #fxLayer 图层，不被后续重渲染打断）
    if (el) {
      const rect = $('board').getBoundingClientRect();
      Fx.flyTile(el, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    clearSelection();
  }

  // 手牌点击：第一次选中，再次点同一张确认；点空白取消（R-002）
  $('board').addEventListener('click', (e) => {
    const t = e.target.closest('.tile.discardable');
    if (!t) {
      if (selectedIdx != null) { clearSelection(); renderAction(); }
      return;
    }
    const idx = parseInt(t.dataset.idx, 10);
    const tile = parseInt(t.dataset.tile, 10);
    if (idx === selectedIdx) confirmDiscard();
    else selectTile(idx, tile);
  });

  // ---------- 动作面板（R-003 按钮增强 + 图标） ----------
  const ACT_ICON = { hu: '🎉', peng: '👐', gang: '💥', chi: '⬆️', pass: '⏭️', que: '🚫', discard: '✅' };
  function renderAction() {
    const bar = $('actionbar');
    bar.innerHTML = '';
    if (!prompt) { bar.innerHTML = `<span class="hint-text">等待其他玩家操作…</span>`; return; }
    const p = prompt;
    if (p.type === 'que') {
      bar.innerHTML = `<span class="hint-text">请选择定缺花色：</span>`;
      ['m', 'p', 's'].forEach(s => bar.appendChild(mkBtn('que', '缺' + PLAIN(s), () => sendAction({ type: 'que', suit: s }), ACT_ICON.que)));
      return;
    }
    if (!state) { bar.innerHTML = `<span class="hint-text">等待其他玩家操作…</span>`; return; }
    if (p.type === 'turn' || p.type === 'discardOnly') {
      bar.innerHTML = `<span class="hint-text">${selectedIdx != null ? '再次点击该牌或点「出牌」确认' : '请出牌（点手牌）'}</span>`;
      enableHandDiscard(true);
      p.actions.forEach(a => {
        if (a.type === 'hu') bar.appendChild(mkBtn('hu', '胡', () => sendAction({ type: 'hu' }), ACT_ICON.hu));
        else if (a.type === 'angang') bar.appendChild(mkBtn('gang', '暗杠', () => sendAction({ type: 'angang', tile: a.tile }), ACT_ICON.gang));
        else if (a.type === 'bugang') bar.appendChild(mkBtn('gang', '补杠', () => sendAction({ type: 'bugang', tile: a.tile }), ACT_ICON.gang));
      });
      if (selectedIdx != null) bar.appendChild(mkBtn('sub', '出牌', confirmDiscard, ACT_ICON.discard));
      return;
    }
    if (p.type === 'claim') {
      bar.innerHTML = `<span class="hint-text">可响应：</span>`;
      let has = false;
      p.actions.forEach(a => {
        if (a.type === 'hu') { bar.appendChild(mkBtn('hu', '胡', () => sendAction({ type: 'hu' }), ACT_ICON.hu)); has = true; }
        else if (a.type === 'peng') { bar.appendChild(mkBtn('peng', '碰', () => sendAction({ type: 'peng', tile: p.tile }), ACT_ICON.peng)); has = true; }
        else if (a.type === 'gang') { bar.appendChild(mkBtn('gang', '杠', () => sendAction({ type: 'gang', tile: p.tile }), ACT_ICON.gang)); has = true; }
        else if (a.type === 'chi') {
          a.options.forEach(opt => {
            const label = '吃 ' + opt.map(JINNAME).join('');
            bar.appendChild(mkBtn('chi', label, () => sendAction({ type: 'chi', tile: p.tile, tiles: opt }), ACT_ICON.chi));
          });
          has = true;
        }
      });
      bar.appendChild(mkBtn('pass', '过', () => sendAction({ type: 'pass' }), ACT_ICON.pass));
      if (!has) sendAction({ type: 'pass' });
      return;
    }
  }
  function enableHandDiscard(on) {
    document.querySelectorAll('#board .myhand[data-seat="' + state.youSeat + '"] .tile').forEach(t => {
      if (on) t.classList.add('discardable'); else t.classList.remove('discardable');
    });
  }
  function mkBtn(cls, label, fn, icon) {
    const b = document.createElement('button');
    b.className = 'btn-act ' + cls;
    if (icon) b.innerHTML = `<span class="ico">${icon}</span><span class="lbl">${label}</span>`;
    else b.textContent = label;
    b.onclick = fn;
    return b;
  }
  function sendAction(action) {
    send({ action: 'action', move: action });
    prompt = null;
    clearSelection();
    $('actionbar').innerHTML = `<span class="hint-text">已提交，等待其他玩家…</span>`;
    document.querySelectorAll('.tile.discardable').forEach(t => t.classList.remove('discardable'));
  }

  // ---------- 动效触发层（JS 只加删 class + 克隆替身，R-002） ----------
  const Fx = {
    // 把 fromEl 克隆到 #fxLayer 飞向 toPoint，动画期间不受 renderBoard 重渲染影响
    flyTile(fromEl, toPoint, duration = 300) {
      const layer = $('fxLayer');
      if (!layer || !fromEl) return;
      const r = fromEl.getBoundingClientRect();
      const clone = fromEl.cloneNode(true);
      clone.className = (fromEl.className.replace(/\b(sel|discardable)\b/g, '').trim()) + ' fx-tile';
      clone.style.left = r.left + 'px';
      clone.style.top = r.top + 'px';
      clone.style.width = r.width + 'px';
      clone.style.height = r.height + 'px';
      clone.style.margin = '0';
      layer.appendChild(clone);
      void clone.offsetWidth; // 强制 reflow，使 transition 生效
      const dx = toPoint.x - (r.left + r.width / 2);
      const dy = toPoint.y - (r.top + r.height / 2);
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(.6)`;
      clone.style.opacity = '0';
      setTimeout(() => { if (clone.parentNode) clone.parentNode.removeChild(clone); }, duration + 60);
    },
    ping(el, cls, ms) { if (!el) return; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); },
    // 一次性的 ping（按 key 幂等：同一元素同一 class 全生命周期只触发一次）
    _pinged: new Set(),
    pingIfFirstFrame(el, cls) {
      if (!el) return;
      const key = el.id || ('x' + el.offsetLeft + 'y' + el.offsetTop + '-' + el.className + '-' + cls);
      if (this._pinged.has(key)) return;
      this._pinged.add(key);
      this.ping(el, cls, 600);
    }
  };

  // ---------- 事件差分（纯函数，推导音效；R-006） ----------
  function detectEvents(prev, next) {
    if (!next) return [];
    const events = [];
    if (next.phase === 'playing' && (!prev || prev.phase !== 'playing')) events.push('deal');
    if (next.phase === 'ended' && next.endReason === 'draw') events.push('liuju');
    if (next.winners && prev && prev.winners && next.winners.length > prev.winners.length) events.push('hu');
    const meldInc = next.players.some((p, i) => {
      const pp = prev && prev.players[i];
      return pp && p.melds && pp.melds && p.melds.length > pp.melds.length;
    });
    if (meldInc) events.push('meld');
    if (next.lastDiscard && (!prev || !prev.lastDiscard || next.lastDiscard.tile !== prev.lastDiscard.tile || next.lastDiscard.seat !== prev.lastDiscard.seat)) events.push('discard');
    // 优先级去重：hu > liuju > meld > discard > deal，仅保留最高一项
    const prio = ['hu', 'liuju', 'meld', 'discard', 'deal'];
    for (const e of prio) if (events.indexOf(e) >= 0) return [e];
    return [];
  }

  // ---------- 结算 ----------
  function renderResult() {
    const mask = $('resultMask');
    let rows = '';
    state.players.forEach(p => {
      const win = p.lastWin ? `胡(${(p.lastWin.names || []).join(' ')})` : '—';
      rows += `<div class="result-row"><span>${p.name}</span><span class="${p.score >= 0 ? 'win' : ''}">${win} ｜ ${p.score >= 0 ? '+' : ''}${p.score}</span></div>`;
    });
    const reason = state.endReason === 'draw' ? '荒庄（流局）' : '胡牌结算';
    mask.innerHTML = `<div class="card"><h2>${reason}</h2>${rows}<button onclick="location.reload()">再来一局</button></div>`;
    mask.classList.remove('hidden');
  }

  // ---------- 工具 ----------
  function show(id) {
    ['lobby', 'waitroom', 'table'].forEach(s => $(s).classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  connect();
})();
