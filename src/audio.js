// Process outgoing system audio and microphone once, then reuse their tracks for every peer.
// Nothing connects to context.destination, so the sender never hears a duplicate local mix.
export class OutgoingAudio {
  constructor(volume) { this.volume = volume; this.channels = new Map(); }
  ensure() {
    if (!this.context) this.context = new AudioContext();
    this.context.resume().catch(() => {});
  }
  track(name, input) {
    if (!input || input.readyState === 'ended') { this.remove(name); return null; }
    const previous = this.channels.get(name);
    if (previous?.input === input) return previous.output;
    this.remove(name); this.ensure();
    const source = this.context.createMediaStreamSource(new MediaStream([input]));
    const gain = this.context.createGain(); gain.gain.value = this.volume;
    const destination = this.context.createMediaStreamDestination();
    source.connect(gain); gain.connect(destination);
    const output = destination.stream.getAudioTracks()[0];
    this.channels.set(name, { input, output, source, gain, destination }); return output;
  }
  setVolume(value) { this.volume = value; for (const c of this.channels.values()) c.gain.gain.setTargetAtTime(value, this.context.currentTime, .01); }
  remove(name) { const c = this.channels.get(name); if (!c) return; c.source.disconnect(); c.gain.disconnect(); c.output.stop(); this.channels.delete(name); }
  clear() { for (const name of [...this.channels.keys()]) this.remove(name); }
  close() { this.clear(); this.context?.close().catch(() => {}); }
}
