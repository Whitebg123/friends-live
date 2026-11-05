import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { EmojiStore, emojiRoutes } from './emojis.js';

const random = () => randomBytes(24).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const valid = (s, max = 100) => typeof s === 'string' && s.length > 0 && s.length <= max;
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };

export function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.PUBLIC_ORIGIN;
  const grace = options.grace ?? 30000;
  const members = new Map(), limits = new Map();
  const room = { id: random(), ownerId: null, messages: [] };
  let shuttingDown = false;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(self), display-capture=(self)', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true }));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  app.use(express.static(dist));
  app.get('/', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  function allow(key, max, window = 60000) {
    const now = Date.now(); let b = limits.get(key);
    if (!b || now >= b.until) limits.set(key, b = { count: 0, until: now + window });
    return ++b.count <= max;
  }
  server.on('upgrade', (req, socket, head) => {
    const expected = origin || `${production ? 'https' : 'http'}://${req.headers.host}`;
    if (req.url !== '/ws' || req.headers.origin !== expected || !allow(`upgrade:${req.socket.remoteAddress}`, 60)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const publicRoom = () => ({ id: room.id, ownerId: room.ownerId, members: [...members.values()].map(m => ({ id: m.id, connectionId: m.connectionId, name: m.name, online: m.ws?.readyState === WebSocket.OPEN, sharing: m.sharing, systemAudio: m.systemAudio, mic: !!m.mic })) });
  const pairEpoch = (a, b) => a.id < b.id ? `${a.connectionId}:${b.connectionId}` : `${b.connectionId}:${a.connectionId}`;
  const broadcast = data => { for (const m of members.values()) send(m.ws, data); };
  const publish = () => broadcast({ type: 'room', room: publicRoom() });
  const emojiStore = options.emojiStore || new EmojiStore();
  emojiRoutes(app, { express, store:emojiStore, allow, memberForToken:token => [...members.values()].find(m => m.ws?.readyState === WebSocket.OPEN && equal(m.token,token)), changed:() => broadcast({type:'emojis-updated'}) });
  function remove(member) {
    clearTimeout(member.timer);
    if (member.ws) member.ws.member = null;
    members.delete(member.id);
    if (room.ownerId === member.id) room.ownerId = members.keys().next().value || null;
    if (!members.size) { room.id = random(); room.messages = []; }
    publish();
  }
  function attach(ws, member, isNew = false) {
    clearTimeout(member.timer);
    const old = member.ws;
    if (old && old !== ws) { old.member = null; old.close(4001, 'Session resumed elsewhere'); member.sharing = false; member.systemAudio = false; member.mic = false; }
    member.ws = ws; member.connectionId = random(); ws.member = member;
    if (isNew) { members.set(member.id, member); if (!room.ownerId) room.ownerId = member.id; }
    send(ws, { type: 'welcome', selfId: member.id, token: member.token, room: publicRoom(), messages: room.messages, iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }, ...(process.env.TURN_URLS ? [{ urls: process.env.TURN_URLS.split(',').map(s => s.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }] : [])] });
    publish();
  }
  wss.on('connection', (ws, req) => {
    ws.alive = true; ws.rateKey = random(); ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async (raw, binary) => {
      const fail = (code, message, requestId) => send(ws, { type: 'error', code, message, requestId });
      if (!allow(`message:${ws.rateKey}`, 1200)) { ws.close(4008, 'Rate limited'); return; }
      let data;
      try { if (binary) throw Error(); data = JSON.parse(raw); if (!data || typeof data !== 'object' || Array.isArray(data) || !valid(data.type, 30)) throw Error(); }
      catch { fail('FORMAT', '无效的消息格式'); return; }
      const { type, requestId } = data;
      try {
        if (type === 'login' || type === 'resume') {
          if (ws.member) throw Error('ALREADY:已经登录');
          if (!allow(`login:${req.socket.remoteAddress}`, 30)) throw Error('RATE:尝试次数过多，请一分钟后重试');
          if (type === 'resume') {
            const m = [...members.values()].find(m => equal(m.token, data.token));
            if (!m) throw Error('EXPIRED:会话已失效，请输入昵称重新进入');
            attach(ws, m); return;
          }
          if (!valid(data.name, 32) || !data.name.trim() || /[\u0000-\u001f\u007f]/u.test(data.name)) throw Error('NAME:昵称需为 1–32 个可见字符');
          attach(ws, { id: random(), token: random(), name: data.name.trim(), sharing: false, systemAudio: false }, true); return;
        }
        const member = ws.member;
        if (!member) throw Error('AUTH:请先输入昵称进入');
        if (type === 'latency-probe' || type === 'latency-reply') {
          const target = members.get(data.target);
          if (!target || target === member || !valid(requestId,64) || !(type === 'latency-probe' ? target.sharing : member.sharing)) return;
          send(target.ws,{type,from:member.id,requestId}); return;
        }
        if (type === 'leave') { remove(member); send(ws, { type: 'left' }); return; }
        if (type === 'mic') {
          if (typeof data.enabled !== 'boolean' || (data.target != null && data.target !== member.id)) throw Error('FORBIDDEN:只能开关自己的麦克风');
          if (member.mic !== data.enabled) { member.mic = data.enabled; publish(); }
          return;
        }
        if (type === 'start' || type === 'stop') {
          if (data.target != null && data.target !== member.id) throw Error('FORBIDDEN:只能控制自己的投屏');
          member.sharing = type === 'start'; member.systemAudio = member.sharing && data.systemAudio === true;
          publish(); send(ws, { type: 'ack', requestId }); return;
        }
        if (type === 'chat') {
          const isEmoji = typeof data.emojiId === 'string';
          if (!isEmoji && (!valid(data.text, 300) || !data.text.trim())) throw Error('CHAT:消息需为 1–300 字');
          if (!allow(`chat:${member.id}`, 8, 10000)) throw Error('RATE:消息发送太快，请稍后再发');
          let emoji;
          if (isEmoji) { if(!/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(data.emojiId))throw Error('CHAT:无效表情'); const items=await emojiStore.list(); emoji=items.find(x=>x.id===data.emojiId); if(!emoji)throw Error('CHAT:表情不存在'); if(ws.member!==member || member.ws!==ws) return; }
          const message = { id: random(), senderId: member.id, name: member.name, text: isEmoji ? '[表情包]' : data.text.trim(), time: Date.now(), ...(emoji ? {emoji} : {}) };
          room.messages.push(message); room.messages = room.messages.slice(-100);
          broadcast({ type: 'chat', message });
          send(ws, { type: 'ack', requestId }); return;
        }
        if (type === 'signal') {
          const target = members.get(data.target), s = data.signal;
          if (!target || target.id === member.id || target.ws?.readyState !== WebSocket.OPEN || data.epoch !== pairEpoch(member,target) || !s || typeof s !== 'object' || Array.isArray(s)) throw Error('SIGNAL:无效或过期的信令');
          // Each pair has one deterministic offerer; all pairs negotiate independently.
          const offerer = member.id < target.id;
          if (s.kind === 'ready') { if (offerer) throw Error('SIGNAL:无效协商方向'); }
          else if (s.kind === 'offer' || s.kind === 'answer') {
            if ((s.kind === 'offer') !== offerer || !valid(s.sdp, 100000) || !valid(s.negotiation, 64)) throw Error('SIGNAL:无效的会话描述');
          } else if (s.kind === 'ice') {
            const c = s.candidate;
            if (!valid(s.negotiation, 64) || !c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 5000 || (c.sdpMid != null && typeof c.sdpMid !== 'string') || (c.sdpMLineIndex != null && !Number.isInteger(c.sdpMLineIndex))) throw Error('SIGNAL:无效 ICE 候选');
          } else throw Error('SIGNAL:未知信令');
          send(target.ws, { type: 'signal', from: member.id, epoch: pairEpoch(member,target), signal: s }); return;
        }
        throw Error('TYPE:未知操作');
      } catch (err) { const [code, ...rest] = err.message.split(':'); fail(code, rest.join(':') || '请求无效', requestId); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      const m = ws.member;
      if (!m || m.ws !== ws || shuttingDown) return;
      m.ws = null; m.sharing = false; m.systemAudio = false; m.mic = false; publish();
      m.timer = setTimeout(() => remove(m), grace);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [key, entry] of limits) if (Date.now() > entry.until) limits.delete(key);
  }, 15000);
  heartbeat.unref();
  return { app, server, members, room, async close() { shuttingDown = true; clearInterval(heartbeat); for (const m of members.values()) clearTimeout(m.timer); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createApp();
  service.server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Friends Live listening on PORT ' + (process.env.PORT || 3000)));
  for (const name of ['SIGTERM', 'SIGINT']) process.on(name, async () => { await service.close(); process.exit(0); });
}
