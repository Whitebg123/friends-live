export class Live {
  constructor(update) {
    this.update = update; this.state = { room: null, status: '正在连接', messages: [], remoteAudio: [], stats: {} };
    this.pending = new Map(); this.retry = 0; this.bitrate = 15; this.open();
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
        if (this.display) this.request({ type: 'start', systemAudio: this.display.getAudioTracks().length > 0 }).catch(e => this.emit({ error: e.message }));
      } else if (d.type === 'room') this.setRoom(d.room);
      else if (d.type === 'signal') this.queue = (this.queue || Promise.resolve()).then(() => this.signal(d)).catch(e => this.emit({ error: `媒体连接失败：${e.message}` }));
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
  setRoom(room) {
    const changed = room.epoch !== this.epoch; this.emit({ room });
    if (changed) {
      this.epoch = room.epoch; this.closePeer();
      if (this.target() && room.ownerId !== this.selfId) this.relay({ kind: 'ready' });
    }
  }
  target() { return this.state.room?.members.find(m => m.id !== this.selfId && m.online)?.id; }
  relay(signal) { const target = this.target(); if (target) this.send({ type: 'signal', target, epoch: this.epoch, signal: { negotiation: this.negotiation, ...signal } }); }
  closePeer() {
    if (this.pc) { this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null; this.pc.close(); }
    this.pc = null; this.candidates = []; this.earlyIce = new Map(); this.negotiation = null; this.previous = {};
    clearTimeout(this.iceTimer); this.emit({ remoteVideo: null, remoteAudio: [], stats: {}, mediaStatus: '等待连接' });
  }
  peer() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = e => { if (e.candidate && pc === this.pc) try { this.relay({ kind: 'ice', candidate: e.candidate.toJSON() }); } catch {} };
    pc.ontrack = e => { if (pc !== this.pc) return; const stream = new MediaStream([e.track]); this.emit(e.track.kind === 'video' ? { remoteVideo: stream } : { remoteAudio: [...this.state.remoteAudio, stream] }); };
    pc.onconnectionstatechange = () => { if (pc !== this.pc) return; this.emit({ mediaStatus: pc.connectionState }); if (pc.connectionState === 'failed') this.failure(); };
    this.iceTimer = setTimeout(() => { if (pc === this.pc && pc.connectionState !== 'connected') this.failure(); }, 25000);
    return pc;
  }
  failure() { this.emit({ error: '媒体连接失败。请重连；若 NAT 或防火墙阻止直连，需要配置外部 TURN。' }); }
  async syncTracks(pc = this.pc) {
    if (!pc || pc.connectionState === 'closed') return;
    const tracks = [this.display?.getVideoTracks()[0], this.display?.getAudioTracks()[0], this.micStream?.getAudioTracks()[0]];
    const ts = pc.getTransceivers();
    try { for (let i = 0; i < 3; i++) if (ts[i]) await ts[i].sender.replaceTrack(tracks[i] || null); }
    catch (e) { if (pc !== this.pc || pc.connectionState === 'closed') { if (this.pc && this.pc !== pc) await this.syncTracks(this.pc); return; } throw e; }
    await this.setBitrate(this.bitrate);
  }
  async offer() {
    if (!this.target()) return;
    this.closePeer(); this.negotiation = crypto.randomUUID(); const pc = this.peer();
    for (const kind of ['video', 'audio', 'audio']) pc.addTransceiver(kind, { direction: 'sendrecv' });
    await this.syncTracks(pc); await pc.setLocalDescription(await pc.createOffer());
    if (pc === this.pc) this.relay({ kind: 'offer', sdp: pc.localDescription.sdp });
  }
  async signal({ epoch, signal: s }) {
    if (epoch !== this.epoch) return;
    if (s.kind === 'ready') return this.offer();
    if (s.kind === 'ice' && (s.negotiation !== this.negotiation || !this.pc)) {
      const list = this.earlyIce.get(s.negotiation) || []; if (list.length < 64) list.push(s.candidate);
      if (this.earlyIce.size > 2) this.earlyIce.delete(this.earlyIce.keys().next().value);
      this.earlyIce.set(s.negotiation, list); return;
    }
    if (s.kind === 'offer') {
      const early = this.earlyIce.get(s.negotiation) || []; this.closePeer(); this.negotiation = s.negotiation;
      const pc = this.peer(); await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      for (const t of pc.getTransceivers()) t.direction = 'sendrecv';
      await this.syncTracks(pc); for (const c of early) await pc.addIceCandidate(c);
      await pc.setLocalDescription(await pc.createAnswer());
      if (pc === this.pc) { this.relay({ kind: 'answer', sdp: pc.localDescription.sdp }); await this.setBitrate(this.bitrate); }
    } else if (s.negotiation === this.negotiation && this.pc) {
      const pc = this.pc;
      if (s.kind === 'answer') { await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp }); for (const c of this.candidates.splice(0)) await pc.addIceCandidate(c); await this.setBitrate(this.bitrate); }
      else if (s.kind === 'ice') { if (pc.remoteDescription) await pc.addIceCandidate(s.candidate); else this.candidates.push(s.candidate); }
    }
  }
  async share() {
    if (this.display || this.capturing) return;
    this.capturing = true;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开');
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } };
      let stream;
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include' }); }
      catch (e) { if (!['NotReadableError', 'OverconstrainedError'].includes(e.name)) throw e; stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false }); }
      if (!this.state.room || !this.state.connected) { stream.getTracks().forEach(t => t.stop()); throw Error('请连接后再投屏'); }
      this.display = stream; stream.getVideoTracks()[0].contentHint = 'motion'; stream.getVideoTracks()[0].onended = () => this.stop().catch(e => this.emit({ error: e.message }));
      this.emit({ localVideo: new MediaStream(stream.getVideoTracks()), systemAudio: stream.getAudioTracks().length > 0 });
      await this.syncTracks(); await this.request({ type: 'start', systemAudio: stream.getAudioTracks().length > 0 });
      if (!stream.getAudioTracks().length) this.emit({ notice: '未捕获系统音频。请检查浏览器分享对话框中的音频选项。' });
    } catch (e) { this.stopLocal(); await this.syncTracks().catch(() => {}); throw e; }
    finally { this.capturing = false; }
  }
  stopLocal() { this.display?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.display = null; this.emit({ localVideo: null, systemAudio: false }); }
  async stop() { this.stopLocal(); await this.syncTracks(); if (this.state.connected) await this.request({ type: 'stop' }); }
  async microphone() {
    if (this.micBusy) return; this.micBusy = true;
    try {
      if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
      else this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: true }, video: false });
      this.emit({ mic: !!this.micStream }); await this.syncTracks();
    } finally { this.micBusy = false; }
  }
  async setBitrate(value) {
    this.bitrate = Number(value); const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video'); if (!sender || !this.pc.currentLocalDescription || !this.pc.currentRemoteDescription || this.pc.signalingState !== 'stable') return;
    try { const p = sender.getParameters(); if (!p.encodings?.length) return; p.encodings[0].maxBitrate = this.bitrate * 1000000; p.encodings[0].maxFramerate = 60; p.degradationPreference = 'maintain-resolution'; await sender.setParameters(p); } catch { this.emit({ notice: '码率设置未被浏览器接受，使用浏览器自动参数' }); }
  }
  retryMedia() { if (this.state.room.ownerId === this.selfId) return this.offer(); this.relay({ kind: 'ready' }); }
  async stats() {
    const pc = this.pc; if (!pc) return; const report = await pc.getStats(); if (pc !== this.pc) return;
    const result = {};
    for (const [key, type] of [['sent', 'outbound-rtp'], ['received', 'inbound-rtp']]) {
      const v = [...report.values()].find(s => s.type === type && s.kind === 'video' && !s.isRemote);
      if (!v) continue;
      const bytes = key === 'sent' ? v.bytesSent : v.bytesReceived, p = this.previous[key];
      const bitrate = p?.id === v.id && v.timestamp > p.time ? Math.max(0, (bytes - p.bytes) * 8 / (v.timestamp - p.time) / 1000) : undefined;
      this.previous[key] = { id: v.id, time: v.timestamp, bytes };
      result[key] = { width: v.frameWidth, height: v.frameHeight, fps: v.framesPerSecond, bitrate };
    }
    const tr = [...report.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId), pair = tr && report.get(tr.selectedCandidatePairId);
    if (pair) { result.rtt = pair.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : undefined; result.route = [report.get(pair.localCandidateId), report.get(pair.remoteCandidateId)].some(c => c?.candidateType === 'relay') ? 'TURN' : 'P2P'; }
    this.emit({ stats: result });
  }
  cleanup() { this.stopLocal(); this.micStream?.getTracks().forEach(t => t.stop()); this.micStream = null; this.closePeer(); this.emit({ mic: false }); }
  leave() { if (this.state.connected) this.send({ type: 'leave' }); sessionStorage.removeItem('friends-session'); this.cleanup(); this.epoch = null; this.emit({ room: null, messages: [], latestChat: null }); }
  destroy() { this.closed = true; clearInterval(this.statsTimer); clearTimeout(this.reconnectTimer); this.cleanup(); this.ws?.close(); }
}
