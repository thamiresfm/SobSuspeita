let ctx;
let ambienceGain;
let enabled = false;

function getCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    ambienceGain = ctx.createGain();
    ambienceGain.gain.value = 0.08;
    ambienceGain.connect(ctx.destination);
  }
  return ctx;
}

function hum(freq, detune) {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(ambienceGain);
  o.start();
  const now = c.currentTime;
  g.gain.linearRampToValueAtTime(0.03, now + 0.5);
  return { stop: () => {
    g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.3);
    setTimeout(() => o.stop(), 400);
  } };
}

let humStop = null;

export function setSoundOn(on) {
  enabled = on;
  if (on) {
    const c = getCtx();
    if (c.state === "suspended") c.resume();
    if (!humStop) humStop = hum(58, 3);
  } else if (humStop) {
    humStop.stop();
    humStop = null;
  }
}

export function playClick() {
  if (!enabled) return;
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.value = 880;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(c.destination);
  o.start();
  const t = c.currentTime;
  g.gain.linearRampToValueAtTime(0.04, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.stop(t + 0.09);
}

export function isEnabled() {
  return enabled;
}
