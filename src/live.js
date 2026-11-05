import { Peer } from './peer.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { videoQuality, captureConstraints } from './video-quality.js';
export class Live {
  constructor(update) {
    this.update = update; this.state = { room: null, status: '正在连接', messages: [], remotePeers: {}, stats: {} };
    this.preferences = loadPreferences();
    this.peers = new Map(); this.pending = new Map(); this.latencyPending = new Map(); this.retry = 0; this.emit({ preferences: this.preferences, latency:{} }); this.open();
    this.statsTimer = setInterval(() => this.stats().catch(() => {}), 1500);
    this.pingTimer = setInterval(() => this.measureLatency(), 4000);
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
        sessionStorage.setItem('friends-session', d.token); this.selfId = d.selfId; this.iceServers = d.iceServers;
        this.emit({ selfId: d.selfId, messages: d.messages, error: '' }); this.setRoom(d.room);
        this.measureLatency();
        this.loadEmojis().catch(e => this.emit({ emojiError:e.message }));
        if (this.display) this.request({ type: 'start', systemAudio: !!this.systemTrack() }).catch(e => this.emit({ error: e.message }));
        if (this.micStream) this.send({ type: 'mic', enabled: true });
      } else if (d.type === 'room') this.setRoom(d.room);
      else if (d.type === 'latency-probe') this.send({type:'latency-reply',target:d.from,requestId:d.requestId});
      else if (d.type === 'latency-reply') {
        const probe=this.latencyPending.get(d.from);
        if (probe?.id===d.requestId) { this.latencyPending.delete(d.from); this.emit({latency:{...this.state.latency,[d.from]:(performance.now()-probe.start)/2}}); }
      }
      else if (d.type === 'emojis-updated') this.loadEmojis().catch(e=>this.emit({emojiError:e.message}));
      else if (d.type === 'signal') { const p = this.peers.get(d.from); if(p?.epoch===d.epoch) p.queue = (p.queue || Promise.resolve()).then(() => p.signal(d)).catch(e => { if (!p.disposed) this.emit({ error: `媒体连接失败：${e.message}` }); }); }
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
      this.closePeer(); this.latencyPending.clear(); this.emit({ connected: false, status: '正在重连', latency:{} });
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
    const self = room.members.find(m=>m.id===this.selfId), desired = new Map();
    for (const member of room.members) if (self && member.id !== self.id && member.online) {
      desired.set(member.id, self.id < member.id ? `${self.connectionId}:${member.connectionId}` : `${member.connectionId}:${self.connectionId}`);
    }
    const remotePeers={...this.state.remotePeers}, latency={...this.state.latency};
    for (const [id,p] of this.peers) if (desired.get(id)!==p.epoch) { p.dispose(); this.peers.delete(id); delete remotePeers[id]; delete latency[id]; this.latencyPending.delete(id); }
    for (const member of room.members) if (!member.sharing || !member.online) { delete latency[member.id]; this.latencyPending.delete(member.id); }
    this.emit({ room,remotePeers,latency });
    for (const [id,epoch] of desired) if (!this.peers.has(id)) { const p=new Peer(this,id,epoch); this.peers.set(id,p); if(this.selfId>id)p.relay({kind:'ready'}); }
  }
  closePeer() { for (const p of this.peers.values()) p.dispose(); this.peers.clear(); this.emit({ remotePeers: {} }); }
  async syncTracks() { await Promise.all([...this.peers.values()].map(p => p.syncTracks())); }
  preference(patch) { const next = { ...this.preferences, ...patch }; try { savePreferences(next); } catch { throw Error('浏览器无法保存设置，请检查存储权限或清理网站存储空间'); } this.preferences = next; this.emit({ preferences: next }); }
  get quality() { return videoQuality[this.preferences.quality]; }
  async setQuality(quality) {
    if (!Object.hasOwn(videoQuality, quality)) return;
    this.preference({ quality });
    const track = this.display?.getVideoTracks()[0];
    if (track) await track.applyConstraints(captureConstraints(this.quality)).catch(() => {});
    await Promise.all([...this.peers.values()].map(p => p.setVideoQuality()));
  }
  setVolume(channel, value, memberId) {
    const level = Math.max(0, Math.min(1, Number(value)));
    if (memberId) {
      const previous = this.preferences.peerVolumes;
      this.preference({ peerVolumes: Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== memberId), [memberId, { mic: 1, system: 1, ...previous[memberId], [channel]: level }]].slice(-64)) });
    } else if (channel === 'receive') this.preference({ receiveVolume: level });
  }
  async retryMedia() { await Promise.all([...this.peers.values()].map(p => this.selfId < p.id ? p.offer() : Promise.resolve(p.relay({ kind: 'ready' })))); }
  async stats() { await Promise.all([...this.peers.values()].map(p => p.stats())); }
  measureLatency() {
    if (!this.state.room || this.ws?.readyState !== WebSocket.OPEN) return;
    const latency={...this.state.latency}; let expired=false;
    for (const member of this.state.room.members) if (member.id!==this.selfId && member.online && member.sharing) {
      const previous=this.latencyPending.get(member.id), start=performance.now();
      if (previous && start-previous.start<8000) continue;
      if (previous) { delete latency[member.id]; expired=true; }
      const id=crypto.randomUUID(); this.latencyPending.set(member.id,{id,start});
      this.send({type:'latency-probe',target:member.id,requestId:id});
    }
    if(expired)this.emit({latency});
  }
  async share() {
    if (this.display || this.capturing) return;
    this.capturing = true;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开');
      const video = captureConstraints(this.quality);
      const supported = navigator.mediaDevices.getSupportedConstraints?.();
      const audio = { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(supported?.restrictOwnAudio ? { restrictOwnAudio: true } : {}) };
      let stream;
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video, audio, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' }); }
      catch (e) { if (!['NotReadableError', 'OverconstrainedError'].includes(e.name)) throw e; stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false, selfBrowserSurface: 'exclude' }); }
      if (!this.state.room || !this.state.connected) { stream.getTracks().forEach(t => t.stop()); throw Error('请连接后再投屏'); }
      this.displayApproved = false; this.display = stream; stream.getVideoTracks()[0].contentHint = 'motion'; stream.getVideoTracks()[0].onended = () => this.stop().catch(e => this.emit({ error: e.message }));
      const system = this.systemTrack();
      this.protectPlayback(!!system && system.getSettings().restrictOwnAudio !== true);
      if (system) system.onended = () => { if (this.display === stream) this.stopSystemAudio().catch(e=>this.emit({error:e.message})); };
      this.emit({ localVideo: new MediaStream(stream.getVideoTracks()), systemAudio: !!system });
      await this.request({ type: 'start', systemAudio: !!system });
      if (this.display !== stream) return;
      this.displayApproved = true; await this.syncTracks();
      if (system && !this.systemTrack()) await this.stopSystemAudio();
      if (!system) this.emit({ notice: '未捕获系统音频。请检查浏览器分享对话框中的音频选项。' });
    } catch (e) { this.stopLocal(); await this.syncTracks().catch(() => {}); if (this.state.connected) this.send({ type: 'stop' }); throw e; }
    finally { this.capturing = false; }
  }
  systemTrack() { return this.display?.getAudioTracks().find(t=>t.readyState==='live'); }
  protectPlayback(active) {
    // Mute already playing elements before the capture can reach any peer.
    // React keeps newly mounted remote audio elements in the same state.
    for (const el of document.querySelectorAll('audio[data-channel]')) el.muted=active;
    this.emit({ playbackProtected:active });
  }
  async stopSystemAudio() {
    const display = this.display; if (!display) return;
    for (const track of display.getAudioTracks()) { track.onended=null; track.stop(); display.removeTrack(track); }
    this.protectPlayback(false); this.emit({ systemAudio:false });
    await this.syncTracks();
    if (this.display===display && this.displayApproved && this.state.connected) await this.request({type:'start',systemAudio:false});
  }
  stopLocal() { this.displayApproved = false; this.display?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.display = null; this.protectPlayback(false); this.emit({ localVideo: null, systemAudio: false }); }
  async stop() { this.stopLocal(); await this.syncTracks(); if (this.state.connected) await this.request({ type: 'stop' }); }
  async microphone() {
    if (this.micBusy) return; this.micBusy = true;
    try {
      if (this.micStream) { await this.stopMic(); return; }
      const room = this.state.room?.id, self = this.selfId;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: true }, video: false });
      if (!room || this.state.room?.id !== room || this.selfId !== self || !this.state.connected) { stream.getTracks().forEach(t=>t.stop()); return; }
      this.micStream = stream; stream.getAudioTracks()[0].onended = () => this.stopMic().catch(e=>this.emit({error:e.message}));
      this.emit({ mic: true });
      try { await this.syncTracks(); if(this.micStream===stream) this.send({ type:'mic', enabled:true }); }
      catch (e) { await this.stopMic().catch(()=>{}); throw e; }
    } finally { this.micBusy = false; }
  }
  clearMic() { this.micStream?.getTracks().forEach(t=>{t.onended=null;t.stop();}); this.micStream=null; this.emit({mic:false}); }
  async stopMic() { this.clearMic(); if (this.state.connected) this.send({type:'mic',enabled:false}); await this.syncTracks(); }
  cleanup() { this.stopLocal(); this.clearMic(); this.closePeer(); }
  leave() { if (this.state.connected) this.send({ type: 'leave' }); sessionStorage.removeItem('friends-session'); this.cleanup(); this.latencyPending.clear(); this.emit({ room: null, messages: [], latestChat: null, latency:{} }); }
  destroy() { this.closed = true; clearInterval(this.statsTimer); clearInterval(this.pingTimer); clearTimeout(this.reconnectTimer); this.cleanup(); this.ws?.close(); }
}
