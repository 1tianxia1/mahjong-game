// sound.js — Web Audio 程序化音效（R-006）
// 零音频文件、零依赖：全部用 OscillatorNode / BufferSource(白噪声) + GainNode 包络合成。
// 唯一入口：window.Sfx.play(type)。静音状态落 localStorage['mj_muted']。
// 自动播放策略：懒创建 AudioContext，首次用户手势（pointerdown/keydown）后 resume。
(function () {
  'use strict';

  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('mj_muted') === '1'; } catch (e) { /* ignore */ }

  // 音色参数集中在顶部，便于试听后微调（可插拔扩展点）
  const SOUND_PRESETS = {
    deal:   { type: 'noise', dur: 0.18, click: 3, gap: 0.04, freq: 1200, q: 1.2, gain: 0.22 }, // 2~3 段轻 click，总时长 ~180ms
    discard:{ type: 'noise', dur: 0.08, click: 1, gap: 0,    freq: 1200, q: 1.2, gain: 0.30 }, // 木质"啪"
    meld:   { type: 'tone',  dur: 0.15, freq: 180, q: 1, gain: 0.32 },                          // 低频 thunk
    hu:     { type: 'arp',   dur: 0.60, notes: [523.25, 659.25, 783.99], gain: 0.30 },         // 五声音阶三音上行琶音
    liuju:  { type: 'arp',   dur: 0.50, notes: [392.0, 311.13], gain: 0.26, detune: true },     // 下行两音 + 轻微失谐
  };
  const MASTER = 0.25; // 所有音效默认总音量上限

  function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      ctx.resume();
      // 首次用户手势后恢复（应对浏览器自动播放策略）
      const resumeOnce = () => { if (ctx && ctx.state === 'suspended') ctx.resume(); };
      window.addEventListener('pointerdown', resumeOnce, { once: true });
      window.addEventListener('keydown', resumeOnce, { once: true });
    } catch (e) { ctx = null; }
  }

  function t0() { return ctx ? ctx.currentTime : 0; }

  function playNoise(preset) {
    const base = t0();
    const clicks = preset.click || 1;
    for (let i = 0; i < clicks; i++) {
      const start = base + i * (preset.gap || 0);
      const end = start + preset.dur;
      const len = Math.max(1, Math.floor(preset.dur * ctx.sampleRate));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < len; j++) data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 2); // 噪声脉冲
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = preset.freq; bp.Q.value = preset.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(preset.gain * MASTER, start);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(start); src.stop(end);
    }
  }

  function playTone(preset) {
    const start = t0();
    const end = start + preset.dur;
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = preset.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(preset.gain * MASTER, start);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(start); osc.stop(end);
  }

  function playArp(preset) {
    const base = t0();
    const step = preset.dur / preset.notes.length;
    preset.notes.forEach((f, i) => {
      const start = base + i * step;
      const end = start + step * 0.95;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(f, start);
      if (preset.detune) osc.detune.setValueAtTime(i % 2 ? 6 : -6, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(preset.gain * MASTER, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(start); osc.stop(end);
    });
  }

  function play(type) {
    if (muted) return;          // 静音时静默返回
    ensureCtx();
    if (!ctx) return;
    try {
      const preset = SOUND_PRESETS[type];
      if (!preset) return;
      if (preset.type === 'noise') playNoise(preset);
      else if (preset.type === 'tone') playTone(preset);
      else if (preset.type === 'arp') playArp(preset);
    } catch (e) { /* 绝不抛异常，保证游戏功能不受影响 */ }
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('mj_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (muted && ctx && ctx.state === 'running') ctx.suspend();
  }
  function toggleMuted() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  window.Sfx = { play, setMuted, toggleMuted, isMuted, _ensureCtx: ensureCtx };
})();
