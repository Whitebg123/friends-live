import { Peer } from './peer.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { OutgoingAudio } from './audio.js';
export class Live {
  constructor(update) {
    this.update = update; this.state = { room: null, status: '正在连接', messages: [], remotePeers: {}, stats: {} };
    this.preferences = loadPreferences(); this.bitrate = this.preferences.bitrate; this.fps = this.preferences.fps;
    this.audio = new OutgoingAudio(this.preferences.sendVolume);
    this.peers = new Map(); this.pending = new Map(); this.retry = 0; this.emit({ preferences: this.preferences, fps: this.fps }); this.open();
    this.statsTimer = setInterval(() => this.stats().catch(() => {}), 1500);
  }
  emit(patch) { Object.assign(this.state, patch); this.update({ ...this.state }); }
  send(data) { if (this.ws?.readyState !== WebSocket.OPEN) throw Error('连接尚未就绪'); this.ws.send(JSON.stringify(data)); }
  request(data) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(Error('请求超时')); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.send({ ...data, requestId }); } catch (e) { clearTimeout(timer); this.pending.delete(requestId); reject(e); }
    });
  }
  open() {
    if (this.closed) return;
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    ws.onopen = () => { this.retry = 0; this.emit({ status: '已连接', connected: true }); const token = sessionStorage.getItem('friends-session'); if (token) this.send({ type: 'resume', token }); };
    ws.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === 'welcome') {
        sessionStorage.setItem('friends-session', d.token); this.selfId = d.selfId; this.iceServers = d.iceServers; this.epoch = null;
        this.emit({ selfId: d.selfId, messages: d.messages, error: '' }); this.setRoom(d.room);
        this.loadEmojis().catch(e => this.emit({ emojiError:e.message }));
        if (this.display) this.request({ type: 'start', systemAudio: this.display.getAudioTracks().length > 0 }).catch(e => this.emit({ error: e.message }));
      } else if (d.type === 'room') this.setRoom(d.room);
      else if (d.type === 'emojis-updated') this.loadEmojis().catch(e=>this.emit({emojiError:e.message}));
      else if (d.type === 'signal' && d.epoch === this.epoch) { const p = this.connection(d.from); p.queue = (p.queue || Promise.resolve()).then(() => p.signal(d)).catch(e => { if (!p.disposed) this.emit({ error: `媒体连接失败：${e.message}` }); }); }
      else if (d.type === 'chat') this.emit({ messages: [...this.state.messages, d.message].slice(-100), latestChat: d.message });
      else if (d.type === 'ack' || d.type === 'error') {
        const p = this.pending.get(d.requestId);
        if (p) { clearTimeout(p.timer); this.pending.delete(d.requestId); d.type === 'ack' ? p.resolve() : p.reject(Error(d.message)); }
        if (d.type === 'error') {
          if (d.code === 'EXPIRED') { sessionStorage.removeItem('friends-session'); this.cleanup(); this.emit({ room: null }); }
          this.emit({ error: d.message });
        }
      } else if (d.type === 'left') this.emit({ room: null });
    };
    ws.onclose = e => {
      if (this.closed || ws !== this.ws) return;
      this.closePeer(); this.emit({ connected: false, status: '正在重连' });
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('连接已断开')); } this.pending.clear();
      if (e.code === 4001) { this.closed = true; this.cleanup(); this.emit({ room: null, error: '此会话已在其他页面恢复，请刷新' }); return; }
      this.reconnectTimer = setTimeout(() => this.open(), Math.min(1000 * 2 ** this.retry++, 10000));
    };
    ws.onerror = () => this.emit({ status: '等待服务器启动' });
  }
  login(name) { localStorage.setItem('friends-name', name); this.send({ type: 'login', name }); }
  async emojiApi(options) { const r=await fetch('/api/emojis',{...options,headers:{Authorization:`Bearer ${sessionStorage.getItem('friends-session')}`,...options?.headers},signal:AbortSignal.timeout(30000)}); const data=await r.json(); if(!r.ok)throw Error(data.error||'表情库请求失败'); return data; }
  async loadEmojis() { const data=await this.emojiApi(); this.emit({emojis:data.items,emojiConfigured:data.configured,emojiError:''}); }
  async uploadEmoji(file) {
    if(!file || !['image/png','image/jpeg','image/gif','image/webp'].includes(file.type) || file.size>2*1024*1024)throw Error('请选择 2 MB 以内的 PNG、JPG、GIF 或 WebP 表情');
    const bitmap=await createImageBitmap(file); const valid=bitmap.width<=4096 && bitmap.height<=4096; bitmap.close(); if(!valid)throw Error('表情尺寸不能超过 4096×4096');
    await this.emojiApi({method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}); await this.loadEmojis();
  }
  setRoom(room) {
    const changed = room.epoch !== this.epoch; this.emit({ room });
    if (changed) { this.epoch = room.epoch; this.closePeer();
      for (const member of room.members) if (member.id !== this.selfId && member.online) {
        const p = this.connection(member.id); if (this.selfId > member.id) p.relay({ kind: 'ready' });
      }
    }
  }
  connection(id) { if (!this.peers.has(id)) this.peers.set(id, new Peer(this, id)); return this.peers.get(id); }
  closePeer() { for (const p of this.peers.values()) p.dispose(); this.peers.clear(); this.emit({ remotePeers: {} }); }
  async signal(data) { if (data.epoch !== this.epoch || !this.state.room?.members.some(m => m.id === data.from && m.online)) return; await this.connection(data.from).signal(data); }
  async syncTracks() { await Promise.all([...this.peers.values()].map(p => p.syncTracks())); }
  preference(patch) { const next = { ...this.preferences, ...patch }; try { savePreferences(next); } catch { throw Error('浏览器无法保存设置，请检查存储权限或清理网站存储空间'); } this.preferences = next; this.emit({ preferences: next }); }
  async setBitrate(value) { this.bitrate = Number(value); this.preference({ bitrate: this.bitrate }); await Promise.all([...this.peers.values()].map(p => p.setBitrate(value))); }
  async setFrameRate(value) {
    const next = value === 'unlimited' ? null : Number(value), track = this.display?.getVideoTracks()[0];
    if (track) { const constraints = track.getConstraints(); if (next === null) delete constraints.frameRate; else constraints.frameRate = { ideal: next, max: next }; await track.applyConstraints(constraints); }
    this.preference({ fps: next }); this.fps = next; this.emit({ fps: next }); await Promise.all([...this.peers.values()].map(p => p.setBitrate(this.bitrate)));
  }
  setVolume(direction, value) { const level = Math.max(0, Math.min(1, Number(value))); this.preference({ [direction === 'send' ? 'sendVolume' : 'receiveVolume']: level }); if (direction === 'send') this.audio.setVolume(level); }
  async retryMedia() { await Promise.all([...this.peers.values()].map(p => this.selfId < p.id ? p.offer() : Promise.resolve(p.relay({ kind: 'ready' })))); }
  async stats() { await Promise.all([...this.peers.values()].map(p => p.stats())); }
  async share() {
    if (this.display || this.capturing) return;
    this.capturing = true;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开');
      this.audio.ensure();
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(this.fps === null ? {} : { frameRate: { ideal: this.fps, max: this.fps } }) };
      let stream;
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include' }); }
      catch (e) { if (!['NotReadableError', 'OverconstrainedError'].includes(e.name)) throw e; stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false }); }
      if (!this.state.room || !this.state.connected) { stream.getTracks().forEach(t => t.stop()); throw Error('请连接后再投屏'); }
      this.displayApproved = false; this.display = stream; stream.getVideoTracks()[0].contentHint = 'motion'; stream.getVideoTracks()[0].onended = () => this.stop().catch(e => this.emit({ error: e.message }));
      this.emit({ localVideo: new MediaStream(stream.getVideoTracks()), systemAudio: stream.getAudioTracks().length > 0 });
      await this.request({ type: 'start', systemAudio: stream.getAudioTracks().length > 0 }); this.displayApproved = true; await this.syncTracks();
      if (!stream.getAudioTracks().length) this.emit({ notice: '未捕获系统音频。请检查浏览器分享对话框中的音频选项。' });
    } catch (e) { this.stopLocal(); await this.syncTracks().catch(() => {}); if (this.state.connected) this.send({ type: 'stop' }); throw e; }
    finally { this.capturing = false; }
  }
  stopLocal() { this.displayApproved = false; this.display?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.display = null; this.audio.remove('system'); this.emit({ localVideo: null, systemAudio: false }); }
  async stop() { this.stopLocal(); await this.syncTracks(); if (this.state.connected) await this.request({ type: 'stop' }); }
  async microphone() {
    if (this.micBusy) return; this.micBusy = true;
    this.audio.ensure();
    try {
      if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; this.audio.remove('mic'); }
      else this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: true }, video: false });
      this.emit({ mic: !!this.micStream }); await this.syncTracks();
    } finally { this.micBusy = false; }
  }
  cleanup() { this.stopLocal(); this.micStream?.getTracks().forEach(t => t.stop()); this.micStream = null; this.audio.clear(); this.closePeer(); this.emit({ mic: false }); }
  leave() { if (this.state.connected) this.send({ type: 'leave' }); sessionStorage.removeItem('friends-session'); this.cleanup(); this.epoch = null; this.emit({ room: null, messages: [], latestChat: null }); }
  destroy() { this.closed = true; clearInterval(this.statsTimer); clearTimeout(this.reconnectTimer); this.cleanup(); this.audio.close(); this.ws?.close(); }
}
