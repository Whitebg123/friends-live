export class Peer {
  constructor(live, id) { this.live = live; this.id = id; this.bitrate = live.bitrate; this.state = { remoteAudio: [] }; this.candidates = []; this.earlyIce = new Map(); this.previous = {}; }
  get epoch() { return this.live.epoch; }
  target() { return this.live.state.room?.members.some(m => m.id === this.id && m.online) ? this.id : null; }
  emit(patch) { if (this.disposed) return; Object.assign(this.state, patch); this.live.emit({ remotePeers: { ...this.live.state.remotePeers, [this.id]: { ...this.state } } }); }
  relay(signal) { if (!this.disposed && this.target()) this.live.send({ type: 'signal', target: this.id, epoch: this.epoch, signal: { negotiation: this.negotiation, ...signal } }); }
  dispose() { this.disposed = true; this.closePeer(); }
  closePeer() {
    if (this.pc) { this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null; this.pc.close(); }
    this.pc = null; this.candidates = []; this.earlyIce = new Map(); this.negotiation = null; this.previous = {};
    clearTimeout(this.iceTimer); this.emit({ remoteVideo: null, remoteAudio: [], stats: {}, mediaStatus: '等待连接' });
  }
  peer() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.live.iceServers });
    pc.onicecandidate = e => { if (e.candidate && pc === this.pc) try { this.relay({ kind: 'ice', candidate: e.candidate.toJSON() }); } catch {} };
    pc.ontrack = e => { if (pc !== this.pc) return; const stream = new MediaStream([e.track]); this.emit(e.track.kind === 'video' ? { remoteVideo: stream } : { remoteAudio: [...this.state.remoteAudio, stream] }); };
    pc.onconnectionstatechange = () => { if (pc !== this.pc) return; this.emit({ mediaStatus: pc.connectionState }); if (pc.connectionState === 'failed') this.failure(); };
    this.iceTimer = setTimeout(() => { if (pc === this.pc && pc.connectionState !== 'connected') this.failure(); }, 25000);
    return pc;
  }
  failure() { this.emit({ error: '媒体连接失败。请重连；若 NAT 或防火墙阻止直连，需要配置外部 TURN。' }); }
  async syncTracks(pc = this.pc) {
    if (!pc || pc.connectionState === 'closed') return;
    const display = this.live.displayApproved ? this.live.display : null;
    const tracks = [display?.getVideoTracks()[0], this.live.audio.track('system', display?.getAudioTracks()[0]), this.live.audio.track('mic', this.live.micStream?.getAudioTracks()[0])];
    const ts = pc.getTransceivers();
    try { for (let i = 0; i < 3; i++) if (ts[i]) await ts[i].sender.replaceTrack(tracks[i] || null); }
    catch (e) { if (pc !== this.pc || pc.connectionState === 'closed') { if (this.pc && this.pc !== pc) await this.syncTracks(this.pc); return; } throw e; }
    await this.setBitrate(this.bitrate);
  }
  async offer() {
    if (this.disposed || !this.target()) return;
    this.closePeer(); this.negotiation = crypto.randomUUID(); const pc = this.peer();
    for (const kind of ['video', 'audio', 'audio']) pc.addTransceiver(kind, { direction: 'sendrecv' });
    await this.syncTracks(pc); if (this.disposed || pc !== this.pc || pc.signalingState === 'closed') return; await pc.setLocalDescription(await pc.createOffer());
    if (pc === this.pc) this.relay({ kind: 'offer', sdp: pc.localDescription.sdp });
  }
  async signal({ epoch, signal: s }) {
    if (this.disposed || epoch !== this.epoch) return;
    if (s.kind === 'ready') return this.offer();
    if (s.kind === 'ice' && (s.negotiation !== this.negotiation || !this.pc)) {
      const list = this.earlyIce.get(s.negotiation) || []; if (list.length < 64) list.push(s.candidate);
      if (this.earlyIce.size > 2) this.earlyIce.delete(this.earlyIce.keys().next().value);
      this.earlyIce.set(s.negotiation, list); return;
    }
    if (s.kind === 'offer') {
      const early = this.earlyIce.get(s.negotiation) || []; this.closePeer(); this.negotiation = s.negotiation;
      const pc = this.peer(); await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      if (this.disposed || pc !== this.pc) return;
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
  async setBitrate(value) {
    this.bitrate = Number(value); const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video'); if (!sender || !this.pc.currentLocalDescription || !this.pc.currentRemoteDescription || this.pc.signalingState !== 'stable') return;
    try { const p = sender.getParameters(); if (!p.encodings?.length) return; p.encodings[0].maxBitrate = this.bitrate * 1000000; if (this.live.fps === null) delete p.encodings[0].maxFramerate; else p.encodings[0].maxFramerate = this.live.fps; p.degradationPreference = 'maintain-resolution'; await sender.setParameters(p); } catch { this.live.emit({ notice: '发送参数未被浏览器接受，使用浏览器自适应设置' }); }
  }
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
}
