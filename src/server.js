// server.js — HTTP 静态服务 + WebSocket 大厅/房间调度
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');
const VARIANTS = require('./variants');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function genRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.meta = { roomId: null, seat: null };
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    handleMessage(ws, msg);
  });
  ws.on('close', () => {
    const r = ws.meta.roomId && rooms.get(ws.meta.roomId);
    if (r) r.onClose(ws);
  });
});

function handleMessage(ws, msg) {
  if (msg.action === 'create') {
    const variant = VARIANTS[msg.variant] ? msg.variant : 'sichuan';
    const playerCount = (msg.playerCount === 3 || msg.playerCount === 4) ? msg.playerCount : 4;
    const roomId = genRoomId();
    const room = new Room(roomId, { variant, playerCount, aiFill: msg.aiFill !== false });
    rooms.set(roomId, room);
    const p = room.addHuman(ws, msg.name);
    ws.meta = { roomId, seat: p.seat };
    send(ws, { type: 'created', roomId, seat: p.seat, config: room.config, name: p.name });
    broadcastLobby(room);
  } else if (msg.action === 'join') {
    const room = rooms.get(msg.roomId);
    if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }
    if (room.started) { send(ws, { type: 'error', message: '牌局已开始' }); return; }
    const seat = room.freeSeat();
    if (seat < 0) { send(ws, { type: 'error', message: '房间已满' }); return; }
    const p = room.addHuman(ws, msg.name);
    ws.meta = { roomId: msg.roomId, seat: p.seat };
    send(ws, { type: 'joined', roomId: msg.roomId, seat: p.seat, config: room.config, name: p.name });
    broadcastLobby(room);
  } else if (msg.action === 'start') {
    const room = rooms.get(ws.meta.roomId);
    if (!room || room.started) return;
    // 未开 AI 补位时，人不满员不允许开局
    if (!room.config.aiFill && room.humanCount() < room.config.playerCount) {
      send(ws, { type: 'error', message: `还差 ${room.config.playerCount - room.humanCount()} 位玩家才能开始（已关闭AI补位）` });
      return;
    }
    room.start();
  } else if (msg.action === 'action') {
    const room = rooms.get(ws.meta.roomId);
    if (room && ws.meta.seat != null) room.submitAction(ws.meta.seat, msg.move);
  } else if (msg.action === 'lobby') {
    const room = rooms.get(ws.meta.roomId);
    if (room) broadcastLobby(room);
  }
}

function broadcastLobby(room) {
  const info = {
    type: 'lobby',
    roomId: room.id,
    config: room.config,
    players: room.players.map(p => ({ seat: p.seat, name: p.name, isAI: p.isAI })),
    started: room.started,
  };
  for (const [, ws] of room.clients) send(ws, info);
}

server.listen(PORT, () => {
  console.log(`麻将服务器已启动: http://localhost:${PORT}`);
  console.log(`支持模式: ${Object.keys(VARIANTS).map(k => VARIANTS[k].name).join(' / ')}`);
});
