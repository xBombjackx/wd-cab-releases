// ============================================================================
// boot.js — WebAssembly + AudioWorklet Host for the WD Cab Live Browser Demo
//
// Impersonates the JUCE 8 WebView2 backend (window.__JUCE__ + juce/index.js)
// so src/ui/index.html runs unmodified in any modern browser, backed by the
// real C++20 WdAmpSimulator DSP engine compiled to wdcab.wasm.
//
// Includes two built-in studio guitar amp stems:
//   1. Super Lead (Mid Gain)  — ./audio/super_lead.wav
//   2. NTS        (High Gain) — ./audio/nts.wav
// Switching between Mid Gain and High Gain preserves the exact playback
// position in the riff with a smooth crossfade.
// ============================================================================
(() => {
  'use strict';

  const NUM_PARAMS   = 83;
  const CURVE_POINTS = 64;
  const TELEM_FLOATS = 280;

  // Exact 83-parameter table matching WdAmpProcessor::createParameterLayout()
  const PARAM_LIST = [
    /* 0  */ { id: 'loadEnabled',     type: 'toggle', def: false },
    /* 1  */ { id: 'guitarVol',       type: 'slider', min: 0.0,    max: 10.0,    step: 0.01,  skew: 1.0,  def: 10.0 },
    /* 2  */ { id: 'guitarTone',      type: 'slider', min: 0.0,    max: 10.0,    step: 0.01,  skew: 1.0,  def: 10.0 },
    /* 3  */ { id: 'cableLenM',       type: 'slider', min: 0.5,    max: 12.0,    step: 0.1,   skew: 1.0,  def: 3.0 },
    /* 4  */ { id: 'reactiveMode',    type: 'combo',  choices: ['Off', 'Reactive Q Damping'], def: 1 },
    /* 5  */ { id: 'gateEnabled',     type: 'toggle', def: false },
    /* 6  */ { id: 'gateThresh',      type: 'slider', min: -80.0,  max: -18.0,   step: 0.1,   skew: 1.0,  def: -52.0 },
    /* 7  */ { id: 'gateRelease',     type: 'slider', min: 25.0,   max: 350.0,   step: 1.0,   skew: 1.0,  def: 65.0 },
    /* 8  */ { id: 'boostEnabled',    type: 'toggle', def: false },
    /* 9  */ { id: 'boostTopo',       type: 'combo',  choices: ['SD-1 Asymmetric', 'TS9 Symmetric'], def: 0 },
    /* 10 */ { id: 'boostDrive',      type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.25 },
    /* 11 */ { id: 'boostTone',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.55 },
    /* 12 */ { id: 'boostLevel',      type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.75 },
    /* 13 */ { id: 'preampEnabled',   type: 'toggle', def: false },
    /* 14 */ { id: 'channel',         type: 'combo',  choices: ['Fender AB763 Clean', 'Soldano/5150 Lead'], def: 1 },
    /* 15 */ { id: 'preampGain',      type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.55 },
    /* 16 */ { id: 'bass',            type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.50 },
    /* 17 */ { id: 'mid',             type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.50 },
    /* 18 */ { id: 'treble',          type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.55 },
    /* 19 */ { id: 'preampBias',      type: 'slider', min: -1.5,   max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.0 },
    /* 20 */ { id: 'preampAge',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.15 },
    /* 21 */ { id: 'powerAmpEnabled', type: 'toggle', def: false },
    /* 22 */ { id: 'powerTube',       type: 'combo',  choices: ['6L6GC Push-Pull', 'EL34 Push-Pull'], def: 0 },
    /* 23 */ { id: 'rectifier',       type: 'combo',  choices: ['Silicon Diode Fast', 'GZ34 Tube Sag', '5U4G Vintage Sag'], def: 0 },
    /* 24 */ { id: 'masterVol',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.55 },
    /* 25 */ { id: 'presence',        type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.50 },
    /* 26 */ { id: 'depth',           type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.50 },
    /* 27 */ { id: 'nfbAmount',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.55 },
    /* 28 */ { id: 'powerBias',       type: 'slider', min: -56.0,  max: -30.0,   step: 0.1,   skew: 1.0,  def: -43.0 },
    /* 29 */ { id: 'powerAge',        type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.18 },
    /* 30 */ { id: 'xfmrDrive',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.50 },
    /* 31 */ { id: 'powerScaleW',     type: 'slider', min: 5.0,    max: 120.0,   step: 0.5,   skew: 1.0,  def: 50.0 },
    /* 32 */ { id: 'impRatio',        type: 'slider', min: 0.50,   max: 2.00,    step: 0.01,  skew: 1.0,  def: 1.00 },
    /* 33 */ { id: 'cabEnabled',      type: 'toggle', def: true },
    /* 34 */ { id: 'cabModel',        type: 'combo',  choices: ['1x12 Open', 'Vintage 4x12', 'Modern 4x12', 'Oversized Modern 4x12', '2x12 Open', '4x10 Aluminum', '8x10', '1x15', '1x18', '2x12 Alnico', '1x10 Tweed', '1x12 Ported', '4x12 Brit 75'], def: 2 },
    /* 35 */ { id: 'cabBoxScale',     type: 'slider', min: 0.85,   max: 1.15,    step: 0.005, skew: 1.0,  def: 1.00 },
    /* 36 */ { id: 'cabConeDamp',     type: 'slider', min: 0.70,   max: 1.40,    step: 0.005, skew: 1.0,  def: 1.00 },
    /* 37 */ { id: 'cabALoResDb',     type: 'slider', min: -6.0,   max: 6.0,     step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 38 */ { id: 'cabAHiResDb',     type: 'slider', min: -6.0,   max: 6.0,     step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 39 */ { id: 'cabAHpfHz',       type: 'slider', min: 20.0,   max: 400.0,   step: 1.0,   skew: 0.42, def: 20.0 },
    /* 40 */ { id: 'cabALpfHz',       type: 'slider', min: 2000.0, max: 20000.0, step: 10.0,  skew: 0.42, def: 20000.0 },
    /* 41 */ { id: 'cabAPan',         type: 'slider', min: -1.0,   max: 1.0,     step: 0.01,  skew: 1.0,  def: -0.25 },
    /* 42 */ { id: 'cabALevelDb',     type: 'slider', min: -24.0,  max: 12.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 43 */ { id: 'micEnabled',      type: 'toggle', def: true },
    /* 44 */ { id: 'micModel',        type: 'combo',  choices: ['57', '121', '47', '421', 'Wall', '160', '906', '414'], def: 0 },
    /* 45 */ { id: 'micDistCm',       type: 'slider', min: 0.5,    max: 50.0,    step: 0.001, skew: 0.50, def: 2.5 },
    /* 46 */ { id: 'micOffAxis',      type: 'slider', min: 0.0,    max: 45.0,    step: 0.1,   skew: 1.0,  def: 12.0 },
    /* 47 */ { id: 'micConePos',      type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.35 },
    /* 48 */ { id: 'micDrive',        type: 'slider', min: -12.0,  max: 24.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 49 */ { id: 'micPreDrive',     type: 'slider', min: -12.0,  max: 24.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 50 */ { id: 'micPhase',        type: 'toggle', def: false },
    /* 51 */ { id: 'micPreModel',     type: 'combo',  choices: ['Clean', '73', '12', '76', 'REDD', 'Porta'], def: 1 },
    /* 52 */ { id: 'cabBEnabled',     type: 'toggle', def: true },
    /* 53 */ { id: 'cabBModel',       type: 'combo',  choices: ['1x12 Open', 'Vintage 4x12', 'Modern 4x12', 'Oversized Modern 4x12', '2x12 Open', '4x10 Aluminum', '8x10', '1x15', '1x18', '2x12 Alnico', '1x10 Tweed', '1x12 Ported', '4x12 Brit 75'], def: 1 },
    /* 54 */ { id: 'cabBBoxScale',    type: 'slider', min: 0.85,   max: 1.15,    step: 0.005, skew: 1.0,  def: 1.00 },
    /* 55 */ { id: 'cabBConeDamp',    type: 'slider', min: 0.70,   max: 1.40,    step: 0.005, skew: 1.0,  def: 1.00 },
    /* 56 */ { id: 'cabBLoResDb',     type: 'slider', min: -6.0,   max: 6.0,     step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 57 */ { id: 'cabBHiResDb',     type: 'slider', min: -6.0,   max: 6.0,     step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 58 */ { id: 'cabBHpfHz',       type: 'slider', min: 20.0,   max: 400.0,   step: 1.0,   skew: 0.42, def: 20.0 },
    /* 59 */ { id: 'cabBLpfHz',       type: 'slider', min: 2000.0, max: 20000.0, step: 10.0,  skew: 0.42, def: 20000.0 },
    /* 60 */ { id: 'cabBPan',         type: 'slider', min: -1.0,   max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.25 },
    /* 61 */ { id: 'cabBLevelDb',     type: 'slider', min: -24.0,  max: 12.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 62 */ { id: 'micBEnabled',     type: 'toggle', def: true },
    /* 63 */ { id: 'micBModel',       type: 'combo',  choices: ['57', '121', '47', '421', 'Wall', '160', '906', '414'], def: 1 },
    /* 64 */ { id: 'micBDistCm',      type: 'slider', min: 0.5,    max: 50.0,    step: 0.001, skew: 0.50, def: 2.5 },
    /* 65 */ { id: 'micBOffAxis',     type: 'slider', min: 0.0,    max: 45.0,    step: 0.1,   skew: 1.0,  def: 10.0 },
    /* 66 */ { id: 'micBConePos',     type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.40 },
    /* 67 */ { id: 'micBDrive',       type: 'slider', min: -12.0,  max: 24.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 68 */ { id: 'micBPreDrive',    type: 'slider', min: -12.0,  max: 24.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 69 */ { id: 'micBPhase',       type: 'toggle', def: false },
    /* 70 */ { id: 'micBPreModel',    type: 'combo',  choices: ['Clean', '73', '12', '76', 'REDD', 'Porta'], def: 2 },
    /* 71 */ { id: 'roomEnabled',     type: 'toggle', def: true },
    /* 72 */ { id: 'roomType',        type: 'combo',  choices: ['Tight Iso Booth', 'Wood Tracking Room', 'Large Live Chamber', 'Tiled Garage'], def: 1 },
    /* 73 */ { id: 'roomPanMode',     type: 'combo',  choices: ['Same as Cab', 'Always Center', 'Reverse Pan'], def: 0 },
    /* 74 */ { id: 'roomSize',        type: 'slider', min: 0.60,   max: 1.50,    step: 0.01,  skew: 1.0,  def: 1.00 },
    /* 75 */ { id: 'roomDistM',       type: 'slider', min: 0.40,   max: 6.00,    step: 0.05,  skew: 1.0,  def: 2.20 },
    /* 76 */ { id: 'roomDamp',        type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.45 },
    /* 77 */ { id: 'roomWidth',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.80 },
    /* 78 */ { id: 'roomLevel',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.28 },
    /* 79 */ { id: 'inputCal',        type: 'slider', min: -18.0,  max: 18.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 80 */ { id: 'outputDb',        type: 'slider', min: -36.0,  max: 18.0,    step: 0.1,   skew: 1.0,  def: 0.0 },
    /* 81 */ { id: 'power',           type: 'toggle', def: true },
    /* 82 */ { id: 'roomSmash',       type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.0 },
  ];

  const PARAM_BY_ID = new Map();
  PARAM_LIST.forEach((p, idx) => {
    p.idx = idx;
    PARAM_BY_ID.set(p.id, p);
  });

  const toNorm = (def, scaled) => {
    const clamped = Math.max(def.min, Math.min(def.max, scaled));
    const lin = (clamped - def.min) / Math.max(1e-9, def.max - def.min);
    if (def.skew && def.skew !== 1.0 && lin > 0.0) {
      return Math.pow(lin, def.skew);
    }
    return lin;
  };

  const fromNorm = (def, norm) => {
    const n = Math.max(0.0, Math.min(1.0, norm));
    const mapped = (def.skew && def.skew !== 1.0 && n > 0.0)
      ? Math.pow(n, 1.0 / def.skew)
      : n;
    let val = def.min + (def.max - def.min) * mapped;
    if (def.step && def.step > 0.0) {
      val = def.min + Math.round((val - def.min) / def.step) * def.step;
      val = Math.round(val * 1e6) / 1e6;
    }
    return Math.max(def.min, Math.min(def.max, val));
  };

  // Current real (scaled) values sent to C++ WdAmpSimulator
  const rawParams = new Float64Array(NUM_PARAMS);
  PARAM_LIST.forEach((p, i) => {
    rawParams[i] = p.type === 'toggle' ? (p.def ? 1.0 : 0.0) : p.def;
  });

  const listeners = new Map();
  const fire = id => {
    for (const cb of listeners.get(id) || []) cb();
  };
  const listen = (id, cb) => {
    if (!listeners.has(id)) listeners.set(id, []);
    listeners.get(id).push(cb);
  };

  const sliderStates = {};
  const comboStates  = {};
  const toggleStates = {};

  const host = {
    sliderState(id) {
      if (!sliderStates[id]) {
        const def = PARAM_BY_ID.get(id) || { idx: -1, min: 0, max: 1, skew: 1, def: 0.5 };
        sliderStates[id] = {
          getNormalisedValue: () => {
            const v = def.idx >= 0 ? rawParams[def.idx] : def.def;
            return toNorm(def, v);
          },
          setNormalisedValue: norm => {
            const n = Math.max(0, Math.min(1, Number(norm) || 0));
            const scaled = fromNorm(def, n);
            if (def.idx >= 0) {
              if (Math.abs(rawParams[def.idx] - scaled) < 1e-7) return;
              rawParams[def.idx] = scaled;
            }
            fire(id);
            scheduleSync(def.idx, scaled);
          },
          getScaledValue: () => (def.idx >= 0 ? rawParams[def.idx] : def.def),
          sliderDragStarted: () => {},
          sliderDragEnded:   () => {},
          valueChangedEvent: { addListener: cb => listen(id, cb) },
        };
      }
      return sliderStates[id];
    },

    comboState(id) {
      if (!comboStates[id]) {
        const def = PARAM_BY_ID.get(id) || { idx: -1, choices: ['A', 'B'], def: 0 };
        const n = Math.max(1, (def.choices || []).length);
        comboStates[id] = {
          properties: { choices: def.choices || [] },
          getChoiceIndex: () => (def.idx >= 0 ? Math.round(rawParams[def.idx]) : def.def),
          setChoiceIndex: i => {
            const idxVal = Math.max(0, Math.min(n - 1, Math.round(Number(i) || 0)));
            if (def.idx >= 0) {
              if (Math.round(rawParams[def.idx]) === idxVal) return;
              rawParams[def.idx] = idxVal;
            }
            fire(id);
            scheduleSync(def.idx, idxVal);
          },
          get value() {
            const idxVal = def.idx >= 0 ? Math.round(rawParams[def.idx]) : def.def;
            return n > 1 ? idxVal / (n - 1) : 0;
          },
          valueChangedEvent:      { addListener: cb => listen(id, cb) },
          propertiesChangedEvent: { addListener: () => {} },
        };
      }
      return comboStates[id];
    },

    toggleState(id) {
      if (!toggleStates[id]) {
        const def = PARAM_BY_ID.get(id) || { idx: -1, def: false };
        toggleStates[id] = {
          getValue: () => (def.idx >= 0 ? rawParams[def.idx] >= 0.5 : !!def.def),
          setValue: v => {
            const num = v ? 1.0 : 0.0;
            if (def.idx >= 0) {
              if ((rawParams[def.idx] >= 0.5) === !!v) return;
              rawParams[def.idx] = num;
            }
            fire(id);
            scheduleSync(def.idx, num);
          },
          valueChangedEvent: { addListener: cb => listen(id, cb) },
        };
      }
      return toggleStates[id];
    },

    nativeFunction(name) {
      if (name === 'loadUserIr') {
        return async slot => openUserIrPicker(slot | 0);
      }
      if (name === 'dropUserIrBase64') {
        return async (slot, fileName, b64) => loadUserIrFromBase64(slot | 0, fileName, b64);
      }
      if (name === 'clearUserIr') {
        return async slot => {
          clearUserIrSlot(slot | 0);
          return true;
        };
      }
      if (name === 'syncPresetUi') {
        return async idx => {
          if (presetSel && idx >= 0 && idx < RIG_PRESETS.length) {
            presetSel.value = String(idx);
          }
          clearUserIrSlot(0);
          clearUserIrSlot(1);
        };
      }
      return async () => {};
    },
  };

  window.__WD_WEB_HOST__ = host;

  // ==========================================================================
  // Per-Cab User .wav IR State, Pure-JS RIFF Decoder & Live Telemetry Overlay
  // ==========================================================================
  const userIrState = [
    { active: false, name: '', wave: [], mono: null, sampleRate: 48000 },
    { active: false, name: '', wave: [], mono: null, sampleRate: 48000 },
  ];

  function decodeWavMonoJs(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 44 || arrayBuffer.byteLength > 16 * 1024 * 1024) return null;
    const view = new DataView(arrayBuffer);
    const len = arrayBuffer.byteLength;
    const readTag = off => String.fromCharCode(
      view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)
    );
    if (readTag(0) !== 'RIFF' || readTag(8) !== 'WAVE') return null;

    const guidTail = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];
    let fmtTag = 0, ch = 0, sr = 0, bps = 0;
    let hasFmt = false, dataOff = 0, dataSize = 0, hasData = false;
    let pos = 12;
    while (pos + 8 <= len) {
      const id = readTag(pos);
      const sz = view.getUint32(pos + 4, true);
      const body = pos + 8;
      const avail = Math.min(sz, len - body);
      if (id === 'fmt ') {
        if (avail < 16) return null;
        let tag = view.getUint16(body, true);
        ch  = view.getUint16(body + 2, true);
        sr  = view.getUint32(body + 4, true);
        bps = view.getUint16(body + 14, true);
        if (tag === 0xFFFE) {
          if (avail < 40) return null;
          for (let k = 0; k < 14; k++) {
            if (view.getUint8(body + 26 + k) !== guidTail[k]) return null;
          }
          const subFmt = view.getUint16(body + 24, true);
          if (subFmt !== 1 && subFmt !== 3) return null;
          tag = subFmt;
        }
        fmtTag = tag;
        hasFmt = true;
        if (hasData) break;
      } else if (id === 'data') {
        dataOff = body;
        dataSize = avail;
        hasData = true;
        if (hasFmt) break;
      }
      const advance = 8 + sz + (sz & 1);
      if (advance < 8 || advance > len - pos) break;
      pos += advance;
    }
    if (!hasFmt || !hasData || ch < 1 || ch > 64 || sr < 8000 || sr > 768000) return null;
    const isPcm = fmtTag === 1 && (bps === 8 || bps === 16 || bps === 24 || bps === 32);
    const isFlt = fmtTag === 3 && (bps === 32 || bps === 64);
    if (!isPcm && !isFlt) return null;
    const bytesPerSmp = bps >> 3;
    const frameBytes = ch * bytesPerSmp;
    if (frameBytes <= 0) return null;
    const totalFrames = Math.floor(dataSize / frameBytes);
    if (totalFrames <= 0) return null;
    const maxScratch = (typeof uiEngine !== 'undefined' && uiEngine.wasm &&
                        typeof uiEngine.wasm.wdcab_ir_scratch_max === 'function')
      ? uiEngine.wasm.wdcab_ir_scratch_max()
      : 131072;
    const numFrames = Math.min(totalFrames, sr * 10, maxScratch);
    const mono = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      const s = dataOff + i * frameBytes;
      let v = 0.0;
      if (isPcm) {
        if (bps === 8) v = (view.getUint8(s) - 128) / 128.0;
        else if (bps === 16) v = view.getInt16(s, true) / 32768.0;
        else if (bps === 24) {
          let x = view.getUint8(s) | (view.getUint8(s + 1) << 8) | (view.getUint8(s + 2) << 16);
          if (x & 0x800000) x |= ~0xFFFFFF;
          v = x / 8388608.0;
        } else {
          v = view.getInt32(s, true) / 2147483648.0;
        }
      } else {
        v = (bps === 32) ? view.getFloat32(s, true) : view.getFloat64(s, true);
      }
      mono[i] = Number.isFinite(v) ? Math.max(-64.0, Math.min(64.0, v)) : 0.0;
    }
    return { mono, sampleRate: sr };
  }

  function applyUserIrMono(slot, fileName, mono, sampleRate) {
    if ((slot !== 0 && slot !== 1) || !mono || mono.length <= 0) return false;
    const cleanName = String(fileName || 'Custom IR').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Custom IR';
    if (uiEngine.wasm && typeof uiEngine.wasm.wdcab_ir_scratch === 'function' &&
        typeof uiEngine.wasm.wdcab_load_user_ir === 'function')
    {
      const maxCap = (typeof uiEngine.wasm.wdcab_ir_scratch_max === 'function')
        ? uiEngine.wasm.wdcab_ir_scratch_max()
        : 131072;
      const copyLen = Math.min(mono.length, maxCap);
      const scratchPtr = uiEngine.wasm.wdcab_ir_scratch();
      let f32 = new Float32Array(uiEngine.wasm.memory.buffer);
      f32.set(mono.subarray(0, copyLen), scratchPtr >> 2);
      const ok = uiEngine.wasm.wdcab_load_user_ir(slot, scratchPtr, copyLen, sampleRate || 48000);
      if (!ok) return false;
      const hasWave = typeof uiEngine.wasm.wdcab_get_user_ir_waveform === 'function'
        ? uiEngine.wasm.wdcab_get_user_ir_waveform(slot, scratchPtr)
        : 0;
      f32 = new Float32Array(uiEngine.wasm.memory.buffer);
      const wave = hasWave ? Array.from(f32.subarray(scratchPtr >> 2, (scratchPtr >> 2) + 128)) : [];
      userIrState[slot] = { active: true, name: cleanName.slice(0, 60), wave, mono: mono.slice(0, copyLen), sampleRate: sampleRate || 48000 };
    } else {
      userIrState[slot] = { active: true, name: cleanName.slice(0, 60), wave: [], mono: mono.slice(), sampleRate: sampleRate || 48000 };
    }
    if (audio.node) {
      audio.node.port.postMessage({
        type: 'loadUserIr',
        slot,
        samples: userIrState[slot].mono.slice(),
        sampleRate: userIrState[slot].sampleRate,
      });
    }
    syncUiEngineAndEmit();
    return true;
  }

  function clearUserIrSlot(slot) {
    if (slot !== 0 && slot !== 1) return;
    if (!userIrState[slot].active) return;
    userIrState[slot] = { active: false, name: '', wave: [], mono: null, sampleRate: 48000 };
    if (uiEngine.wasm && typeof uiEngine.wasm.wdcab_clear_user_ir === 'function') {
      uiEngine.wasm.wdcab_clear_user_ir(slot);
    }
    if (audio.node) {
      audio.node.port.postMessage({ type: 'clearUserIr', slot });
    }
    syncUiEngineAndEmit();
  }

  function loadUserIrFromBase64(slot, fileName, b64Str) {
    try {
      let clean = String(b64Str || '');
      const commaIdx = clean.indexOf(',');
      if (clean.startsWith('data:') && commaIdx > 0) clean = clean.slice(commaIdx + 1);
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dec = decodeWavMonoJs(bytes.buffer);
      if (!dec) return false;
      return applyUserIrMono(slot, fileName, dec.mono, dec.sampleRate);
    } catch (_) {
      return false;
    }
  }

  function openUserIrPicker(slot) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.wav,audio/wav';
      inp.style.display = 'none';
      const maxIrBytes = 16 * 1024 * 1024;
      inp.addEventListener('cancel', () => {
        inp.remove();
        resolve(null);
      });
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) { resolve(null); return; }
        if (f.size < 44 || f.size > maxIrBytes) { resolve(false); return; }
        try {
          const ab = await f.arrayBuffer();
          const dec = decodeWavMonoJs(ab);
          if (!dec) { resolve(false); return; }
          resolve(applyUserIrMono(slot, f.name, dec.mono, dec.sampleRate));
        } catch (_) {
          resolve(false);
        }
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  const eventListeners = new Map();
  const emitBackend = (name, payload) => {
    for (const cb of eventListeners.get(name) || []) cb(payload);
  };
  window.__JUCE__ = {
    backend: {
      addEventListener: (name, cb) => {
        if (!eventListeners.has(name)) eventListeners.set(name, []);
        eventListeners.get(name).push(cb);
        if (name === 'telemetry') {
          setTimeout(() => syncUiEngineAndEmit(), 20);
        }
      },
      emitEvent: (name, payload) => {
        if (name === 'requestTelemetry') {
          syncUiEngineAndEmit();
        }
      },
    },
  };

  // ==========================================================================
  // Unpack 276-float Wasm telemetry buffer into the UI's telemetry JSON object
  // ==========================================================================
  function unpackTelemetry(f32, offset = 0) {
    const curveDb          = new Array(CURVE_POINTS);
    const curveCabADb      = new Array(CURVE_POINTS);
    const curveCabBDb      = new Array(CURVE_POINTS);
    const curveImpedanceDb = new Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) {
      curveDb[i]          = f32[offset + 20  + i];
      curveCabADb[i]      = f32[offset + 84  + i];
      curveCabBDb[i]      = f32[offset + 148 + i];
      curveImpedanceDb[i] = f32[offset + 212 + i];
    }
    return {
      plateBPlusVolts:    f32[offset + 0],
      screenBPlusVolts:   f32[offset + 1],
      sagReductionDb:     f32[offset + 2],
      v1AnodeTempC:       f32[offset + 3],
      coldClipperTempC:   f32[offset + 4],
      powerTubeTempC:     f32[offset + 5],
      voiceCoilTempC:     f32[offset + 6],
      coneExcursionMm:    f32[offset + 7],
      effectiveFsHz:      f32[offset + 8],
      effectiveQts:       f32[offset + 9],
      effectiveLeRatio:   f32.length >= offset + 280 ? f32[offset + 276] : 1.0,
      micProximityGainDb: f32[offset + 10],
      micOffAxisCutoffHz: f32[offset + 11],
      impRatio:           f32[offset + 12],
      dualCabActive:      f32[offset + 13] >= 0.5,
      lowChugEnv:         f32.length >= offset + 280 ? f32[offset + 277] : 0.0,
      midRiffEnv:         f32.length >= offset + 280 ? f32[offset + 278] : 0.0,
      hiPickEnv:          f32.length >= offset + 280 ? f32[offset + 279] : 0.0,
      inPeakDb:           f32[offset + 14],
      outPeakDb:          f32[offset + 15],
      gateDepthDb:        f32[offset + 16],
      inClip:             f32[offset + 17] >= 0.5,
      outClip:            f32[offset + 18] >= 0.5,
      curveDb,
      curveCabADb,
      curveCabBDb,
      curveImpedanceDb,
      cabACustomIr:     typeof userIrState !== 'undefined' && !!(userIrState && userIrState[0].active),
      cabACustomIrName: typeof userIrState !== 'undefined' && userIrState ? userIrState[0].name : '',
      cabACustomIrWave: typeof userIrState !== 'undefined' && userIrState ? userIrState[0].wave : [],
      cabBCustomIr:     typeof userIrState !== 'undefined' && !!(userIrState && userIrState[1].active),
      cabBCustomIrName: typeof userIrState !== 'undefined' && userIrState ? userIrState[1].name : '',
      cabBCustomIrWave: typeof userIrState !== 'undefined' && userIrState ? userIrState[1].wave : [],
    };
  }

  // ==========================================================================
  // Load & instantiate wdcab.wasm (UI instance for instant curve preview +
  // AudioWorklet instance for real-time audio & dynamic telemetry)
  // ==========================================================================
  const stubImports = module => {
    const imports = {};
    for (const d of WebAssembly.Module.imports(module)) {
      imports[d.module] = imports[d.module] || {};
      imports[d.module][d.name] = d.kind === 'function' ? () => 0 : undefined;
    }
    return imports;
  };

  let modulePromise = null;
  function getWasmModule() {
    if (!modulePromise) {
      modulePromise = fetch('./wdcab.wasm')
        .then(r => {
          if (!r || !r.ok) throw new Error('Failed to fetch wdcab.wasm');
          return r.arrayBuffer();
        })
        .then(bytes => WebAssembly.compile(bytes))
        .catch(err => {
          modulePromise = null;
          throw err;
        });
    }
    return modulePromise;
  }

  const uiEngine = { wasm: null, telemPtr: 0, fs: 48000 };
  let pendingStatusError = null;
  function initUiWasmEngine() {
    return getWasmModule()
      .then(m => WebAssembly.instantiate(m, stubImports(m)))
      .then(instance => {
        uiEngine.wasm = instance.exports;
        uiEngine.wasm.wdcab_init(uiEngine.fs);
        uiEngine.telemPtr = uiEngine.wasm.wdcab_telem() >> 2;
        syncUiEngineAndEmit();
      })
      .catch(err => {
        const text = formatAudioError(err);
        if (statusEl) {
          statusEl.textContent = text;
        } else {
          pendingStatusError = text;
        }
      });
  }
  initUiWasmEngine();

  function syncUiEngineAndEmit() {
    if (!uiEngine.wasm) return;
    for (let i = 0; i < NUM_PARAMS; i++) {
      uiEngine.wasm.wdcab_set_param(i, rawParams[i]);
    }
    uiEngine.wasm.wdcab_apply();
    uiEngine.wasm.wdcab_update_telemetry();
    const f32 = new Float32Array(uiEngine.wasm.memory.buffer);
    emitBackend('telemetry', unpackTelemetry(f32, uiEngine.telemPtr));
  }

  let syncPending = false;
  function scheduleSync() {
    if (syncPending) return;
    syncPending = true;
    queueMicrotask(() => {
      syncPending = false;
      if (audio.node) {
        audio.node.port.postMessage({ type: 'controls', params: new Float64Array(rawParams) });
      }
      if (!audio.playing) {
        syncUiEngineAndEmit();
      }
    });
  }

  // ==========================================================================
  // Built-in Clips (Super Lead Mid-Gain & NTS High-Gain) + WebAudio Transport
  // ==========================================================================
  const CLIPS = [
    { id: 'super_lead', label: 'MID GAIN · SUPER LEAD', url: './audio/super_lead.wav', desc: 'Super Lead (Mid-Gain Amp Send)' },
    { id: 'nts',        label: 'HIGH GAIN · NTS',       url: './audio/nts.wav',        desc: 'NTS (High-Gain Amp Send)' },
  ];

  // Raw ArrayBuffer prefetch cache so decoding is instantaneous on click
  const rawClipBytes = new Map();
  const decodedBuffers = new Map();
  CLIPS.forEach(c => {
    fetch(c.url)
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(buf => { if (buf) rawClipBytes.set(c.id, buf); })
      .catch(() => {});
  });

  const audio = {
    ctx: null,
    node: null,
    master: null,
    ready: false,
    starting: false,
    initPromise: null,
    playRequestId: 0,
    resetSeq: 0,
    fadingNodes: new Set(),
    activeSource: null,
    activeGain: null,
    activeClipId: 'super_lead',
    customBuffer: null,
    customName: '',
    playing: false,
    playStartCtxTime: 0,
    playStartOffset: 0,
    volPct: 85,
  };

  const volLinear = () => Math.pow(audio.volPct / 100, 1.65);
  const MAX_CUSTOM_WAV_BYTES = 200 * 1024 * 1024;

  function downmixToStereoBuffer(ctx, decoded) {
    if (!decoded || typeof decoded.getChannelData !== 'function') {
      return decoded;
    }
    const inCh = decoded.numberOfChannels || 0;
    if (inCh <= 2) {
      for (let ch = 0; ch < inCh; ch++) {
        const data = decoded.getChannelData(ch);
        if (!data) continue;
        for (let i = 0; i < data.length; i++) {
          if (!Number.isFinite(data[i])) {
            data[i] = 0.0;
          }
        }
      }
      return decoded;
    }
    if (!ctx || typeof ctx.createBuffer !== 'function') {
      return decoded;
    }
    const len  = decoded.length;
    const out  = ctx.createBuffer(2, len, decoded.sampleRate);
    const outL = out.getChannelData(0);
    const outR = out.getChannelData(1);
    const scale = 1.0 / Math.sqrt(Math.ceil(inCh * 0.5));
    const oddLast = (inCh & 1) === 1;
    for (let ch = 0; ch < inCh; ch++) {
      const src = decoded.getChannelData(ch);
      if (!src) continue;
      const n = Math.min(len, src.length);
      if (oddLast && ch === inCh - 1) {
        const cGain = scale * Math.SQRT1_2;
        for (let i = 0; i < n; i++) {
          const raw = src[i];
          const s = Number.isFinite(raw) ? raw : 0.0;
          const v = s * cGain;
          outL[i] += v;
          outR[i] += v;
        }
      } else if ((ch & 1) === 0) {
        for (let i = 0; i < n; i++) {
          const raw = src[i];
          const s = Number.isFinite(raw) ? raw : 0.0;
          outL[i] += s * scale;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const raw = src[i];
          const s = Number.isFinite(raw) ? raw : 0.0;
          outR[i] += s * scale;
        }
      }
    }
    return out;
  }

  function resetMeterUI() {
    const el = id => (document && typeof document.getElementById === 'function') ? document.getElementById(id) : null;
    const inBar     = el('inBar');
    const outBar    = el('outBar');
    const gateBar   = el('gateBar');
    const inMeter   = el('inMeter');
    const outMeter  = el('outMeter');
    const gateMeter = el('gateMeter');
    const inPill    = el('inPill');
    const outPill   = el('outPill');
    const inStatus  = el('inStatus');
    const outStatus = el('outStatus');
    if (inBar)     { inBar.style.width = '0%';  inBar.style.background = 'var(--ryo-blue)'; }
    if (outBar)    { outBar.style.width = '0%'; outBar.style.background = 'var(--bocchi-pink)'; }
    if (gateBar)   { gateBar.style.width = '0%'; }
    if (inMeter)   { inMeter.textContent = '-inf'; }
    if (outMeter)  { outMeter.textContent = '-inf'; }
    if (gateMeter) { gateMeter.textContent = '0.0 dB'; }
    if (inPill && inPill.classList)   { inPill.classList.remove('clip'); }
    if (outPill && outPill.classList) { outPill.classList.remove('clip'); }
    if (inStatus)  { inStatus.textContent = 'OK';  inStatus.className = 'lvl-tag'; }
    if (outStatus) { outStatus.textContent = 'OK'; outStatus.className = 'lvl-tag'; }
  }

  function formatAudioError(err) {
    const raw = (err && typeof err === 'object' && err.message)
      ? String(err.message)
      : String(err || 'Audio initialization failed');
    const trimmed = raw.trim() || 'Audio initialization failed';
    return trimmed.startsWith('Audio error:') ? trimmed : `Audio error: ${trimmed}`;
  }

  function handleWorkletRuntimeError(errText, targetCtx, targetNode, targetMaster) {
    if (audio.node && targetNode && audio.node !== targetNode) return;
    if (targetNode && targetNode.port) {
      try { targetNode.port.onmessage = null; } catch (_) {}
    }
    if (targetNode) {
      try { targetNode.onprocessorerror = null; } catch (_) {}
    }
    if (audio.node === targetNode) audio.node = null;
    if (audio.master === targetMaster) audio.master = null;
    audio.ready = false;
    audio.starting = false;
    audio.initPromise = null;

    stopPlayback(false);

    if (targetNode) {
      try { targetNode.disconnect(); } catch (_) {}
    }
    if (targetMaster) {
      try { targetMaster.disconnect(); } catch (_) {}
    }
    if (targetCtx && typeof targetCtx.close === 'function') {
      try { targetCtx.close(); } catch (_) {}
    }
    if (audio.ctx === targetCtx) audio.ctx = null;

    if (statusEl) {
      statusEl.textContent = formatAudioError(errText);
    }
  }

  async function ensureAudio() {
    if (!audio.node || !audio.ready) {
      if (!audio.initPromise) {
        audio.initPromise = (async () => {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          let ctx = null;
          let node = null;
          let master = null;
          try {
            try {
              ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
            } catch (_) {
              try {
                ctx = new AudioCtx({ latencyHint: 'interactive' });
              } catch (_2) {
                ctx = new AudioCtx();
              }
            }
            audio.ctx = ctx;
            audio.ready = false;
            uiEngine.fs = ctx.sampleRate;
            if (uiEngine.wasm) {
              uiEngine.wasm.wdcab_init(uiEngine.fs);
              syncUiEngineAndEmit();
            }
            await ctx.audioWorklet.addModule('./worklet.js');
            const module = await getWasmModule();
            const initResetSeq = audio.resetSeq || 0;
            node = new AudioWorkletNode(ctx, 'wd-cab', {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [2],
              processorOptions: { module, resetSeq: initResetSeq },
            });
            master = ctx.createGain();
            master.gain.value = volLinear();
            node.connect(master);
            master.connect(ctx.destination);

            let readySettled = false;
            const readyPromise = new Promise((resolveReady, rejectReady) => {
              const readyTimer = setTimeout(() => {
                if (readySettled) return;
                readySettled = true;
                rejectReady(new Error('AudioWorklet initialization timed out'));
              }, 5000);

              node.onprocessorerror = ev => {
                const msgText = (ev && ev.message) ? String(ev.message) : 'AudioWorklet processor error';
                if (!readySettled) {
                  readySettled = true;
                  clearTimeout(readyTimer);
                  rejectReady(new Error(msgText));
                } else {
                  handleWorkletRuntimeError(msgText, ctx, node, master);
                }
              };

              node.port.onmessage = e => {
                const msg = e && e.data;
                if (!msg) return;
                if (msg.type === 'ready') {
                  audio.ready = true;
                  node.port.postMessage({ type: 'controls', params: new Float64Array(rawParams) });
                  if (!readySettled) {
                    readySettled = true;
                    clearTimeout(readyTimer);
                    resolveReady();
                  }
                } else if (msg.type === 'error') {
                  const errText = (msg.error && String(msg.error).trim())
                    ? String(msg.error).trim()
                    : 'AudioWorklet initialization failed';
                  if (!readySettled) {
                    readySettled = true;
                    clearTimeout(readyTimer);
                    rejectReady(new Error(errText));
                  } else {
                    handleWorkletRuntimeError(errText, ctx, node, master);
                  }
                } else if (msg.type === 'telemetry' && msg.data) {
                  if (typeof msg.resetSeq === 'number' && msg.resetSeq < audio.resetSeq) {
                    return;
                  }
                  if (audio.playing) {
                    emitBackend('telemetry', unpackTelemetry(msg.data, 0));
                  }
                }
              };
            });

            if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
              await ctx.resume();
            }
            await readyPromise;

            audio.master = master;
            audio.node = node;
            node.port.postMessage({ type: 'controls', params: new Float64Array(rawParams) });
            for (let slot = 0; slot < 2; slot++) {
              if (userIrState[slot] && userIrState[slot].active && userIrState[slot].mono) {
                node.port.postMessage({
                  type: 'loadUserIr',
                  slot,
                  samples: userIrState[slot].mono.slice(),
                  sampleRate: userIrState[slot].sampleRate,
                });
              }
            }
            if ((audio.resetSeq || 0) !== initResetSeq) {
              node.port.postMessage({ type: 'reset', resetSeq: audio.resetSeq });
            }
          } catch (err) {
            if (node && node.port) {
              try { node.port.onmessage = null; } catch (_) {}
            }
            if (node) {
              try { node.onprocessorerror = null; } catch (_) {}
              try { node.disconnect(); } catch (_) {}
            }
            if (master) {
              try { master.disconnect(); } catch (_) {}
            }
            try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (_) {}
            audio.ctx = null;
            audio.node = null;
            audio.master = null;
            audio.ready = false;
            audio.starting = false;
            audio.initPromise = null;
            if (statusEl) {
              statusEl.textContent = formatAudioError(err);
            }
            throw err;
          }
        })();
      }
      await audio.initPromise;
    }
    if (audio.ctx && (audio.ctx.state === 'suspended' || audio.ctx.state === 'interrupted')) {
      await audio.ctx.resume();
    }
  }

  async function getClipBuffer(clipId) {
    if (clipId === 'custom') {
      return (audio.customBuffer && audio.customBuffer.duration > 0) ? audio.customBuffer : null;
    }
    if (decodedBuffers.has(clipId)) return decodedBuffers.get(clipId);
    const clip = CLIPS.find(c => c.id === clipId) || CLIPS[0];
    let bytes = rawClipBytes.get(clip.id);
    try {
      if (!bytes || !(bytes.byteLength > 0)) {
        const resp = await fetch(clip.url);
        if (!resp || !resp.ok) return null;
        bytes = await resp.arrayBuffer();
        if (!bytes || !(bytes.byteLength > 0)) return null;
      }
      // Slice copy because decodeAudioData detaches the ArrayBuffer
      const copy = bytes.slice(0);
      const decoded = await audio.ctx.decodeAudioData(copy);
      if (!decoded || !(decoded.duration > 0)) {
        rawClipBytes.delete(clip.id);
        return null;
      }
      const stereoDecoded = downmixToStereoBuffer(audio.ctx, decoded);
      rawClipBytes.set(clip.id, bytes);
      decodedBuffers.set(clip.id, stereoDecoded);
      return stereoDecoded;
    } catch (_) {
      rawClipBytes.delete(clip.id);
      return null;
    }
  }

  function currentBuffer() {
    if (audio.activeClipId === 'custom' && audio.customBuffer) return audio.customBuffer;
    return decodedBuffers.get(audio.activeClipId) || null;
  }

  function currentPlayheadSec() {
    const buf = currentBuffer();
    const dur = (buf && Number.isFinite(buf.duration) && buf.duration > 0) ? buf.duration : 11.3;
    const baseOffset = Number.isFinite(audio.playStartOffset) ? audio.playStartOffset : 0;
    if (!audio.playing || !audio.ctx) {
      return ((baseOffset % dur) + dur) % dur;
    }
    const elapsed = Math.max(0, audio.ctx.currentTime - audio.playStartCtxTime);
    return (((baseOffset + elapsed) % dur) + dur) % dur;
  }

  function stopActiveSource() {
    if (audio.activeSource) {
      try { audio.activeSource.onended = null; } catch (_) {}
      try { audio.activeSource.stop(); } catch (_) {}
      try { audio.activeSource.disconnect(); } catch (_) {}
      audio.activeSource = null;
    }
    if (audio.activeGain) {
      try { audio.activeGain.disconnect(); } catch (_) {}
      audio.activeGain = null;
    }
    for (const entry of Array.from(audio.fadingNodes)) {
      if (entry.src) {
        try { entry.src.stop(); } catch (_) {}
      }
      entry.cleanup();
    }
  }

  function stopPlayback(resetOffset = false) {
    audio.playRequestId++;
    audio.starting = false;
    audio.resetSeq = (audio.resetSeq || 0) + 1;
    if (audio.activeSource && !resetOffset) {
      audio.playStartOffset = currentPlayheadSec();
    }
    stopActiveSource();
    if (resetOffset || !Number.isFinite(audio.playStartOffset)) audio.playStartOffset = 0;
    audio.playing = false;
    if (audio.node && audio.node.port) {
      try { audio.node.port.postMessage({ type: 'reset', resetSeq: audio.resetSeq }); } catch (_) {}
    }
    if (uiEngine.wasm) {
      uiEngine.wasm.wdcab_reset();
    }
    resetMeterUI();
    updateTransportUI();
    syncUiEngineAndEmit();
  }

  async function startPlayback(offsetSec = null, crossfadeMs = 18) {
    const reqId = ++audio.playRequestId;
    audio.starting = true;
    updateTransportUI(true);
    try {
      await ensureAudio();
      if (reqId !== audio.playRequestId || !audio.node || !audio.ctx) return;
      let buf = null;
      try {
        buf = await getClipBuffer(audio.activeClipId);
      } catch (_) {
        buf = null;
      }
      if (reqId !== audio.playRequestId) return;

      const dur = (buf && Number.isFinite(buf.duration) && buf.duration > 0) ? buf.duration : 0;
      const rawOffset = (offsetSec !== null && Number.isFinite(offsetSec))
        ? offsetSec
        : (Number.isFinite(audio.playStartOffset) ? audio.playStartOffset : 0);
      const startOffset = dur > 0 ? ((rawOffset % dur) + dur) % dur : 0;
      if (!buf || !(dur > 0)) {
        stopActiveSource();
        audio.playStartOffset = 0;
        audio.playing = false;
        audio.starting = false;
        updateTransportUI();
        if (statusEl) {
          statusEl.textContent = 'Clip load failed: ' + audio.activeClipId;
        }
        return;
      }

      const now = audio.ctx.currentTime;
      const oldSource = audio.activeSource;
      const oldGain   = audio.activeGain;
      const fadeSec   = Math.max(0.005, crossfadeMs / 1000);

      const src  = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      src.buffer = buf;
      src.loop   = true;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(1.0, now + fadeSec);

      src.connect(gain);
      gain.connect(audio.node);
      src.start(now, startOffset);

      if (oldSource || oldGain) {
        const entry = {
          src: oldSource,
          gain: oldGain,
          cleanup() {
            audio.fadingNodes.delete(entry);
            if (oldSource) {
              try { oldSource.onended = null; } catch (_) {}
              try { oldSource.disconnect(); } catch (_) {}
            }
            if (oldGain) {
              try { oldGain.disconnect(); } catch (_) {}
            }
          },
        };
        audio.fadingNodes.add(entry);
        if (oldSource) {
          oldSource.onended = () => entry.cleanup();
        }
        if (oldGain && oldGain.gain) {
          try {
            oldGain.gain.cancelScheduledValues(now);
            oldGain.gain.setValueAtTime(oldGain.gain.value, now);
            oldGain.gain.linearRampToValueAtTime(0.0, now + fadeSec);
          } catch (_) {}
        }
        if (oldSource) {
          try {
            oldSource.stop(now + fadeSec + 0.01);
          } catch (_) {
            entry.cleanup();
          }
        } else {
          entry.cleanup();
        }
      }

      audio.activeSource     = src;
      audio.activeGain       = gain;
      audio.playStartCtxTime = now;
      audio.playStartOffset  = startOffset;
      audio.playing          = true;
      audio.starting         = false;

      // Warm-decode the sibling clip in the background for zero-latency Mid/High gain switching
      CLIPS.forEach(c => {
        if (c.id !== audio.activeClipId && !decodedBuffers.has(c.id)) {
          getClipBuffer(c.id).catch(() => {});
        }
      });

      updateTransportUI();
    } catch (err) {
      if (reqId === audio.playRequestId) {
        stopActiveSource();
        audio.playing = false;
        audio.starting = false;
        updateTransportUI();
        if (statusEl) {
          statusEl.textContent = formatAudioError(err);
        }
      }
    } finally {
      if (reqId === audio.playRequestId) {
        audio.starting = false;
        if (playBtn) {
          playBtn.classList.toggle('playing', audio.playing);
          playBtn.innerHTML = audio.playing
            ? '<span class="wt-ico">■</span> STOP'
            : '<span class="wt-ico">▶</span> PLAY LOOP';
        }
      }
    }
  }

  async function selectClip(clipId) {
    const wasPlaying = audio.playing || audio.starting;
    const curPos = currentPlayheadSec();
    audio.activeClipId = clipId;
    updateTransportUI();
    if (wasPlaying) {
      await startPlayback(curPos, 20);
    } else {
      const reqId = ++audio.playRequestId;
      try {
        await ensureAudio();
        if (reqId !== audio.playRequestId || audio.activeClipId !== clipId) return;
        let buf = null;
        try {
          buf = await getClipBuffer(clipId);
        } catch (_) {
          buf = null;
        }
        if (reqId !== audio.playRequestId || audio.activeClipId !== clipId) return;
        if (!buf || !(buf.duration > 0)) {
          stopActiveSource();
          audio.playing = false;
          audio.starting = false;
          updateTransportUI();
          if (statusEl) {
            statusEl.textContent = 'Clip load failed: ' + clipId;
          }
          return;
        }
        const dur = (buf && Number.isFinite(buf.duration) && buf.duration > 0) ? buf.duration : 11.3;
        audio.playStartOffset = Math.min(curPos, dur);
        updateTransportUI();
      } catch (err) {
        if (reqId === audio.playRequestId) {
          stopActiveSource();
          audio.playing = false;
          audio.starting = false;
          updateTransportUI();
          if (statusEl) {
            statusEl.textContent = 'Clip load failed: ' + (err && err.message ? err.message : clipId);
          }
        }
      }
    }
  }

  async function seekPlayback(pct) {
    const clampedPct = Math.max(0, Math.min(1, Number(pct) || 0));
    const wasPlaying = audio.playing || audio.starting;
    const clipId = audio.activeClipId;
    const reqId = ++audio.playRequestId;
    if (wasPlaying) {
      audio.starting = true;
      updateTransportUI(true);
    }
    try {
      await ensureAudio();
      if (reqId !== audio.playRequestId || audio.activeClipId !== clipId) return;
      let buf = null;
      try {
        buf = await getClipBuffer(clipId);
      } catch (_) {
        buf = null;
      }
      if (reqId !== audio.playRequestId || audio.activeClipId !== clipId) return;
      if (!buf || !(buf.duration > 0)) {
        stopActiveSource();
        audio.playing = false;
        audio.starting = false;
        updateTransportUI();
        if (statusEl) {
          statusEl.textContent = 'Clip load failed: ' + clipId;
        }
        return;
      }
      const targetSec = clampedPct * buf.duration;
      audio.playStartOffset = targetSec;
      if (wasPlaying) {
        await startPlayback(targetSec, 12);
      } else {
        updateTransportUI();
      }
    } catch (err) {
      if (reqId === audio.playRequestId) {
        stopActiveSource();
        audio.playing = false;
        audio.starting = false;
        updateTransportUI();
        if (statusEl) {
          statusEl.textContent = formatAudioError(err);
        }
      }
    }
  }

  // ==========================================================================
  // Curated Rig Presets (Applies via host states so all knobs/stages redraw)
  // ==========================================================================
  const RIG_PRESETS = [
    {
      name: 'Studio Blend · Modern 4x12 (57/73) + Vintage 4x12 (121/12)',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 2, cabBoxScale: 1.0, cabConeDamp: 1.0, cabALoResDb: 0.0, cabAHiResDb: 0.0, cabAHpfHz: 20, cabALpfHz: 20000, cabAPan: -0.25, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 2.5, micOffAxis: 12, micConePos: 0.35, micDrive: 0.0, micPreDrive: 0.0, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 1, cabBBoxScale: 1.0, cabBConeDamp: 1.0, cabBLoResDb: 0.0, cabBHiResDb: 0.0, cabBHpfHz: 20, cabBLpfHz: 20000, cabBPan: 0.25, cabBLevelDb: 0.0,
        micBEnabled: true, micBModel: 1, micBDistCm: 2.5, micBOffAxis: 10, micBConePos: 0.40, micBDrive: 0.0, micBPreDrive: 0.0, micBPhase: false, micBPreModel: 2,
        inputCal: 0.0, masterVol: 0.55, impRatio: 1.00, powerScaleW: 50, depth: 0.50, presence: 0.50, nfbAmount: 0.55,
        roomEnabled: true, roomType: 1, roomPanMode: 0, roomSize: 1.0, roomDistM: 2.2, roomDamp: 0.45, roomWidth: 0.80, roomLevel: 0.28, outputDb: 0.0
      }
    },
    {
      name: 'Tight Modern Metal · Oversized 4x12 (57/12) + Modern 4x12 (421/73)',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 3, cabBoxScale: 1.02, cabConeDamp: 1.08, cabALoResDb: 0.8, cabAHiResDb: 0.6, cabAHpfHz: 65, cabALpfHz: 11500, cabAPan: -0.35, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 1.5, micOffAxis: 8, micConePos: 0.30, micDrive: 2.5, micPreDrive: 3.0, micPhase: false, micPreModel: 2,
        cabBEnabled: true, cabBModel: 2, cabBBoxScale: 1.0, cabBConeDamp: 1.05, cabBLoResDb: 0.5, cabBHiResDb: 0.4, cabBHpfHz: 65, cabBLpfHz: 12000, cabBPan: 0.35, cabBLevelDb: -1.0,
        micBEnabled: true, micBModel: 3, micBDistCm: 2.0, micBOffAxis: 14, micBConePos: 0.36, micBDrive: 2.0, micBPreDrive: 2.5, micBPhase: false, micBPreModel: 1,
        inputCal: 0.0, masterVol: 0.68, impRatio: 1.00, powerScaleW: 100, depth: 0.58, presence: 0.56, nfbAmount: 0.68,
        roomEnabled: true, roomType: 0, roomPanMode: 0, roomSize: 0.85, roomDistM: 1.4, roomDamp: 0.55, roomWidth: 0.65, roomLevel: 0.14, outputDb: 0.0
      }
    },
    {
      name: 'Plexi Greenback Stack · Vintage 4x12 (57/REDD + 121/76)',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 1, cabBoxScale: 1.0, cabConeDamp: 0.88, cabALoResDb: 0.6, cabAHiResDb: 1.2, cabAHpfHz: 40, cabALpfHz: 14000, cabAPan: -0.20, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 2.0, micOffAxis: 15, micConePos: 0.34, micDrive: 4.0, micPreDrive: 5.5, micPhase: false, micPreModel: 4,
        cabBEnabled: true, cabBModel: 1, cabBBoxScale: 1.0, cabBConeDamp: 0.90, cabBLoResDb: 1.0, cabBHiResDb: 0.0, cabBHpfHz: 40, cabBLpfHz: 14000, cabBPan: 0.20, cabBLevelDb: -1.5,
        micBEnabled: true, micBModel: 1, micBDistCm: 3.5, micBOffAxis: 6, micBConePos: 0.44, micBDrive: 3.5, micBPreDrive: 4.5, micBPhase: false, micBPreModel: 3,
        inputCal: 0.0, masterVol: 0.74, impRatio: 1.25, powerScaleW: 25, depth: 0.52, presence: 0.54, nfbAmount: 0.42,
        roomEnabled: true, roomType: 1, roomPanMode: 1, roomSize: 1.08, roomDistM: 2.6, roomDamp: 0.38, roomWidth: 0.85, roomLevel: 0.32, outputDb: 0.0
      }
    },
    {
      name: 'Cranked Motor & Cone Cry · Loose 16Ω Hi-Z + Undoped Cone',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 2, cabBoxScale: 0.98, cabConeDamp: 0.74, cabALoResDb: 1.5, cabAHiResDb: 2.2, cabAHpfHz: 35, cabALpfHz: 16000, cabAPan: -0.25, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 1.2, micOffAxis: 10, micConePos: 0.32, micDrive: 6.0, micPreDrive: 6.0, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 4, cabBBoxScale: 1.0, cabBConeDamp: 0.76, cabBLoResDb: 1.2, cabBHiResDb: 1.8, cabBHpfHz: 35, cabBLpfHz: 16000, cabBPan: 0.25, cabBLevelDb: -1.0,
        micBEnabled: true, micBModel: 2, micBDistCm: 3.0, micBOffAxis: 12, micBConePos: 0.38, micBDrive: 4.0, micBPreDrive: 5.0, micBPhase: false, micBPreModel: 3,
        inputCal: 3.0, masterVol: 0.92, impRatio: 1.80, powerScaleW: 15, depth: 0.68, presence: 0.62, nfbAmount: 0.22,
        roomEnabled: true, roomType: 1, roomPanMode: 0, roomSize: 1.05, roomDistM: 2.4, roomDamp: 0.40, roomWidth: 0.82, roomLevel: 0.28, outputDb: 0.0
      }
    },
    {
      name: 'Live Studio Room + Boundary Wall Mic · Ambient Chamber',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 2, cabBoxScale: 1.0, cabConeDamp: 1.0, cabALoResDb: 0.5, cabAHiResDb: 0.5, cabAHpfHz: 30, cabALpfHz: 18000, cabAPan: -0.35, cabALevelDb: 0.0,
        micEnabled: true, micModel: 4, micDistCm: 35.0, micOffAxis: 10, micConePos: 0.35, micDrive: 0.0, micPreDrive: 3.0, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 1, cabBBoxScale: 1.0, cabBConeDamp: 1.0, cabBLoResDb: 0.5, cabBHiResDb: 0.5, cabBHpfHz: 30, cabBLpfHz: 18000, cabBPan: 0.35, cabBLevelDb: 0.0,
        micBEnabled: true, micBModel: 2, micBDistCm: 25.0, micBOffAxis: 15, micBConePos: 0.40, micBDrive: 0.0, micBPreDrive: 3.0, micBPhase: false, micBPreModel: 4,
        inputCal: 0.0, masterVol: 0.65, impRatio: 1.00, powerScaleW: 50, depth: 0.55, presence: 0.55, nfbAmount: 0.50,
        roomEnabled: true, roomType: 2, roomPanMode: 1, roomSize: 1.22, roomDistM: 3.1, roomDamp: 0.32, roomWidth: 0.92, roomLevel: 0.78, outputDb: 1.5
      }
    },
    {
      name: 'Boutique Alnico Chime · 2x12 Alnico (160/73) + 1x10 Tweed (414/12)',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 9, cabBoxScale: 1.0, cabConeDamp: 0.95, cabALoResDb: 0.4, cabAHiResDb: 0.6, cabAHpfHz: 35, cabALpfHz: 16500, cabAPan: -0.30, cabALevelDb: 0.0,
        micEnabled: true, micModel: 5, micDistCm: 3.0, micOffAxis: 8, micConePos: 0.38, micDrive: 0.0, micPreDrive: 2.0, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 10, cabBBoxScale: 1.0, cabBConeDamp: 1.0, cabBLoResDb: 0.0, cabBHiResDb: 0.5, cabBHpfHz: 45, cabBLpfHz: 16500, cabBPan: 0.30, cabBLevelDb: -1.5,
        micBEnabled: true, micBModel: 7, micBDistCm: 4.5, micBOffAxis: 12, micBConePos: 0.42, micBDrive: 0.0, micBPreDrive: 1.5, micBPhase: false, micBPreModel: 2,
        inputCal: 0.0, masterVol: 0.62, impRatio: 1.15, powerScaleW: 30, depth: 0.48, presence: 0.56, nfbAmount: 0.45,
        roomEnabled: true, roomType: 1, roomPanMode: 0, roomSize: 1.05, roomDistM: 2.3, roomDamp: 0.40, roomWidth: 0.85, roomLevel: 0.34, roomSmash: 0.15, outputDb: 0.0
      }
    },
    {
      name: 'Tweed Combo Push · 1x10 Tweed (906/REDD) + Open 1x12 (160/76)',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 10, cabBoxScale: 0.98, cabConeDamp: 0.86, cabALoResDb: 0.8, cabAHiResDb: 1.0, cabAHpfHz: 45, cabALpfHz: 14000, cabAPan: -0.22, cabALevelDb: 0.0,
        micEnabled: true, micModel: 6, micDistCm: 1.8, micOffAxis: 10, micConePos: 0.30, micDrive: 3.0, micPreDrive: 5.0, micPhase: false, micPreModel: 4,
        cabBEnabled: true, cabBModel: 0, cabBBoxScale: 1.0, cabBConeDamp: 0.92, cabBLoResDb: 0.5, cabBHiResDb: 0.0, cabBHpfHz: 45, cabBLpfHz: 15000, cabBPan: 0.22, cabBLevelDb: -1.5,
        micBEnabled: true, micBModel: 5, micBDistCm: 3.2, micBOffAxis: 14, micBConePos: 0.42, micBDrive: 2.0, micBPreDrive: 4.0, micBPhase: false, micBPreModel: 3,
        inputCal: 0.0, masterVol: 0.78, impRatio: 1.30, powerScaleW: 18, depth: 0.50, presence: 0.58, nfbAmount: 0.32,
        roomEnabled: true, roomType: 1, roomPanMode: 0, roomSize: 0.96, roomDistM: 1.9, roomDamp: 0.44, roomWidth: 0.78, roomLevel: 0.30, roomSmash: 0.25, outputDb: 0.0
      }
    },
    {
      name: 'Ported Thump Rig · 1x12 Ported (57/12) + Modern 4x12 (160/73)',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 11, cabBoxScale: 1.02, cabConeDamp: 1.05, cabALoResDb: 1.2, cabAHiResDb: 0.4, cabAHpfHz: 50, cabALpfHz: 13000, cabAPan: -0.28, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 2.0, micOffAxis: 10, micConePos: 0.33, micDrive: 1.5, micPreDrive: 2.5, micPhase: false, micPreModel: 2,
        cabBEnabled: true, cabBModel: 2, cabBBoxScale: 1.0, cabBConeDamp: 1.02, cabBLoResDb: 0.6, cabBHiResDb: 0.6, cabBHpfHz: 55, cabBLpfHz: 13500, cabBPan: 0.28, cabBLevelDb: -0.5,
        micBEnabled: true, micBModel: 5, micBDistCm: 2.8, micBOffAxis: 8, micBConePos: 0.38, micBDrive: 1.0, micBPreDrive: 2.0, micBPhase: false, micBPreModel: 1,
        inputCal: 0.0, masterVol: 0.66, impRatio: 1.05, powerScaleW: 60, depth: 0.56, presence: 0.54, nfbAmount: 0.60,
        roomEnabled: true, roomType: 0, roomPanMode: 0, roomSize: 0.90, roomDistM: 1.6, roomDamp: 0.55, roomWidth: 0.70, roomLevel: 0.20, roomSmash: 0.10, outputDb: 0.0
      }
    },
    {
      name: 'British 75W Roar · 4x12 Brit 75 (906/73) + Vintage 4x12 (414/12)',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 12, cabBoxScale: 1.0, cabConeDamp: 0.94, cabALoResDb: 0.5, cabAHiResDb: 0.8, cabAHpfHz: 55, cabALpfHz: 12500, cabAPan: -0.32, cabALevelDb: 0.0,
        micEnabled: true, micModel: 6, micDistCm: 1.6, micOffAxis: 11, micConePos: 0.32, micDrive: 2.5, micPreDrive: 3.5, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 1, cabBBoxScale: 1.0, cabBConeDamp: 0.96, cabBLoResDb: 0.8, cabBHiResDb: 0.2, cabBHpfHz: 55, cabBLpfHz: 13000, cabBPan: 0.32, cabBLevelDb: -1.0,
        micBEnabled: true, micBModel: 7, micBDistCm: 3.0, micBOffAxis: 12, micBConePos: 0.38, micBDrive: 1.5, micBPreDrive: 2.0, micBPhase: false, micBPreModel: 2,
        inputCal: 0.0, masterVol: 0.70, impRatio: 1.10, powerScaleW: 50, depth: 0.54, presence: 0.58, nfbAmount: 0.48,
        roomEnabled: true, roomType: 1, roomPanMode: 0, roomSize: 1.04, roomDistM: 2.2, roomDamp: 0.42, roomWidth: 0.82, roomLevel: 0.28, roomSmash: 0.20, outputDb: 0.0
      }
    },
    {
      name: 'Garage Thrash Smash · Tiled Garage + Duress Smash',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 12, cabBoxScale: 1.02, cabConeDamp: 1.04, cabALoResDb: 1.0, cabAHiResDb: 0.5, cabAHpfHz: 60, cabALpfHz: 12000, cabAPan: -0.35, cabALevelDb: 0.0,
        micEnabled: true, micModel: 3, micDistCm: 2.0, micOffAxis: 10, micConePos: 0.32, micDrive: 2.0, micPreDrive: 3.5, micPhase: false, micPreModel: 2,
        cabBEnabled: true, cabBModel: 3, cabBBoxScale: 1.0, cabBConeDamp: 1.05, cabBLoResDb: 0.6, cabBHiResDb: 0.6, cabBHpfHz: 60, cabBLpfHz: 12500, cabBPan: 0.35, cabBLevelDb: -1.0,
        micBEnabled: true, micBModel: 6, micBDistCm: 1.8, micBOffAxis: 12, micBConePos: 0.35, micBDrive: 2.0, micBPreDrive: 3.0, micBPhase: false, micBPreModel: 1,
        inputCal: 0.0, masterVol: 0.68, impRatio: 1.00, powerScaleW: 100, depth: 0.56, presence: 0.58, nfbAmount: 0.62,
        roomEnabled: true, roomType: 3, roomPanMode: 0, roomSize: 1.10, roomDistM: 2.8, roomDamp: 0.22, roomWidth: 0.90, roomLevel: 0.62, roomSmash: 0.85, outputDb: -1.0
      }
    },
    {
      name: 'SVT Arena Wall · 8x10 Sealed (47/73) + 1x15 Vintage (414/12)',
      vals: {
        powerTube: 0, power: true,
        cabEnabled: true, cabModel: 6, cabBoxScale: 1.02, cabConeDamp: 1.08, cabALoResDb: 1.5, cabAHiResDb: 0.0, cabAHpfHz: 30, cabALpfHz: 10500, cabAPan: -0.20, cabALevelDb: 0.0,
        micEnabled: true, micModel: 2, micDistCm: 4.0, micOffAxis: 6, micConePos: 0.42, micDrive: 1.0, micPreDrive: 3.0, micPhase: false, micPreModel: 1,
        cabBEnabled: true, cabBModel: 7, cabBBoxScale: 1.0, cabBConeDamp: 1.05, cabBLoResDb: 1.8, cabBHiResDb: -0.5, cabBHpfHz: 25, cabBLpfHz: 9500, cabBPan: 0.20, cabBLevelDb: -1.0,
        micBEnabled: true, micBModel: 7, micBDistCm: 5.0, micBOffAxis: 10, micBConePos: 0.45, micBDrive: 0.5, micBPreDrive: 2.5, micBPhase: false, micBPreModel: 2,
        inputCal: 0.0, masterVol: 0.72, impRatio: 1.05, powerScaleW: 120, depth: 0.62, presence: 0.45, nfbAmount: 0.65,
        roomEnabled: true, roomType: 2, roomPanMode: 1, roomSize: 1.18, roomDistM: 2.9, roomDamp: 0.35, roomWidth: 0.85, roomLevel: 0.26, roomSmash: 0.35, outputDb: 0.0
      }
    },
    {
      name: 'Lo-Fi Garage Cassette · 1x10 Tweed (57/Porta) + Garage Smash',
      vals: {
        powerTube: 1, power: true,
        cabEnabled: true, cabModel: 10, cabBoxScale: 0.96, cabConeDamp: 0.90, cabALoResDb: -0.5, cabAHiResDb: 1.2, cabAHpfHz: 85, cabALpfHz: 9500, cabAPan: 0.0, cabALevelDb: 0.0,
        micEnabled: true, micModel: 0, micDistCm: 3.5, micOffAxis: 18, micConePos: 0.45, micDrive: 5.0, micPreDrive: 8.5, micPhase: false, micPreModel: 5,
        cabBEnabled: false, cabBModel: 1, cabBBoxScale: 1.0, cabBConeDamp: 1.0, cabBLoResDb: 0.0, cabBHiResDb: 0.0, cabBHpfHz: 20, cabBLpfHz: 20000, cabBPan: 0.25, cabBLevelDb: 0.0,
        micBEnabled: true, micBModel: 1, micBDistCm: 2.5, micBOffAxis: 10, micBConePos: 0.40, micBDrive: 0.0, micBPreDrive: 0.0, micBPhase: false, micBPreModel: 2,
        inputCal: 0.0, masterVol: 0.76, impRatio: 1.20, powerScaleW: 15, depth: 0.42, presence: 0.60, nfbAmount: 0.35,
        roomEnabled: true, roomType: 3, roomPanMode: 0, roomSize: 0.92, roomDistM: 2.0, roomDamp: 0.30, roomWidth: 0.88, roomLevel: 0.55, roomSmash: 0.92, outputDb: -1.5
      }
    }
  ];

  function applyRigPreset(presetIdx) {
    const preset = RIG_PRESETS[presetIdx];
    if (!preset) return;
    clearUserIrSlot(0);
    clearUserIrSlot(1);
    for (const def of PARAM_LIST) {
      const val = Object.prototype.hasOwnProperty.call(preset.vals, def.id) ? preset.vals[def.id] : def.def;
      if (def.type === 'toggle') {
        host.toggleState(def.id).setValue(!!val);
      } else if (def.type === 'combo') {
        host.comboState(def.id).setChoiceIndex(val);
      } else if (def.type === 'slider') {
        host.sliderState(def.id).setNormalisedValue(toNorm(def, val));
      }
    }
    const uiPresetSel = document.getElementById('rigPresetSel');
    if (uiPresetSel && String(uiPresetSel.value) !== String(presetIdx)) {
      uiPresetSel.value = String(presetIdx);
    }
  }

  // ==========================================================================
  // Build Top Demo Transport Bar & Adjust #stage Viewport Fitting
  // ==========================================================================
  let playBtn, clipBtns = {}, scrubFill, scrubHead, scrubTime, statusEl, presetSel;

  function fmtSec(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${m}:${rem}`;
  }

  function updateTransportUI(preserveStatus = false) {
    if (!playBtn) return;
    const isEngaged = audio.playing || audio.starting;
    playBtn.classList.toggle('playing', isEngaged);
    playBtn.innerHTML = isEngaged
      ? '<span class="wt-ico">■</span> STOP'
      : '<span class="wt-ico">▶</span> PLAY LOOP';

    for (const [id, btn] of Object.entries(clipBtns)) {
      btn.classList.toggle('on', audio.activeClipId === id);
    }
    if (statusEl && !preserveStatus) {
      if (pendingStatusError) {
        statusEl.textContent = pendingStatusError;
      } else if (audio.activeClipId === 'custom') {
        statusEl.textContent = audio.customName || 'Custom Audio';
      } else {
        const c = CLIPS.find(x => x.id === audio.activeClipId);
        statusEl.textContent = c ? c.desc : '';
      }
    }
  }

  function fitStageWithBar() {
    const st = document.getElementById('stage');
    if (!st) return;
    const barH = 48;
    const vw = document.documentElement.clientWidth  || window.innerWidth  || 1180;
    const vh = Math.max(320, (document.documentElement.clientHeight || window.innerHeight || 808) - barH);
    const scale = Math.min((vw - 12) / 1180, (vh - 10) / 760);
    st.style.top = `calc(50% + ${barH * 0.5}px)`;
    st.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
  }

  function buildTransportBar() {
    const style = document.createElement('style');
    style.textContent = `
      #webTransport {
        position: fixed; top: 0; left: 0; right: 0; height: 48px;
        background: linear-gradient(180deg, #1b1d22 0%, #131519 100%);
        border-bottom: 1px solid #2c2f36;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55);
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 16px; gap: 12px; z-index: 9999;
        font-family: 'Barlow', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #eceef2;
      }
      .wt-left, .wt-center, .wt-right {
        display: flex; align-items: center; gap: 8px;
      }
      .wt-center { flex: 1; max-width: 560px; }
      .wt-badge {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em;
        color: #ff7eb6; background: rgba(255, 126, 182, 0.14);
        border: 1px solid rgba(255, 126, 182, 0.42);
        padding: 4px 9px; border-radius: 999px; white-space: nowrap;
      }
      .wt-btn {
        height: 30px; padding: 0 12px; border-radius: 999px;
        border: 1px solid #2e323b; background: #181a1f;
        color: #eceef2; font-family: inherit; font-size: 10.5px;
        font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        transition: all 0.12s ease; white-space: nowrap;
      }
      .wt-btn:hover { border-color: #454b59; background: #22252c; }
      .wt-btn.playing {
        background: #ff7eb6; color: #121316; border-color: #ff94c2;
        box-shadow: 0 0 14px rgba(255, 126, 182, 0.42);
      }
      .wt-seg {
        display: inline-flex; background: #111215;
        border: 1px solid #2c2f36; border-radius: 999px; padding: 2px; gap: 2px;
      }
      .wt-seg button {
        height: 26px; padding: 0 11px; border: none; border-radius: 999px;
        background: transparent; color: #8e94a0; font-family: inherit;
        font-size: 10px; font-weight: 700; letter-spacing: 0.07em;
        cursor: pointer; transition: all 0.12s ease; white-space: nowrap;
      }
      .wt-seg button:hover { color: #eceef2; }
      .wt-seg button.on {
        background: rgba(110, 198, 255, 0.18);
        color: #6ec6ff;
        box-shadow: inset 0 0 0 1px rgba(110, 198, 255, 0.52);
      }
      .wt-seg button.on.hi-gain {
        background: rgba(255, 209, 102, 0.18);
        color: #ffd166;
        box-shadow: inset 0 0 0 1px rgba(255, 209, 102, 0.55);
      }
      .wt-scrub {
        flex: 1; height: 26px; min-width: 120px;
        background: #111215; border: 1px solid #292c34;
        border-radius: 999px; position: relative; cursor: pointer;
        overflow: hidden;
      }
      .wt-scrub-fill {
        position: absolute; inset: 0 auto 0 0; width: 0%;
        background: linear-gradient(90deg, rgba(255, 126, 182, 0.22), rgba(110, 198, 255, 0.25));
        pointer-events: none;
      }
      .wt-scrub-head {
        position: absolute; top: 3px; bottom: 3px; left: 0%; width: 2.5px;
        background: #ff7eb6; border-radius: 2px; pointer-events: none;
        box-shadow: 0 0 6px #ff7eb6;
      }
      .wt-scrub-time {
        position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
        font: 600 9.5px 'JetBrains Mono', monospace; color: #b6bcc8;
        pointer-events: none;
      }
      .wt-scrub-status {
        position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
        font: 600 9.5px 'Barlow', sans-serif; color: #8e94a0;
        letter-spacing: 0.04em; pointer-events: none;
      }
      .wt-select {
        height: 28px; padding: 0 10px; border-radius: 999px;
        background: #15171c; color: #eceef2; border: 1px solid #2c2f36;
        font-family: inherit; font-size: 10px; font-weight: 600;
        cursor: pointer; outline: none;
      }
      .wt-select:hover { border-color: #454b59; }
      .wt-vol {
        display: inline-flex; align-items: center; gap: 5px;
        font: 700 9.5px 'JetBrains Mono', monospace; color: #8e94a0;
      }
      .wt-vol input[type=range] {
        width: 68px; accent-color: #ff7eb6; cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'webTransport';

    // Left: Badge + Play/Stop + Mid-Gain / High-Gain Clip Switcher
    const left = document.createElement('div');
    left.className = 'wt-left';

    const badge = document.createElement('span');
    badge.className = 'wt-badge';
    badge.textContent = 'LIVE WASM DSP';
    left.appendChild(badge);

    playBtn = document.createElement('button');
    playBtn.className = 'wt-btn';
    playBtn.addEventListener('click', async () => {
      if (audio.playing || audio.starting) {
        stopPlayback(false);
      } else {
        try {
          await startPlayback();
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = formatAudioError(err);
          }
        }
      }
    });
    left.appendChild(playBtn);

    const seg = document.createElement('div');
    seg.className = 'wt-seg';
    CLIPS.forEach((c, idx) => {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (idx === 1) b.classList.add('hi-gain');
      b.title = 'Switch amp clip while preserving playback position (Hotkeys: 1 / 2)';
      b.addEventListener('click', () => {
        selectClip(c.id).catch(err => {
          if (statusEl) {
            statusEl.textContent = formatAudioError(err);
          }
        });
      });
      clipBtns[c.id] = b;
      seg.appendChild(b);
    });
    left.appendChild(seg);

    // Center: Interactive Loop Scrub Bar
    const center = document.createElement('div');
    center.className = 'wt-center';

    const scrub = document.createElement('div');
    scrub.className = 'wt-scrub';
    scrub.title = 'Click to seek anywhere in the guitar riff';
    scrubFill = document.createElement('div');
    scrubFill.className = 'wt-scrub-fill';
    scrubHead = document.createElement('div');
    scrubHead.className = 'wt-scrub-head';
    statusEl = document.createElement('div');
    statusEl.className = 'wt-scrub-status';
    if (pendingStatusError) {
      statusEl.textContent = pendingStatusError;
    }
    scrubTime = document.createElement('div');
    scrubTime.className = 'wt-scrub-time';
    scrubTime.textContent = '0:00.0 / 0:11.3';
    scrub.append(scrubFill, scrubHead, statusEl, scrubTime);

    scrub.addEventListener('pointerdown', async e => {
      const rect = scrub.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      try {
        await seekPlayback(pct);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = formatAudioError(err);
        }
      }
    });
    center.appendChild(scrub);

    // Right: Rig Presets + Custom Audio Loader + Master Volume
    const right = document.createElement('div');
    right.className = 'wt-right';

    presetSel = document.createElement('select');
    presetSel.className = 'wt-select';
    presetSel.title = 'Load a curated dual-cab & microphone preset';
    RIG_PRESETS.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = p.name;
      presetSel.appendChild(opt);
    });
    presetSel.addEventListener('change', () => {
      applyRigPreset(Number(presetSel.value) || 0);
    });
    right.appendChild(presetSel);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*,.wav,.mp3,.flac,.ogg';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        await loadCustomFile(f);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = formatAudioError(err);
        }
      }
    });
    right.appendChild(fileInput);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'wt-btn';
    loadBtn.textContent = 'LOAD WAV';
    loadBtn.title = 'Load or drag-and-drop your own amp send / guitar WAV stem';
    loadBtn.addEventListener('click', () => fileInput.click());
    right.appendChild(loadBtn);

    const volWrap = document.createElement('div');
    volWrap.className = 'wt-vol';
    const volLbl = document.createElement('span');
    volLbl.textContent = 'VOL';
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = String(audio.volPct);
    volSlider.addEventListener('input', () => {
      audio.volPct = volSlider.valueAsNumber;
      if (audio.master && audio.ctx) {
        audio.master.gain.setTargetAtTime(volLinear(), audio.ctx.currentTime, 0.015);
      }
    });
    volWrap.append(volLbl, volSlider);
    right.appendChild(volWrap);

    bar.append(left, center, right);
    document.body.insertBefore(bar, document.body.firstChild);

    // Keyboard shortcuts: Space = Play/Stop, 1 = Super Lead (Mid Gain), 2 = NTS (High Gain)
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (audio.playing || audio.starting) {
          stopPlayback(false);
        } else {
          startPlayback().catch(err => {
            if (statusEl) {
              statusEl.textContent = formatAudioError(err);
            }
          });
        }
      } else if (e.key === '1') {
        selectClip('super_lead').catch(err => {
          if (statusEl) {
            statusEl.textContent = formatAudioError(err);
          }
        });
      } else if (e.key === '2') {
        selectClip('nts').catch(err => {
          if (statusEl) {
            statusEl.textContent = formatAudioError(err);
          }
        });
      }
    });

    // Drag-and-drop custom audio file anywhere on the window
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        try {
          await loadCustomFile(f);
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = formatAudioError(err);
          }
        }
      }
    });

    updateTransportUI();
    fitStageWithBar();
    window.addEventListener('resize', fitStageWithBar);
    setTimeout(fitStageWithBar, 60);
  }

  async function loadCustomFile(file) {
    if (!file) return;
    const reqId = ++audio.playRequestId;
    const fileName = file.name || 'custom audio';
    const failCustomLoad = msg => {
      if (reqId !== audio.playRequestId) return;
      if (statusEl) statusEl.textContent = msg;
      if (!audio.playing) {
        audio.starting = false;
        updateTransportUI(true);
      }
    };
    if (typeof file.size === 'number' && file.size <= 0) {
      failCustomLoad('Invalid or empty audio in ' + fileName);
      return;
    }
    if (typeof file.size === 'number' && file.size > MAX_CUSTOM_WAV_BYTES) {
      failCustomLoad('File exceeds 200 MB limit: ' + fileName);
      return;
    }
    let audioReady = false;
    try {
      await ensureAudio();
      audioReady = true;
      if (reqId !== audio.playRequestId) return;
      const bytes = await file.arrayBuffer();
      if (reqId !== audio.playRequestId) return;
      if (!bytes || !(bytes.byteLength > 0)) {
        failCustomLoad('Invalid or empty audio in ' + fileName);
        return;
      }
      if (bytes.byteLength > MAX_CUSTOM_WAV_BYTES) {
        failCustomLoad('File exceeds 200 MB limit: ' + fileName);
        return;
      }
      const decoded = await audio.ctx.decodeAudioData(bytes);
      if (reqId !== audio.playRequestId) return;
      if (!decoded || !(decoded.duration > 0)) {
        failCustomLoad('Invalid or empty audio in ' + fileName);
        return;
      }
      audio.customBuffer = downmixToStereoBuffer(audio.ctx, decoded);
      audio.customName   = fileName;
      audio.activeClipId = 'custom';
      audio.playStartOffset = 0;
      await startPlayback(0, 15);
    } catch (err) {
      failCustomLoad(audioReady ? ('Could not decode ' + fileName) : formatAudioError(err));
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    fitStageWithBar();
    if (scrubFill && scrubHead && scrubTime) {
      const buf = currentBuffer();
      const dur = (buf && buf.duration > 0) ? buf.duration : (audio.activeClipId === 'nts' ? 11.73 : 11.30);
      const pos = currentPlayheadSec();
      const pct = Math.max(0, Math.min(100, (pos / Math.max(0.01, dur)) * 100));
      scrubFill.style.width = pct.toFixed(2) + '%';
      scrubHead.style.left  = pct.toFixed(2) + '%';
      scrubTime.textContent = `${fmtSec(pos)} / ${fmtSec(dur)}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      buildTransportBar();
      requestAnimationFrame(tick);
    });
  } else {
    buildTransportBar();
    requestAnimationFrame(tick);
  }
})();
