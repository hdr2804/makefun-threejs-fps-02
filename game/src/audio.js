// All sound is synthesised with WebAudio: no audio files, no network.
// One shared noise buffer, short envelopes, nothing allocated per shot beyond nodes.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  function noise(dur, filterFreq, gainVal, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur);
  }

  function tone(freq, dur, gainVal, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }

  return {
    resume() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'ls7') { noise(0.28, 900, 0.9); tone(140, 0.18, 0.5, 'sine', 55); }
      else if (kind === 'sc12') { noise(0.22, 1400, 0.9); tone(110, 0.14, 0.45, 'sine', 50); }
      else if (kind === 'p9') { noise(0.12, 2200, 0.55); tone(220, 0.08, 0.3, 'sine', 90); }
      else { noise(0.16, 1800, 0.75); tone(170, 0.12, 0.4, 'sine', 70); }
    },
    distantShot() { noise(0.2, 500, 0.25); },
    reload() { tone(1200, 0.05, 0.25, 'square'); setTimeout(() => tone(900, 0.05, 0.25, 'square'), 260); },
    dry() { tone(1500, 0.04, 0.2, 'square'); },
    hit() { tone(2400, 0.06, 0.22, 'sine'); },
    kill() { tone(2400, 0.07, 0.25, 'sine'); setTimeout(() => tone(3200, 0.09, 0.25, 'sine'), 70); },
    hurt() { tone(180, 0.18, 0.4, 'sawtooth', 90); },
    explosion() { noise(0.9, 320, 1.0); tone(70, 0.7, 0.7, 'sine', 30); },
    flash() { noise(0.14, 6000, 0.8, 'highpass'); tone(3400, 0.3, 0.18, 'sine', 2400); },
    puff() { noise(1.1, 900, 0.16); },
    beep() { tone(880, 0.09, 0.3, 'sine'); },
    plantDone() { tone(660, 0.12, 0.3, 'sine'); setTimeout(() => tone(990, 0.16, 0.3, 'sine'), 120); },
    buy() { tone(520, 0.07, 0.25, 'sine'); setTimeout(() => tone(780, 0.1, 0.25, 'sine'), 80); },
    win() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.28, 'sine'), i * 130)); },
    lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.25, 'sine'), i * 140)); },
    tick() { tone(1100, 0.04, 0.15, 'sine'); },
  };
}
