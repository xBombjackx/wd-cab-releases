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

  const NUM_PARAMS   = 100;
  const CURVE_POINTS = 64;
  const TELEM_FLOATS = 280;

  // Exact 100-parameter table matching WdAmpProcessor::createParameterLayout()
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
    /* 83 */ { id: 'cabBDelayMs',     type: 'slider', min: 0.0,    max: 10.0,    step: 0.01,  skew: 0.55, def: 0.0 },
    /* 84 */ { id: 'roomPreDelayMs',  type: 'slider', min: 0.0,    max: 100.0,   step: 0.1,   skew: 0.65, def: 0.0 },
    /* 85 */ { id: 'roomLoCutHz',         type: 'slider', min: 20.0,   max: 600.0,   step: 1.0,   skew: 0.42, def: 20.0 },
    /* 86 */ { id: 'roomHiCutHz',         type: 'slider', min: 1500.0, max: 20000.0, step: 10.0,  skew: 0.42, def: 20000.0 },
    /* 87 */ { id: 'fxLoopEnabled',       type: 'toggle', def: false },
    /* 88 */ { id: 'fxLoopMode',          type: 'combo',  choices: ['Spring Tank', 'BBD Chorus/Delay', 'Tape Echo'], def: 0 },
    /* 89 */ { id: 'fxLoopTime',          type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.45 },
    /* 90 */ { id: 'fxLoopFeedback',      type: 'slider', min: 0.0,    max: 1.0,     step: 0.001, skew: 1.0,  def: 0.35 },
    /* 91 */ { id: 'fxLoopMix',           type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.22 },
    /* 92 */ { id: 'loadPickupModel',     type: 'combo',  choices: ['Vintage Single', 'Hot Bridge Single', 'P-90 Soapbar', 'Classic PAF HB', 'High-Output HB'], def: 0 },
    /* 93 */ { id: 'loadWiring',          type: 'combo',  choices: ['Modern', "'50s Vintage"], def: 0 },
    /* 94 */ { id: 'loadBleedType',       type: 'combo',  choices: ['Off', 'Cap Only', 'Parallel R+C', 'Series R+C'], def: 0 },
    /* 95 */ { id: 'loadCablePreset',     type: 'combo',  choices: ['Standard 100 pF/m', 'Studio Lo-Cap 65 pF/m', 'Vintage Coiled'], def: 0 },
    /* 96 */ { id: 'loadDielectricLoss',  type: 'slider', min: 0.0,    max: 1.0,     step: 0.01,  skew: 1.0,  def: 0.0 },
    /* 97 */ { id: 'loadCouplingProfile', type: 'combo',  choices: ['Direct · 1M DI', 'True-Bypass · 1M DI', 'Buffered Chain', 'Direct · Vintage 470k DI', 'Direct · Active 10M DI', 'Absolute (Raw Pickup)'], def: 0 },
    /* 98 */ { id: 'cabACutOrder',        type: 'combo',  choices: ['Pre-Preamp', 'Post-Preamp'], def: 0 },
    /* 99 */ { id: 'cabBCutOrder',        type: 'combo',  choices: ['Pre-Preamp', 'Post-Preamp'], def: 0 },
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
              markPresetControlDirty(true);
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
              markPresetControlDirty(true);
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
              if (def.id === 'powerAmpEnabled' && !v) {
                preferAmpCab = false;
              }
              markPresetControlDirty(true);
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
      if (name === 'dropUserIrBuffer') {
        return async (slot, fileName, buf) => loadUserIrFromBuffer(slot | 0, fileName, buf);
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
          presetApplyDepth++;
          try {
            const n = Number(idx);
            const safeIdx = (Number.isFinite(n) && Math.trunc(n) >= 0 && Math.trunc(n) < RIG_PRESETS.length)
              ? Math.trunc(n)
              : -1;
            activePresetIndex = safeIdx;
            presetVisualDirty = false;
            if (!isPowerAmpOn()) {
              preferAmpCab = false;
            }
            if (safeIdx >= 0) {
              clearCabDeltaState();
            }
            clearUserIrSlot(0, false);
            clearUserIrSlot(1, false);
            syncPresetSelectElements(getDisplayedPresetIndex());
            syncUiEngineAndEmit();
          } finally {
            presetApplyDepth--;
          }
        };
      }
      if (name === 'setRigViewMode') {
        return async mode => {
          if (mode !== 'cab' && mode !== 'amp' && mode !== 'ampcab') return false;
          const next = (mode === 'ampcab') && isPowerAmpOn();
          if (preferAmpCab !== next) {
            preferAmpCab = next;
            syncUiEngineAndEmit();
          }
          return true;
        };
      }
      if (name === 'setCabDelta') {
        return async (slot, enabled) => setCabDelta(slot, enabled);
      }
      if (name === 'selectAbSlot') {
        return async slot => selectAbSlot(slot);
      }
      if (name === 'copyAbSlot') {
        return async fromSlot => copyAbSlot(fromSlot);
      }
      if (name === 'savePresetFile') {
        return async suggestedName => savePresetFile(suggestedName);
      }
      if (name === 'loadPresetFile') {
        return async () => openPresetFilePicker();
      }
      return async () => {};
    },
  };

  window.__WD_WEB_HOST__ = host;

  const MAX_STATE_BYTES = 1024 * 1024;
  const POWER_AMP_PARAM_IDX = 21;
  const isPowerAmpOn = () => rawParams[POWER_AMP_PARAM_IDX] >= 0.5;
  let abSlotActive = 0;
  let activePresetIndex = -1;
  let preferAmpCab = false;
  const cabDelta = [false, false];
  let presetPickerActive = false;
  let presetApplyDepth = 0;
  let presetVisualDirty = false;
  let dismissWtIrConfirmFn = null;

  function syncCabDeltaToEngines() {
    if (uiEngine && uiEngine.wasm && typeof uiEngine.wasm.wdcab_set_cab_delta === 'function') {
      uiEngine.wasm.wdcab_set_cab_delta(0, cabDelta[0] ? 1 : 0);
      uiEngine.wasm.wdcab_set_cab_delta(1, cabDelta[1] ? 1 : 0);
    }
    if (audio && audio.node && audio.node.port) {
      audio.node.port.postMessage({ type: 'setCabDelta', slot: 0, enabled: !!cabDelta[0] });
      audio.node.port.postMessage({ type: 'setCabDelta', slot: 1, enabled: !!cabDelta[1] });
    }
  }

  function clearCabDeltaState() {
    cabDelta[0] = false;
    cabDelta[1] = false;
    syncCabDeltaToEngines();
  }

  function setCabDelta(rawSlot, rawEnabled) {
    const slot = isStrictAbSlotArg(rawSlot);
    if (slot === null || typeof rawEnabled !== 'boolean') return false;
    cabDelta[slot] = rawEnabled;
    if (uiEngine && uiEngine.wasm && typeof uiEngine.wasm.wdcab_set_cab_delta === 'function') {
      uiEngine.wasm.wdcab_set_cab_delta(slot, rawEnabled ? 1 : 0);
    }
    if (audio && audio.node && audio.node.port) {
      audio.node.port.postMessage({ type: 'setCabDelta', slot, enabled: rawEnabled });
    }
    syncUiEngineAndEmit();
    return true;
  }

  function syncPresetSelectElements(idx) {
    const safeIdx = (typeof idx === 'number' && Number.isFinite(idx) && Math.trunc(idx) >= 0 && Math.trunc(idx) < RIG_PRESETS.length)
      ? Math.trunc(idx)
      : -1;
    const valStr = safeIdx >= 0 ? String(safeIdx) : '';
    if (presetSel && String(presetSel.value) !== valStr) {
      presetSel.value = valStr;
    }
    const uiPresetSel = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById('rigPresetSel')
      : null;
    if (uiPresetSel && String(uiPresetSel.value) !== valStr) {
      uiPresetSel.value = valStr;
    }
  }

  function markPresetControlDirty(invalidateActivePreset = true) {
    if (presetApplyDepth > 0) return;
    if (invalidateActivePreset) {
      activePresetIndex = -1;
      presetVisualDirty = false;
    } else {
      presetVisualDirty = true;
    }
    syncPresetSelectElements(-1);
  }

  // ==========================================================================
  // Per-Cab User .wav IR State, Pure-JS RIFF Decoder & Live Telemetry Overlay
  // ==========================================================================
  function makeDefaultUserIrRecord() {
    return { active: false, name: '', wave: [], mono: null, ref48k: null, refLen: 2048, sampleRate: 48000, prepared: null };
  }
  const userIrState = [
    makeDefaultUserIrRecord(),
    makeDefaultUserIrRecord(),
  ];

  function hasActiveUserIr() {
    return !!(userIrState && ((userIrState[0] && userIrState[0].active) || (userIrState[1] && userIrState[1].active)));
  }

  function getDisplayedPresetIndex() {
    if (activePresetIndex < 0 || presetVisualDirty || hasActiveUserIr()) return -1;
    return activePresetIndex;
  }

  function cloneUserIrRecord(st) {
    if (!st || !st.active) return makeDefaultUserIrRecord();
    const refLen = st.refLen || (st.prepared && st.prepared.ref48k ? st.prepared.ref48k.length : 2048);
    const srcRef = st.ref48k || (st.prepared ? st.prepared.ref48k : null);
    const ref48k = srcRef ? new Float32Array(srcRef.subarray(0, refLen)) : null;
    const prepared = st.prepared ? {
      irLen: st.prepared.irLen,
      sampleRate: st.prepared.sampleRate,
      irRev: st.prepared.irRev ? new Float32Array(st.prepared.irRev) : null,
      ref48k: st.prepared.ref48k ? new Float32Array(st.prepared.ref48k) : null,
      magDb: st.prepared.magDb ? new Float32Array(st.prepared.magDb) : null,
      phaseRad: st.prepared.phaseRad ? new Float32Array(st.prepared.phaseRad) : null,
      wave: st.prepared.wave ? new Float32Array(st.prepared.wave) : null,
    } : null;
    return {
      active: true,
      name: String(st.name || ''),
      wave: Array.isArray(st.wave) ? st.wave.slice() : [],
      mono: st.mono ? new Float32Array(st.mono) : null,
      ref48k,
      refLen,
      sampleRate: st.sampleRate || 48000,
      prepared,
    };
  }

  function makeDefaultAbSlot() {
    const params = new Float64Array(NUM_PARAMS);
    PARAM_LIST.forEach((p, i) => {
      params[i] = p.type === 'toggle' ? (p.def ? 1.0 : 0.0) : p.def;
    });
    return {
      params,
      activePresetIndex: -1,
      presetVisualDirty: false,
      preferAmpCab: false,
      userIrs: [makeDefaultUserIrRecord(), makeDefaultUserIrRecord()],
    };
  }
  const abSlots = [makeDefaultAbSlot(), makeDefaultAbSlot()];

  function isStrictAbSlotArg(raw) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const s = Math.round(raw);
    if (Math.abs(raw - s) > 1e-6 || (s !== 0 && s !== 1)) return null;
    return s;
  }

  function snapshotLiveIntoAbSlot(dst) {
    if (!dst) return;
    dst.params = new Float64Array(rawParams);
    dst.activePresetIndex = activePresetIndex;
    dst.presetVisualDirty = !!(presetVisualDirty || hasActiveUserIr());
    dst.preferAmpCab = !!(preferAmpCab && isPowerAmpOn());
    dst.userIrs = [cloneUserIrRecord(userIrState[0]), cloneUserIrRecord(userIrState[1])];
  }

  function userIrRecordsMatch(a, b) {
    if (!a || !b) return false;
    if (!a.active && !b.active) return true;
    if (a.active !== b.active || a.name !== b.name) return false;
    const lenA = a.refLen || (a.ref48k ? a.ref48k.length : 0);
    const lenB = b.refLen || (b.ref48k ? b.ref48k.length : 0);
    if (lenA !== lenB || lenA <= 0 || !a.ref48k || !b.ref48k) return false;
    for (let i = 0; i < lenA; i++) {
      if (a.ref48k[i] !== b.ref48k[i]) return false;
    }
    return true;
  }

  function applyParamArrayToLive(nextParams) {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const def = PARAM_LIST[i];
      let v = nextParams && i < nextParams.length ? Number(nextParams[i]) : (def.type === 'toggle' ? (def.def ? 1.0 : 0.0) : def.def);
      if (!Number.isFinite(v)) v = def.type === 'toggle' ? (def.def ? 1.0 : 0.0) : def.def;
      if (def.type === 'toggle') {
        v = v >= 0.5 ? 1.0 : 0.0;
      } else if (def.type === 'combo') {
        const nChoices = Math.max(1, (def.choices || []).length);
        v = Math.max(0, Math.min(nChoices - 1, Math.round(v)));
      } else {
        v = Math.max(def.min, Math.min(def.max, v));
        if (def.step && def.step > 0.0) {
          v = def.min + Math.round((v - def.min) / def.step) * def.step;
          v = Math.round(v * 1e6) / 1e6;
          v = Math.max(def.min, Math.min(def.max, v));
        }
      }
      const prev = rawParams[i];
      rawParams[i] = v;
      if (Math.abs(prev - v) > 1e-7) {
        fire(def.id);
      }
    }
  }

  function applyAbSlotToLive(src, triggerSmooth = true) {
    if (!src) return;
    presetApplyDepth++;
    try {
      applyParamArrayToLive(src.params);
      const safePresetIdx = (typeof src.activePresetIndex === 'number' &&
        Number.isFinite(src.activePresetIndex) &&
        Math.trunc(src.activePresetIndex) >= 0 &&
        Math.trunc(src.activePresetIndex) < RIG_PRESETS.length)
        ? Math.trunc(src.activePresetIndex)
        : -1;
      activePresetIndex = safePresetIdx;
      preferAmpCab = !!(src.preferAmpCab && isPowerAmpOn());
      clearCabDeltaState();

      if (audio.node) {
        const params = new Float64Array(rawParams);
        audio.node.port.postMessage({ type: 'controls', params, smoothTransition: !!triggerSmooth }, [params.buffer]);
      }

      for (let c = 0; c < 2; c++) {
        const tgt = (src.userIrs && src.userIrs[c]) ? src.userIrs[c] : makeDefaultUserIrRecord();
        if (userIrRecordsMatch(userIrState[c], tgt)) continue;
        if (tgt.active && tgt.ref48k && tgt.ref48k.length > 0) {
          if (!applyUserIrFromRef48k(c, tgt.ref48k, tgt.refLen || tgt.ref48k.length, tgt.name, false)) {
            clearUserIrSlot(c, false);
          }
        } else if (tgt.active && tgt.mono && tgt.mono.length > 0) {
          if (!applyUserIrMono(c, tgt.name, tgt.mono, tgt.sampleRate || 48000, false)) {
            clearUserIrSlot(c, false);
          }
        } else {
          clearUserIrSlot(c, false);
        }
      }

      presetVisualDirty = !!(src.presetVisualDirty || hasActiveUserIr());
      syncPresetSelectElements(getDisplayedPresetIndex());
      syncUiEngineAndEmit();
    } finally {
      presetApplyDepth--;
    }
  }

  function selectAbSlot(rawSlot) {
    const slot = isStrictAbSlotArg(rawSlot);
    if (slot === null) return false;
    if (abSlotActive === slot) return true;
    if (typeof dismissWtIrConfirmFn === 'function') dismissWtIrConfirmFn(false, false);
    if (typeof window !== 'undefined' && typeof window.__wdDismissIrConfirm === 'function') {
      window.__wdDismissIrConfirm(false);
    }
    snapshotLiveIntoAbSlot(abSlots[abSlotActive]);
    abSlotActive = slot;
    applyAbSlotToLive(abSlots[slot], true);
    return true;
  }

  function copyAbSlot(rawFromSlot) {
    const fromSlot = isStrictAbSlotArg(rawFromSlot);
    if (fromSlot === null) return false;
    snapshotLiveIntoAbSlot(abSlots[abSlotActive]);
    const dstSlot = 1 - fromSlot;
    const src = abSlots[fromSlot];
    abSlots[dstSlot] = {
      params: new Float64Array(src.params),
      activePresetIndex: src.activePresetIndex,
      presetVisualDirty: !!(src.presetVisualDirty || (src.userIrs && ((src.userIrs[0] && src.userIrs[0].active) || (src.userIrs[1] && src.userIrs[1].active)))),
      preferAmpCab: !!(src.preferAmpCab && src.params && src.params[POWER_AMP_PARAM_IDX] >= 0.5),
      userIrs: [cloneUserIrRecord(src.userIrs[0]), cloneUserIrRecord(src.userIrs[1])],
    };
    if (dstSlot === abSlotActive) {
      applyAbSlotToLive(abSlots[dstSlot], true);
    } else {
      syncUiEngineAndEmit();
    }
    return true;
  }

  function computeCabIrLenForRate(fs) {
    if (fs >= 264600) return 16384;
    if (fs >= 132300) return 8192;
    if (fs >= 66150) return 4096;
    return 2048;
  }

  function extractPreparedUserIrFromUiEngine(slot) {
    const w = uiEngine.wasm;
    if (!w || typeof w.wdcab_get_user_ir_len !== 'function' ||
        typeof w.wdcab_get_user_ir_rev_ptr !== 'function')
    {
      return null;
    }
    const irLen = w.wdcab_get_user_ir_len(slot);
    const revPtr = w.wdcab_get_user_ir_rev_ptr(slot);
    const refPtr = w.wdcab_get_user_ir_ref_ptr(slot);
    const magPtr = w.wdcab_get_user_ir_mag_ptr(slot);
    const phasePtr = w.wdcab_get_user_ir_phase_ptr(slot);
    if (irLen <= 0 || !revPtr) return null;

    const sampleRate = w.wdcab_get_user_ir_sample_rate(slot) || uiEngine.fs;
    const scratchPtr = w.wdcab_ir_scratch();
    const hasWave = typeof w.wdcab_get_user_ir_waveform === 'function'
      ? w.wdcab_get_user_ir_waveform(slot, scratchPtr)
      : 0;
    const f32 = new Float32Array(w.memory.buffer);
    const irRev = new Float32Array(f32.subarray(revPtr >> 2, (revPtr >> 2) + irLen));
    const refLen = (typeof w.wdcab_get_user_ir_ref_len === 'function' ? w.wdcab_get_user_ir_ref_len(slot) : 0) || 2048;
    const ref48k = refPtr ? new Float32Array(f32.subarray(refPtr >> 2, (refPtr >> 2) + refLen)) : new Float32Array(refLen);
    const magDb = magPtr ? new Float32Array(f32.subarray(magPtr >> 2, (magPtr >> 2) + 64)) : new Float32Array(64);
    const phaseRad = phasePtr ? new Float32Array(f32.subarray(phasePtr >> 2, (phasePtr >> 2) + 64)) : new Float32Array(64);
    const wave = hasWave
      ? new Float32Array(f32.subarray(scratchPtr >> 2, (scratchPtr >> 2) + 128))
      : new Float32Array(128);
    return { irLen, sampleRate, irRev, ref48k, magDb, phaseRad, wave };
  }

  function postPreparedUserIrToWorklet(node, slot, prepared) {
    if (!node || !prepared || !prepared.irRev || prepared.irLen <= 0) return;
    const irRev = prepared.irRev.slice();
    const ref48k = prepared.ref48k ? prepared.ref48k.slice() : new Float32Array(2048);
    const magDb = prepared.magDb ? prepared.magDb.slice() : new Float32Array(64);
    const phaseRad = prepared.phaseRad ? prepared.phaseRad.slice() : new Float32Array(64);
    const wave = prepared.wave ? prepared.wave.slice() : new Float32Array(128);
    node.port.postMessage(
      {
        type: 'applyPreparedUserIr',
        slot,
        irLen: prepared.irLen,
        sampleRate: prepared.sampleRate,
        irRev,
        ref48k,
        magDb,
        phaseRad,
        wave,
      },
      [irRev.buffer, ref48k.buffer, magDb.buffer, phaseRad.buffer, wave.buffer]
    );
  }

  function decodeWavMonoJs(input) {
    if (!input) return null;
    let view = null;
    let len = 0;
    if (ArrayBuffer.isView(input)) {
      len = input.byteLength;
      if (len < 44 || len > 16 * 1024 * 1024 || !input.buffer) return null;
      view = new DataView(input.buffer, input.byteOffset, len);
    } else if (typeof input.byteLength === 'number') {
      len = input.byteLength;
      if (len < 44 || len > 16 * 1024 * 1024) return null;
      view = new DataView(input);
    } else {
      return null;
    }
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
    const numFrames = Math.min(totalFrames, sr * 10);
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
    let peak = 0.0;
    for (let i = 0; i < numFrames; i++) {
      const a = Math.abs(mono[i]);
      if (a > peak) peak = a;
    }
    let startIdx = 0;
    if (peak > 1e-9) {
      const trimThresh = Math.max(1e-6, peak * 1e-4);
      while (startIdx < numFrames && Math.abs(mono[startIdx]) < trimThresh) {
        startIdx++;
      }
      if (startIdx >= numFrames) startIdx = 0;
    }
    const endIdx = Math.min(numFrames, startIdx + maxScratch);
    const trimmed = (startIdx === 0 && endIdx === numFrames)
      ? mono
      : mono.slice(startIdx, endIdx);
    return { mono: trimmed, sampleRate: sr };
  }

  const irErrTimers = [null, null];

  function clearUserIrError(slot) {
    if (slot !== 0 && slot !== 1) return;
    if (irErrTimers[slot]) {
      clearTimeout(irErrTimers[slot]);
      irErrTimers[slot] = null;
    }
    const btn = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById(slot === 0 ? 'irLoadABtn' : 'irLoadBBtn')
      : null;
    if (btn && btn.classList && btn.classList.contains('ir-error')) {
      btn.classList.remove('ir-error');
      if (btn.textContent === 'IR ERR') btn.textContent = 'IR';
    }
  }

  function flashUserIrError(slot) {
    if (slot !== 0 && slot !== 1) return;
    const btn = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById(slot === 0 ? 'irLoadABtn' : 'irLoadBBtn')
      : null;
    if (!btn || !btn.classList) return;
    const idleLabel = (btn.textContent && btn.textContent !== 'IR ERR') ? btn.textContent : 'IR';
    btn.classList.add('ir-error');
    btn.textContent = 'IR ERR';
    if (irErrTimers[slot]) clearTimeout(irErrTimers[slot]);
    irErrTimers[slot] = setTimeout(() => {
      if (btn.classList) btn.classList.remove('ir-error');
      if (btn.textContent === 'IR ERR') btn.textContent = idleLabel;
      irErrTimers[slot] = null;
    }, 2200);
  }

  function loadUserIrIntoUiEngine(slot, mono, sampleRate) {
    if (!uiEngine.wasm || typeof uiEngine.wasm.wdcab_ir_scratch !== 'function' ||
        typeof uiEngine.wasm.wdcab_load_user_ir !== 'function' || !mono || mono.length <= 0)
    {
      return null;
    }
    const targetSr = (audio.ctx && Number.isFinite(audio.ctx.sampleRate) && audio.ctx.sampleRate > 0)
      ? audio.ctx.sampleRate
      : uiEngine.fs;
    if (Math.abs(uiEngine.fs - targetSr) > 1.0) {
      uiEngine.fs = targetSr;
      uiEngine.wasm.wdcab_init(targetSr);
    }
    const maxCap = (typeof uiEngine.wasm.wdcab_ir_scratch_max === 'function')
      ? uiEngine.wasm.wdcab_ir_scratch_max()
      : 131072;
    const copyLen = Math.min(mono.length, maxCap);
    const scratchPtr = uiEngine.wasm.wdcab_ir_scratch();
    const f32 = new Float32Array(uiEngine.wasm.memory.buffer);
    f32.set(mono.subarray(0, copyLen), scratchPtr >> 2);
    const ok = uiEngine.wasm.wdcab_load_user_ir(slot, scratchPtr, copyLen, sampleRate || 48000);
    if (!ok) return { ok: false };
    const prepared = extractPreparedUserIrFromUiEngine(slot);
    const wave = prepared && prepared.wave ? Array.from(prepared.wave) : [];
    return { ok: true, copyLen, prepared, wave };
  }

  function syncUserIrToWorklet(slot) {
    if (!audio.node || (slot !== 0 && slot !== 1)) return;
    const st = userIrState[slot];
    if (!st || !st.active) return;
    if (st.prepared) {
      postPreparedUserIrToWorklet(audio.node, slot, st.prepared);
    } else if (st.mono) {
      const samples = st.mono.slice();
      audio.node.port.postMessage(
        {
          type: 'loadUserIr',
          slot,
          samples,
          sampleRate: st.sampleRate,
        },
        [samples.buffer]
      );
    }
  }

  function syncClearedUserIrToWorklet(slot) {
    if (slot !== 0 && slot !== 1) return;
    let procIrRev = null;
    let irLen = 0;
    const targetSr = (audio.ctx && Number.isFinite(audio.ctx.sampleRate) && audio.ctx.sampleRate > 0)
      ? audio.ctx.sampleRate
      : uiEngine.fs;
    if (uiEngine.wasm && typeof uiEngine.wasm.wdcab_clear_user_ir === 'function') {
      if (Math.abs(uiEngine.fs - targetSr) > 1.0) {
        uiEngine.fs = targetSr;
        uiEngine.wasm.wdcab_init(targetSr);
      }
      for (let i = 0; i < NUM_PARAMS; i++) {
        uiEngine.wasm.wdcab_set_param(i, rawParams[i]);
      }
      uiEngine.wasm.wdcab_apply();
      uiEngine.wasm.wdcab_clear_user_ir(slot);
      if (audio.node && typeof uiEngine.wasm.wdcab_get_cab_proc_ir_rev_ptr === 'function') {
        const procPtr = uiEngine.wasm.wdcab_get_cab_proc_ir_rev_ptr(slot);
        irLen = computeCabIrLenForRate(uiEngine.fs);
        if (procPtr && irLen > 0) {
          const f32 = new Float32Array(uiEngine.wasm.memory.buffer);
          procIrRev = new Float32Array(f32.subarray(procPtr >> 2, (procPtr >> 2) + irLen));
        }
      }
    }
    if (audio.node) {
      if (procIrRev && irLen > 0) {
        audio.node.port.postMessage(
          { type: 'clearUserIr', slot, procIrRev, irLen, sampleRate: uiEngine.fs },
          [procIrRev.buffer]
        );
      } else {
        audio.node.port.postMessage({ type: 'clearUserIr', slot });
      }
    }
  }

  function loadUserIrRef48kIntoUiEngine(slot, ref48k, refLen, irName) {
    if (!uiEngine.wasm ||
        typeof uiEngine.wasm.wdcab_set_user_ir_ref48k !== 'function' ||
        typeof uiEngine.wasm.wdcab_prepared_ir_ref_ptr !== 'function' ||
        !ref48k || refLen <= 0)
    {
      return null;
    }
    const targetSr = (audio.ctx && Number.isFinite(audio.ctx.sampleRate) && audio.ctx.sampleRate > 0)
      ? audio.ctx.sampleRate
      : uiEngine.fs;
    if (Math.abs(uiEngine.fs - targetSr) > 1.0) {
      uiEngine.fs = targetSr;
      uiEngine.wasm.wdcab_init(targetSr);
    }
    const validRefLen = refLen >= 2048 && refLen <= 8192 && (refLen & (refLen - 1)) === 0;
    if (!validRefLen || ref48k.length < refLen) return { ok: false };
    const refPtr = uiEngine.wasm.wdcab_prepared_ir_ref_ptr();
    const scratchPtr = uiEngine.wasm.wdcab_ir_scratch();
    const f32 = new Float32Array(uiEngine.wasm.memory.buffer);
    const u8 = new Uint8Array(uiEngine.wasm.memory.buffer);
    f32.set(ref48k.subarray(0, refLen), refPtr >> 2);
    const nameBytes = encodeUtf8Bytes(String(irName || 'Custom IR')).slice(0, 63);
    if (nameBytes.length > 0 && scratchPtr) {
      u8.set(nameBytes, scratchPtr);
    }
    const ok = uiEngine.wasm.wdcab_set_user_ir_ref48k(slot, refPtr, refLen, scratchPtr, nameBytes.length, uiEngine.fs);
    if (!ok) return { ok: false };
    const prepared = extractPreparedUserIrFromUiEngine(slot);
    const wave = prepared && prepared.wave ? Array.from(prepared.wave) : [];
    return { ok: true, prepared, wave };
  }

  function sanitizeUserIrNameJs(raw) {
    const stripped = String(raw == null ? '' : raw).replace(/^.*[\\/]/, '');
    const cps = [];
    for (let i = 0; i < stripped.length; i++) {
      const code = stripped.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < stripped.length) {
          const lo = stripped.charCodeAt(i + 1);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cps.push(stripped[i] + stripped[i + 1]);
            i++;
            continue;
          }
        }
        continue;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) continue;
      if (code === 0x09 || code === 0x0A || code === 0x0D) {
        cps.push(' ');
        continue;
      }
      if (code < 0x20 || code === 0x7f || code === 0xFFFE || code === 0xFFFF) continue;
      cps.push(stripped[i]);
    }
    const trimmed = cps.join('').trim();
    const truncated = Array.from(trimmed).slice(0, 60).join('').trim();
    return truncated || 'Custom IR';
  }

  function applyUserIrFromRef48k(slot, ref48k, refLen, irName, emitTelemetry = true) {
    const validRefLen = (refLen >= 2048 && refLen <= 8192 && (refLen & (refLen - 1)) === 0);
    if ((slot !== 0 && slot !== 1) || !ref48k || !validRefLen || ref48k.length < refLen) return false;
    const cleanName = sanitizeUserIrNameJs(irName);
    const refCopy = new Float32Array(ref48k.subarray(0, refLen));
    if (uiEngine.wasm && typeof uiEngine.wasm.wdcab_set_user_ir_ref48k === 'function') {
      const res = loadUserIrRef48kIntoUiEngine(slot, refCopy, refLen, cleanName);
      if (!res || !res.ok) return false;
      userIrState[slot] = {
        active: true,
        name: cleanName,
        wave: res.wave,
        mono: null,
        ref48k: (res.prepared && res.prepared.ref48k) ? new Float32Array(res.prepared.ref48k) : refCopy,
        refLen,
        sampleRate: uiEngine.fs,
        prepared: res.prepared,
      };
    } else {
      userIrState[slot] = {
        active: true,
        name: cleanName,
        wave: [],
        mono: null,
        ref48k: refCopy,
        refLen,
        sampleRate: 48000,
        prepared: null,
      };
    }
    clearUserIrError(slot);
    markPresetControlDirty(false);
    syncUserIrToWorklet(slot);
    if (emitTelemetry) syncUiEngineAndEmit();
    return true;
  }

  function applyUserIrMono(slot, fileName, mono, sampleRate, emitTelemetry = true) {
    if ((slot !== 0 && slot !== 1) || !mono || mono.length <= 0) return false;
    const baseNoExt = String(fileName == null ? '' : fileName).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const cleanName = sanitizeUserIrNameJs(baseNoExt);
    const sr = sampleRate || 48000;
    if (uiEngine.wasm && typeof uiEngine.wasm.wdcab_ir_scratch === 'function' &&
        typeof uiEngine.wasm.wdcab_load_user_ir === 'function')
    {
      const res = loadUserIrIntoUiEngine(slot, mono, sr);
      if (!res || !res.ok) return false;
      const ref48k = (res.prepared && res.prepared.ref48k) ? new Float32Array(res.prepared.ref48k) : null;
      const refLen = ref48k ? ref48k.length : 2048;
      userIrState[slot] = {
        active: true,
        name: cleanName,
        wave: res.wave,
        mono: mono.slice(0, res.copyLen),
        ref48k,
        refLen,
        sampleRate: sr,
        prepared: res.prepared,
      };
    } else {
      userIrState[slot] = {
        active: true,
        name: cleanName,
        wave: [],
        mono: mono.slice(),
        ref48k: null,
        refLen: 2048,
        sampleRate: sr,
        prepared: null,
      };
    }
    clearUserIrError(slot);
    markPresetControlDirty(false);
    syncUserIrToWorklet(slot);
    if (emitTelemetry) syncUiEngineAndEmit();
    return true;
  }

  function clearUserIrSlot(slot, emitTelemetry = true) {
    if (slot !== 0 && slot !== 1) return;
    clearUserIrError(slot);
    if (!userIrState[slot].active) return;
    if (presetApplyDepth === 0) {
      if (typeof dismissWtIrConfirmFn === 'function') dismissWtIrConfirmFn(false, false);
      if (typeof window !== 'undefined' && typeof window.__wdDismissIrConfirm === 'function') {
        window.__wdDismissIrConfirm(false);
      }
    }
    userIrState[slot] = makeDefaultUserIrRecord();
    markPresetControlDirty(false);
    syncClearedUserIrToWorklet(slot);
    if (emitTelemetry) syncUiEngineAndEmit();
  }

  function loadUserIrFromBuffer(slot, fileName, buf) {
    try {
      const dec = decodeWavMonoJs(buf);
      if (!dec) return false;
      return applyUserIrMono(slot, fileName, dec.mono, dec.sampleRate);
    } catch (_) {
      return false;
    }
  }

  function loadUserIrFromBase64(slot, fileName, b64Str) {
    try {
      let clean = String(b64Str || '');
      const commaIdx = clean.indexOf(',');
      if (clean.startsWith('data:') && commaIdx > 0) clean = clean.slice(commaIdx + 1);
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return loadUserIrFromBuffer(slot, fileName, bytes);
    } catch (_) {
      return false;
    }
  }

  function openUserIrPicker(slot) {
    return new Promise(resolve => {
      if (typeof document === 'undefined' || !document.body) {
        resolve(null);
        return;
      }
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.wav,audio/wav';
      inp.style.display = 'none';
      const maxIrBytes = 16 * 1024 * 1024;
      let settled = false;
      let handlingChange = false;
      let focusTimer = null;

      const cleanup = () => {
        if (focusTimer !== null) {
          clearTimeout(focusTimer);
          focusTimer = null;
        }
        inp.removeEventListener('cancel', onCancel);
        inp.removeEventListener('change', onChange);
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('focus', onWindowFocus);
        }
        if (typeof inp.remove === 'function') inp.remove();
      };

      const finish = val => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      };

      const onCancel = () => {
        finish(null);
      };

      const onWindowFocus = () => {
        if (settled || handlingChange || focusTimer !== null) return;
        focusTimer = setTimeout(() => {
          if (!handlingChange) finish(null);
        }, 400);
      };

      const onChange = async () => {
        if (settled || handlingChange) return;
        handlingChange = true;
        const f = inp.files && inp.files[0];
        cleanup();
        if (!f) { finish(null); return; }
        if (f.size < 44 || f.size > maxIrBytes) { finish(false); return; }
        try {
          const ab = await f.arrayBuffer();
          const dec = decodeWavMonoJs(ab);
          if (!dec) { finish(false); return; }
          finish(applyUserIrMono(slot, f.name, dec.mono, dec.sampleRate));
        } catch (_) {
          finish(false);
        }
      };

      inp.addEventListener('cancel', onCancel);
      inp.addEventListener('change', onChange);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', onWindowFocus);
      }

      try {
        document.body.appendChild(inp);
        inp.click();
      } catch (_) {
        finish(null);
      }
    });
  }

  // ==========================================================================
  // Cross-Compatible .wdcab / .xml Preset Export & Import (pluginVersion="6")
  // ==========================================================================
  function encodeUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF) {
        if (i + 1 < str.length) {
          const lo = str.charCodeAt(i + 1);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            i++;
          } else {
            cp = 0xFFFD;
          }
        } else {
          cp = 0xFFFD;
        }
      } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
        cp = 0xFFFD;
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
    return new Uint8Array(out);
  }

  function decodeStrictUtf8Bytes(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (_) {
        return null;
      }
    }
    let out = '';
    let i = 0;
    const n = bytes.length;
    while (i < n) {
      const b0 = bytes[i++];
      if (b0 <= 0x7F) {
        out += String.fromCharCode(b0);
      } else if (b0 >= 0xC2 && b0 <= 0xDF) {
        if (i >= n) return null;
        const b1 = bytes[i++];
        if ((b1 & 0xC0) !== 0x80) return null;
        out += String.fromCharCode(((b0 & 0x1F) << 6) | (b1 & 0x3F));
      } else if (b0 >= 0xE0 && b0 <= 0xEF) {
        if (i + 1 >= n) return null;
        const b1 = bytes[i++], b2 = bytes[i++];
        if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80) return null;
        if (b0 === 0xE0 && b1 < 0xA0) return null;
        if (b0 === 0xED && b1 > 0x9F) return null;
        out += String.fromCharCode(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
      } else if (b0 >= 0xF0 && b0 <= 0xF4) {
        if (i + 2 >= n) return null;
        const b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++];
        if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80) return null;
        if (b0 === 0xF0 && b1 < 0x90) return null;
        if (b0 === 0xF4 && b1 > 0x8F) return null;
        const cp = (((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)) - 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else {
        return null;
      }
    }
    return out;
  }

  function escapeXmlAttr(raw) {
    const s = String(raw == null ? '' : raw);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < s.length) {
          const lo = s.charCodeAt(i + 1);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            out += s[i] + s[i + 1];
            i++;
            continue;
          }
        }
        continue;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) continue;
      if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) ||
          code === 0x7F || code === 0xFFFE || code === 0xFFFF) {
        continue;
      }
      const c = s[i];
      if (c === '&') out += '&amp;';
      else if (c === '<') out += '&lt;';
      else if (c === '>') out += '&gt;';
      else if (c === '"') out += '&quot;';
      else if (c === "'") out += '&apos;';
      else out += c;
    }
    return out;
  }

  function float32ArrayToBase64Le(arr, taps) {
    const byteLen = taps * 4;
    const bytes = new Uint8Array(byteLen);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < taps; i++) {
      const v = (arr && i < arr.length && Number.isFinite(arr[i])) ? arr[i] : 0.0;
      dv.setFloat32(i * 4, v, true);
    }
    let bin = '';
    const chunk = 8192;
    for (let off = 0; off < byteLen; off += chunk) {
      const end = Math.min(byteLen, off + chunk);
      bin += String.fromCharCode.apply(null, bytes.subarray(off, end));
    }
    return btoa(bin);
  }

  function base64ToFloat32ArrayLe(b64Str, taps) {
    const clean = String(b64Str || '');
    if (clean.length === 0 || clean.length > 65536) return null;
    try {
      const bin = atob(clean.replace(/\s+/g, ''));
      if (bin.length !== taps * 4) return null;
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const dv = new DataView(bytes.buffer);
      const out = new Float32Array(taps);
      let energySum = 0.0;
      for (let i = 0; i < taps; i++) {
        const f = dv.getFloat32(i * 4, true);
        if (!Number.isFinite(f) || Math.abs(f) > 100.0) return null;
        out[i] = f;
        energySum += f * f;
      }
      if (energySum <= 1.0e-18) return null;
      return out;
    } catch (_) {
      return null;
    }
  }

  function appendUserIrXmlLines(lines, indent, slot, irRec) {
    if (!irRec || !irRec.active) return;
    const srcRef = irRec.ref48k || (irRec.prepared ? irRec.prepared.ref48k : null);
    if (!srcRef || srcRef.length <= 0) return;
    let taps = irRec.refLen || srcRef.length;
    if (taps < 2048) taps = 2048;
    else if (taps > 8192) taps = 8192;
    if ((taps & (taps - 1)) !== 0) taps = 2048;
    const dataB64 = float32ArrayToBase64Le(srcRef, taps);
    const slotLabel = slot === 0 ? 'A' : 'B';
    lines.push(`${indent}<USER_IR slot="${slotLabel}" name="${escapeXmlAttr(irRec.name || 'Custom IR')}" taps="${taps}" data="${dataB64}"/>`);
  }

  function exportPresetXmlString() {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('');
    let rootAttrs = `pluginVersion="6"`;
    if (activePresetIndex >= 0 && activePresetIndex < RIG_PRESETS.length) {
      rootAttrs += ` activePresetIndex="${activePresetIndex}"`;
    }
    if (preferAmpCab && isPowerAmpOn()) {
      rootAttrs += ` preferAmpCab="1"`;
    }
    lines.push(`<WDAMP_STATE ${rootAttrs}>`);
    for (let i = 0; i < NUM_PARAMS; i++) {
      const def = PARAM_LIST[i];
      const v = Number.isFinite(rawParams[i]) ? rawParams[i] : (def.type === 'toggle' ? (def.def ? 1.0 : 0.0) : def.def);
      lines.push(`  <PARAM id="${escapeXmlAttr(def.id)}" value="${v}"/>`);
    }
    for (let slot = 0; slot < 2; slot++) {
      appendUserIrXmlLines(lines, '  ', slot, userIrState[slot]);
    }
    const activeAb = (abSlotActive === 1) ? 1 : 0;
    const inactiveAb = 1 - activeAb;
    const inactiveSlot = abSlots[inactiveAb];
    let abAttrs = `active="${activeAb === 0 ? 'A' : 'B'}"`;
    if (inactiveSlot && inactiveSlot.activePresetIndex >= 0 && inactiveSlot.activePresetIndex < RIG_PRESETS.length) {
      abAttrs += ` activePresetIndex="${inactiveSlot.activePresetIndex}"`;
    }
    if (inactiveSlot && inactiveSlot.preferAmpCab && inactiveSlot.params && inactiveSlot.params[POWER_AMP_PARAM_IDX] >= 0.5) {
      abAttrs += ` preferAmpCab="1"`;
    }
    lines.push(`  <AB_COMPARE ${abAttrs}>`);
    for (let i = 0; i < NUM_PARAMS; i++) {
      const def = PARAM_LIST[i];
      const fallback = def.type === 'toggle' ? (def.def ? 1.0 : 0.0) : def.def;
      const v = (inactiveSlot && inactiveSlot.params && Number.isFinite(inactiveSlot.params[i]))
        ? inactiveSlot.params[i]
        : fallback;
      lines.push(`    <PARAM id="${escapeXmlAttr(def.id)}" value="${v}"/>`);
    }
    if (inactiveSlot && inactiveSlot.userIrs) {
      for (let slot = 0; slot < 2; slot++) {
        appendUserIrXmlLines(lines, '    ', slot, inactiveSlot.userIrs[slot]);
      }
    }
    lines.push('  </AB_COMPARE>');
    lines.push('</WDAMP_STATE>');
    return lines.join('\n');
  }

  function decodeXmlEntitiesStrict(raw) {
    let out = '';
    const n = raw.length;
    let i = 0;
    while (i < n) {
      const c = raw[i];
      if (c !== '&') {
        out += c;
        i++;
        continue;
      }
      const semi = raw.indexOf(';', i + 1);
      if (semi <= i + 1 || semi - i > 16) return null;
      const ref = raw.slice(i + 1, semi);
      if (ref === 'amp') out += '&';
      else if (ref === 'lt') out += '<';
      else if (ref === 'gt') out += '>';
      else if (ref === 'quot') out += '"';
      else if (ref === 'apos') out += "'";
      else if (ref.startsWith('#x') || ref.startsWith('#X')) {
        const hex = ref.slice(2);
        if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
        const cp = parseInt(hex, 16);
        if (!Number.isFinite(cp) || cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) ||
            (cp < 0x20 && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D)) {
          return null;
        }
        out += cp > 0xFFFF ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      } else if (ref.startsWith('#')) {
        const dec = ref.slice(1);
        if (!/^[0-9]+$/.test(dec)) return null;
        const cp = parseInt(dec, 10);
        if (!Number.isFinite(cp) || cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) ||
            (cp < 0x20 && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D)) {
          return null;
        }
        out += cp > 0xFFFF ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      } else {
        return null;
      }
      i = semi + 1;
    }
    return out;
  }

  function isAsciiWs(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  function parseSafeXmlTree(input) {
    if (input === null || input === undefined) return null;
    let xmlStr = null;
    if (typeof input === 'string') {
      if (input.length === 0 || input.indexOf('\0') !== -1) return null;
      const utf8 = encodeUtf8Bytes(input);
      if (utf8.byteLength === 0 || utf8.byteLength > MAX_STATE_BYTES) return null;
      xmlStr = input;
    } else {
      let bytes = null;
      if (input instanceof Uint8Array) bytes = input;
      else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_STATE_BYTES) return null;
      let len = bytes.byteLength;
      if (len > 0 && bytes[len - 1] === 0) len--;
      if (len <= 0) return null;
      for (let i = 0; i < len; i++) {
        if (bytes[i] === 0) return null;
      }
      xmlStr = decodeStrictUtf8Bytes(bytes.subarray(0, len));
      if (!xmlStr) return null;
    }

    if (xmlStr.charCodeAt(0) === 0xFEFF) {
      xmlStr = xmlStr.slice(1);
    }
    const n = xmlStr.length;
    if (n === 0) return null;

    const lower = xmlStr.toLowerCase();
    if (lower.indexOf('<!doctype') !== -1 || lower.indexOf('<!entity') !== -1) {
      return null;
    }

    const stack = [];
    let root = null;
    let sawRoot = false;
    let i = 0;

    while (i < n) {
      const lt = xmlStr.indexOf('<', i);
      if (lt === -1) {
        const tail = xmlStr.slice(i);
        if (stack.length === 0) {
          for (let k = 0; k < tail.length; k++) {
            if (!isAsciiWs(tail[k])) return null;
          }
        }
        if (decodeXmlEntitiesStrict(tail) === null) return null;
        break;
      }

      if (lt > i) {
        const text = xmlStr.slice(i, lt);
        if (stack.length === 0) {
          for (let k = 0; k < text.length; k++) {
            if (!isAsciiWs(text[k])) return null;
          }
        }
        if (decodeXmlEntitiesStrict(text) === null) return null;
      }

      if (lt + 1 >= n) return null;
      const next = xmlStr[lt + 1];

      if (next === '?') {
        const closePi = xmlStr.indexOf('?>', lt + 2);
        if (closePi === -1) return null;
        const piBody = xmlStr.slice(lt + 2, closePi);
        if (/^xml(?:\s|$)/i.test(piBody)) {
          const encMatch = piBody.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]*)\1/i);
          if (/\bencoding\b/i.test(piBody)) {
            if (!encMatch || encMatch[2].toLowerCase() !== 'utf-8') return null;
          }
        }
        i = closePi + 2;
        continue;
      }

      if (next === '!') {
        if (xmlStr.startsWith('<!--', lt)) {
          const closeCmt = xmlStr.indexOf('-->', lt + 4);
          if (closeCmt === -1) return null;
          i = closeCmt + 3;
          continue;
        }
        if (stack.length > 0 && xmlStr.startsWith('<![CDATA[', lt)) {
          const closeCdata = xmlStr.indexOf(']]>', lt + 9);
          if (closeCdata === -1) return null;
          i = closeCdata + 3;
          continue;
        }
        return null;
      }

      if (next === '/') {
        if (stack.length === 0) return null;
        const closeEnd = xmlStr.indexOf('>', lt + 2);
        if (closeEnd === -1) return null;
        const closeBody = xmlStr.slice(lt + 2, closeEnd);
        if (closeBody.indexOf('<') !== -1 || closeBody.indexOf('"') !== -1 || closeBody.indexOf("'") !== -1) return null;
        const tagName = closeBody.trim();
        if (!tagName || tagName !== closeBody.replace(/\s+$/, '') || !/^[A-Za-z_:][A-Za-z0-9._:-]*$/.test(tagName)) return null;
        const top = stack.pop();
        if (top.tag !== tagName) return null;
        i = closeEnd + 1;
        continue;
      }

      if (isAsciiWs(next) || next === '>' || next === '<') return null;
      if (stack.length === 0 && sawRoot) return null;
      if (stack.length + 1 > 16) return null;

      let j = lt + 1;
      while (j < n && !isAsciiWs(xmlStr[j]) && xmlStr[j] !== '>' && xmlStr[j] !== '/') {
        const ch = xmlStr[j];
        if (ch === '<' || ch === '"' || ch === "'" || ch === '&') return null;
        j++;
      }
      const tagName = xmlStr.slice(lt + 1, j);
      if (!/^[A-Za-z_:][A-Za-z0-9._:-]*$/.test(tagName)) return null;

      const attrs = Object.create(null);
      let selfClosing = false;
      let closedTag = false;
      while (j < n) {
        while (j < n && isAsciiWs(xmlStr[j])) j++;
        if (j >= n) return null;
        if (xmlStr[j] === '>') {
          closedTag = true;
          j++;
          break;
        }
        if (xmlStr[j] === '/' && j + 1 < n && xmlStr[j + 1] === '>') {
          selfClosing = true;
          closedTag = true;
          j += 2;
          break;
        }
        const attrStart = j;
        while (j < n && !isAsciiWs(xmlStr[j]) && xmlStr[j] !== '=' && xmlStr[j] !== '>' && xmlStr[j] !== '/') {
          const ch = xmlStr[j];
          if (ch === '<' || ch === '"' || ch === "'" || ch === '&') return null;
          j++;
        }
        const attrName = xmlStr.slice(attrStart, j);
        if (!/^[A-Za-z_:][A-Za-z0-9._:-]*$/.test(attrName)) return null;
        while (j < n && isAsciiWs(xmlStr[j])) j++;
        if (j >= n || xmlStr[j] !== '=') return null;
        j++;
        while (j < n && isAsciiWs(xmlStr[j])) j++;
        if (j >= n || (xmlStr[j] !== '"' && xmlStr[j] !== "'")) return null;
        const quote = xmlStr[j++];
        const valStart = j;
        while (j < n && xmlStr[j] !== quote) {
          if (xmlStr[j] === '<') return null;
          j++;
        }
        if (j >= n) return null;
        const rawVal = xmlStr.slice(valStart, j);
        const decodedVal = decodeXmlEntitiesStrict(rawVal);
        if (decodedVal === null) return null;
        attrs[attrName] = decodedVal;
        j++;
      }
      if (!closedTag) return null;

      const node = { tag: tagName, attrs, children: [] };
      if (stack.length === 0) {
        root = node;
        sawRoot = true;
      } else {
        stack[stack.length - 1].children.push(node);
      }
      if (!selfClosing) {
        stack.push(node);
      }
      i = j;
    }

    if (!sawRoot || stack.length !== 0 || !root) return null;
    return root;
  }

  function tryParseStrictIntJs(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!/^[+-]?\d+$/.test(t)) return null;
    const v = Number(t);
    return Number.isSafeInteger(v) ? v : null;
  }

  function tryParseStrictNumberJs(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }

  function parseParamChildrenFromXmlNode(parentEl) {
    const out = new Float64Array(NUM_PARAMS);
    for (let i = 0; i < NUM_PARAMS; i++) {
      const def = PARAM_LIST[i];
      out[i] = def.type === 'toggle' ? (def.def ? 1.0 : 0.0) : def.def;
    }
    if (!parentEl || !Array.isArray(parentEl.children)) return out;
    for (const child of parentEl.children) {
      if (!child || child.tag !== 'PARAM' || !child.attrs) continue;
      const id = child.attrs.id;
      const valRaw = child.attrs.value;
      if (typeof id !== 'string' || typeof valRaw !== 'string') continue;
      const def = PARAM_BY_ID.get(id);
      if (!def) continue;
      const num = tryParseStrictNumberJs(valRaw);
      if (num === null) continue;
      if (def.type === 'toggle') {
        out[def.idx] = num >= 0.5 ? 1.0 : 0.0;
      } else if (def.type === 'combo') {
        const nChoices = Math.max(1, (def.choices || []).length);
        out[def.idx] = Math.max(0, Math.min(nChoices - 1, Math.round(num)));
      } else {
        let clamped = Math.max(def.min, Math.min(def.max, num));
        if (def.step && def.step > 0.0) {
          clamped = def.min + Math.round((clamped - def.min) / def.step) * def.step;
          clamped = Math.round(clamped * 1e6) / 1e6;
          clamped = Math.max(def.min, Math.min(def.max, clamped));
        }
        out[def.idx] = clamped;
      }
    }
    return out;
  }

  function parseUserIrElementJs(child) {
    if (!child || child.tag !== 'USER_IR' || !child.attrs) return null;
    const slotAttr = child.attrs.slot;
    const dataAttr = child.attrs.data;
    if (typeof slotAttr !== 'string' || typeof dataAttr !== 'string') return null;
    let slot = -1;
    if (slotAttr === 'A' || slotAttr === '0') slot = 0;
    else if (slotAttr === 'B' || slotAttr === '1') slot = 1;
    if (slot < 0) return null;

    let taps = 2048;
    if (typeof child.attrs.taps === 'string') {
      const parsedTaps = tryParseStrictIntJs(child.attrs.taps);
      if (parsedTaps === null || parsedTaps < 2048 || parsedTaps > 8192 || (parsedTaps & (parsedTaps - 1)) !== 0) {
        return null;
      }
      taps = parsedTaps;
    }

    const ref48k = base64ToFloat32ArrayLe(dataAttr, taps);
    if (!ref48k) return null;
    const name = sanitizeUserIrNameJs(typeof child.attrs.name === 'string' ? child.attrs.name : 'Custom IR');
    return { slot, taps, name, ref48k };
  }

  function parseUserIrChildrenFromXmlNode(parentEl) {
    const slots = [makeDefaultUserIrRecord(), makeDefaultUserIrRecord()];
    if (!parentEl || !Array.isArray(parentEl.children)) return slots;
    for (const child of parentEl.children) {
      const parsed = parseUserIrElementJs(child);
      if (!parsed) continue;
      slots[parsed.slot] = {
        active: true,
        name: parsed.name,
        wave: [],
        mono: null,
        ref48k: parsed.ref48k,
        refLen: parsed.taps,
        sampleRate: 48000,
        prepared: null,
      };
    }
    return slots;
  }

  function importPresetXml(input) {
    const root = parseSafeXmlTree(input);
    if (!root || root.tag !== 'WDAMP_STATE') return false;

    const liveParams = parseParamChildrenFromXmlNode(root);
    const liveIrs = parseUserIrChildrenFromXmlNode(root);
    let parsedPresetIdx = -1;
    if (typeof root.attrs.activePresetIndex === 'string') {
      const pIdx = tryParseStrictIntJs(root.attrs.activePresetIndex);
      if (pIdx !== null && pIdx >= 0 && pIdx < RIG_PRESETS.length) {
        parsedPresetIdx = pIdx;
      }
    }

    let pluginVer = 0;
    if (typeof root.attrs.pluginVersion === 'string') {
      const v = tryParseStrictIntJs(root.attrs.pluginVersion);
      if (v !== null) pluginVer = v;
    }

    const abEl = root.children.find(c => c && c.tag === 'AB_COMPARE') || null;
    const rootPrefAttr = typeof root.attrs.preferAmpCab === 'string' ? root.attrs.preferAmpCab.trim().toLowerCase() : '';
    const liveSlot = {
      params: liveParams,
      activePresetIndex: parsedPresetIdx,
      presetVisualDirty: !!(liveIrs[0].active || liveIrs[1].active),
      preferAmpCab: (rootPrefAttr === '1' || rootPrefAttr === 'true') && (liveParams[POWER_AMP_PARAM_IDX] >= 0.5),
      userIrs: liveIrs,
    };

    if (pluginVer <= 4 || !abEl) {
      abSlotActive = 0;
      abSlots[0] = {
        params: new Float64Array(liveSlot.params),
        activePresetIndex: liveSlot.activePresetIndex,
        presetVisualDirty: liveSlot.presetVisualDirty,
        preferAmpCab: liveSlot.preferAmpCab,
        userIrs: [cloneUserIrRecord(liveSlot.userIrs[0]), cloneUserIrRecord(liveSlot.userIrs[1])],
      };
      abSlots[1] = {
        params: new Float64Array(liveSlot.params),
        activePresetIndex: liveSlot.activePresetIndex,
        presetVisualDirty: liveSlot.presetVisualDirty,
        preferAmpCab: liveSlot.preferAmpCab,
        userIrs: [cloneUserIrRecord(liveSlot.userIrs[0]), cloneUserIrRecord(liveSlot.userIrs[1])],
      };
    } else {
      const activeAttr = (abEl.attrs && abEl.attrs.active) || 'A';
      const activeAb = (activeAttr === 'B' || activeAttr === '1') ? 1 : 0;
      const inactiveAb = 1 - activeAb;
      abSlotActive = activeAb;
      abSlots[activeAb] = liveSlot;

      const inactiveParams = parseParamChildrenFromXmlNode(abEl);
      const inactiveIrs = parseUserIrChildrenFromXmlNode(abEl);
      let inactivePresetIdx = -1;
      if (abEl.attrs && typeof abEl.attrs.activePresetIndex === 'string') {
        const abP = tryParseStrictIntJs(abEl.attrs.activePresetIndex);
        if (abP !== null && abP >= 0 && abP < RIG_PRESETS.length) {
          inactivePresetIdx = abP;
        }
      }
      const abPrefAttr = (abEl.attrs && typeof abEl.attrs.preferAmpCab === 'string')
        ? abEl.attrs.preferAmpCab.trim().toLowerCase()
        : '';
      abSlots[inactiveAb] = {
        params: inactiveParams,
        activePresetIndex: inactivePresetIdx,
        presetVisualDirty: !!(inactiveIrs[0].active || inactiveIrs[1].active),
        preferAmpCab: (abPrefAttr === '1' || abPrefAttr === 'true') && (inactiveParams[POWER_AMP_PARAM_IDX] >= 0.5),
        userIrs: inactiveIrs,
      };
    }

    applyAbSlotToLive(abSlots[abSlotActive], true);
    return true;
  }

  function sanitizePresetBaseName(raw) {
    const allowed = String(raw || '')
      .replace(/[^abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_\- ]+/g, '')
      .trim()
      .slice(0, 64)
      .trim();
    return allowed || 'WD_Cab_Preset';
  }

  function savePresetFile(suggestedName) {
    try {
      if (typeof document === 'undefined' || !document.body || typeof Blob === 'undefined') {
        return false;
      }
      const xmlStr = exportPresetXmlString();
      if (!xmlStr) return false;
      const baseName = sanitizePresetBaseName(suggestedName);
      const blob = new Blob([xmlStr], { type: 'application/xml;charset=utf-8' });
      const url = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
        ? URL.createObjectURL(blob)
        : '';
      if (!url) return false;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.wdcab`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      if (typeof a.remove === 'function') a.remove();
      setTimeout(() => {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(url);
          }
        } catch (_) {}
      }, 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  function openPresetFilePicker() {
    if (presetPickerActive) return Promise.resolve(null);
    presetPickerActive = true;
    return new Promise(resolve => {
      if (typeof document === 'undefined' || !document.body) {
        presetPickerActive = false;
        resolve(null);
        return;
      }
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.wdcab,.xml,application/xml,text/xml';
      inp.style.display = 'none';
      let settled = false;
      let handlingChange = false;
      let focusTimer = null;

      const cleanup = () => {
        if (focusTimer !== null) {
          clearTimeout(focusTimer);
          focusTimer = null;
        }
        inp.removeEventListener('cancel', onCancel);
        inp.removeEventListener('change', onChange);
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('focus', onWindowFocus);
        }
        if (typeof inp.remove === 'function') inp.remove();
      };

      const finish = val => {
        if (settled) return;
        settled = true;
        presetPickerActive = false;
        cleanup();
        resolve(val);
      };

      const onCancel = () => {
        finish(null);
      };

      const onWindowFocus = () => {
        if (settled || handlingChange || focusTimer !== null) return;
        focusTimer = setTimeout(() => {
          if (!handlingChange) finish(null);
        }, 400);
      };

      const onChange = async () => {
        if (settled || handlingChange) return;
        handlingChange = true;
        const f = inp.files && inp.files[0];
        cleanup();
        if (!f) { finish(null); return; }
        if (typeof f.size === 'number' && (f.size <= 0 || f.size > MAX_STATE_BYTES)) {
          finish(false);
          return;
        }
        try {
          const ab = await f.arrayBuffer();
          finish(importPresetXml(ab));
        } catch (_) {
          finish(false);
        }
      };

      inp.addEventListener('cancel', onCancel);
      inp.addEventListener('change', onChange);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', onWindowFocus);
      }

      try {
        document.body.appendChild(inp);
        inp.click();
      } catch (_) {
        finish(null);
      }
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
      activePresetIndex: (typeof getDisplayedPresetIndex === 'function')
        ? getDisplayedPresetIndex()
        : (typeof activePresetIndex !== 'undefined' ? activePresetIndex : -1),
      abSlotActive:      typeof abSlotActive !== 'undefined' ? abSlotActive : 0,
      preferAmpCab:      (typeof preferAmpCab !== 'undefined' && typeof isPowerAmpOn === 'function') ? !!(preferAmpCab && isPowerAmpOn()) : false,
      cabADelta:         typeof cabDelta !== 'undefined' && !!cabDelta[0],
      cabBDelta:         typeof cabDelta !== 'undefined' && !!cabDelta[1],
      cabACustomIr:      typeof userIrState !== 'undefined' && !!(userIrState && userIrState[0].active),
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
        .then(mod => {
          clearTransportError('wasm');
          return mod;
        })
        .catch(err => {
          modulePromise = null;
          throw err;
        });
    }
    return modulePromise;
  }

  const uiEngine = { wasm: null, telemPtr: 0, fs: 48000 };
  let pendingStatusError = '';
  let pendingErrorSource = '';
  let uiEngineInitPromise = null;
  function setTransportError(msg, source = 'play') {
    const text = String(msg || '').trim();
    if (!text) return;
    pendingStatusError = text;
    pendingErrorSource = source || 'play';
    if (statusEl) {
      statusEl.textContent = text;
    }
    if (errorTextEl && errorBanner) {
      errorTextEl.textContent = text;
      errorBanner.hidden = false;
    }
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      fitStageWithBar();
    }
  }
  function clearTransportError(onlySource = null) {
    if (onlySource && pendingErrorSource !== onlySource) return;
    if (!pendingStatusError && (!errorBanner || errorBanner.hidden)) return;
    const prevErr = pendingStatusError;
    pendingStatusError = '';
    pendingErrorSource = '';
    if (errorBanner) {
      errorBanner.hidden = true;
    }
    if (errorTextEl) {
      errorTextEl.textContent = '';
    }
    if (statusEl && statusEl.textContent === prevErr) {
      updateTransportUI();
    }
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      fitStageWithBar();
    }
  }
  function clearPendingStatusError() {
    clearTransportError();
  }
  function initUiWasmEngine() {
    if (uiEngine.wasm) return Promise.resolve(uiEngine.wasm);
    if (!uiEngineInitPromise) {
      uiEngineInitPromise = getWasmModule()
        .then(m => WebAssembly.instantiate(m, stubImports(m)))
        .then(instance => {
          uiEngine.wasm = instance.exports;
          clearTransportError('wasm');
          const targetSr = (audio.ctx && Number.isFinite(audio.ctx.sampleRate) && audio.ctx.sampleRate > 0)
            ? audio.ctx.sampleRate
            : uiEngine.fs;
          uiEngine.fs = targetSr;
          uiEngine.wasm.wdcab_init(uiEngine.fs);
          uiEngine.telemPtr = uiEngine.wasm.wdcab_telem() >> 2;
          for (let slot = 0; slot < 2; slot++) {
            const st = userIrState[slot];
            if (!st || !st.active) continue;
            if (st.mono) {
              const res = loadUserIrIntoUiEngine(slot, st.mono, st.sampleRate);
              if (res && res.ok) {
                const ref48k = (res.prepared && res.prepared.ref48k) ? new Float32Array(res.prepared.ref48k) : st.ref48k;
                const refLen = ref48k ? ref48k.length : st.refLen;
                userIrState[slot] = {
                  active: true,
                  name: st.name,
                  wave: res.wave,
                  mono: st.mono.slice(0, res.copyLen),
                  ref48k,
                  refLen,
                  sampleRate: st.sampleRate,
                  prepared: res.prepared,
                };
                clearUserIrError(slot);
                syncUserIrToWorklet(slot);
              } else {
                userIrState[slot] = makeDefaultUserIrRecord();
                flashUserIrError(slot);
                syncClearedUserIrToWorklet(slot);
              }
            } else if (st.ref48k && st.ref48k.length > 0) {
              const res = loadUserIrRef48kIntoUiEngine(slot, st.ref48k, st.refLen || st.ref48k.length, st.name);
              if (res && res.ok) {
                userIrState[slot] = {
                  active: true,
                  name: st.name,
                  wave: res.wave,
                  mono: null,
                  ref48k: (res.prepared && res.prepared.ref48k) ? new Float32Array(res.prepared.ref48k) : st.ref48k,
                  refLen: st.refLen || st.ref48k.length,
                  sampleRate: uiEngine.fs,
                  prepared: res.prepared,
                };
                clearUserIrError(slot);
                syncUserIrToWorklet(slot);
              } else {
                userIrState[slot] = makeDefaultUserIrRecord();
                flashUserIrError(slot);
                syncClearedUserIrToWorklet(slot);
              }
            }
          }
          syncUiEngineAndEmit();
          return uiEngine.wasm;
        })
        .catch(err => {
          setTransportError(formatAudioError(err), 'wasm');
          return null;
        })
        .finally(() => {
          uiEngineInitPromise = null;
        });
    }
    return uiEngineInitPromise;
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
        const params = new Float64Array(rawParams);
        audio.node.port.postMessage({ type: 'controls', params }, [params.buffer]);
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

    setTransportError(formatAudioError(errText), 'play');
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
            if (!uiEngine.wasm) {
              await initUiWasmEngine();
            }
            clearTransportError('wasm');
            clearTransportError('play');
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
                  const params = new Float64Array(rawParams);
                  node.port.postMessage({ type: 'controls', params }, [params.buffer]);
                  node.port.postMessage({ type: 'setCabDelta', slot: 0, enabled: !!cabDelta[0] });
                  node.port.postMessage({ type: 'setCabDelta', slot: 1, enabled: !!cabDelta[1] });
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
            {
              const params = new Float64Array(rawParams);
              node.port.postMessage({ type: 'controls', params }, [params.buffer]);
              node.port.postMessage({ type: 'setCabDelta', slot: 0, enabled: !!cabDelta[0] });
              node.port.postMessage({ type: 'setCabDelta', slot: 1, enabled: !!cabDelta[1] });
            }
            for (let slot = 0; slot < 2; slot++) {
              if (userIrState[slot] && userIrState[slot].active) {
                const prepared = extractPreparedUserIrFromUiEngine(slot) || userIrState[slot].prepared;
                if (prepared) {
                  userIrState[slot].prepared = prepared;
                  postPreparedUserIrToWorklet(node, slot, prepared);
                } else if (userIrState[slot].mono) {
                  const samples = userIrState[slot].mono.slice();
                  node.port.postMessage(
                    {
                      type: 'loadUserIr',
                      slot,
                      samples,
                      sampleRate: userIrState[slot].sampleRate,
                    },
                    [samples.buffer]
                  );
                }
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
            setTransportError(formatAudioError(err), 'play');
            throw err;
          }
        })();
      }
      await audio.initPromise;
    }
    if (!uiEngine.wasm) {
      await initUiWasmEngine();
    }
    clearTransportError('wasm');
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
        setTransportError('Clip load failed: ' + audio.activeClipId, 'play');
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

      clearTransportError('wasm');
      clearTransportError('play');
      updateTransportUI(!!pendingStatusError);
    } catch (err) {
      if (reqId === audio.playRequestId) {
        stopActiveSource();
        audio.playing = false;
        audio.starting = false;
        updateTransportUI(!!pendingStatusError);
        setTransportError(formatAudioError(err), 'play');
      }
    } finally {
      if (reqId === audio.playRequestId) {
        audio.starting = false;
        updateTransportUI(true);
      }
    }
  }

  async function selectClip(clipId) {
    const wasPlaying = audio.playing || audio.starting;
    const curPos = currentPlayheadSec();
    audio.activeClipId = clipId;
    updateTransportUI(!!pendingStatusError);
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
          updateTransportUI(!!pendingStatusError);
          setTransportError('Clip load failed: ' + clipId, 'play');
          return;
        }
        const dur = (buf && Number.isFinite(buf.duration) && buf.duration > 0) ? buf.duration : 11.3;
        audio.playStartOffset = Math.min(curPos, dur);
        updateTransportUI(!!pendingStatusError);
      } catch (err) {
        if (reqId === audio.playRequestId) {
          stopActiveSource();
          audio.playing = false;
          audio.starting = false;
          updateTransportUI(!!pendingStatusError);
          setTransportError('Clip load failed: ' + (err && err.message ? err.message : clipId), 'play');
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
        updateTransportUI(!!pendingStatusError);
        setTransportError('Clip load failed: ' + clipId, 'play');
        return;
      }
      const targetSec = Math.min(buf.duration * 0.999, Math.max(0, clampedPct * buf.duration));
      audio.playStartOffset = targetSec;
      if (wasPlaying) {
        await startPlayback(targetSec, 12);
      } else {
        updateTransportUI(!!pendingStatusError);
      }
    } catch (err) {
      if (reqId === audio.playRequestId) {
        stopActiveSource();
        audio.playing = false;
        audio.starting = false;
        updateTransportUI(!!pendingStatusError);
        setTransportError(formatAudioError(err), 'play');
      }
    }
  }

  // ==========================================================================
  // Curated Rig Presets (Applies via host states so all knobs/stages redraw)
  // ==========================================================================
  const RIG_PRESETS = [
    {
      name: '1. Studio Blend · 4x12 Pair',
      desc: 'Studio Blend · Modern 4x12 (57/73) + Vintage 4x12 (121/12)',
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
      name: '2. Tight Modern Metal',
      desc: 'Tight Modern Metal · Oversized 4x12 (57/12) + Modern 4x12 (421/73)',
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
      name: '3. Plexi Greenback Stack',
      desc: 'Plexi Greenback Stack · Vintage 4x12 (57/REDD + 121/76)',
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
      name: '4. Cranked Motor & Cone Cry',
      desc: 'Cranked Motor & Cone Cry · Loose 16Ω Hi-Z + Undoped Cone',
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
      name: '5. Live Room + Wall Mic',
      desc: 'Live Studio Room + Boundary Wall Mic · Ambient Chamber',
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
      name: '6. Boutique Alnico Chime',
      desc: 'Boutique Alnico Chime · 2x12 Alnico (160/73) + 1x10 Tweed (414/12)',
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
      name: '7. Tweed Combo Push',
      desc: 'Tweed Combo Push · 1x10 Tweed (906/REDD) + Open 1x12 (160/76)',
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
      name: '8. Ported Thump Rig',
      desc: 'Ported Thump Rig · 1x12 Ported (57/12) + Modern 4x12 (160/73)',
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
      name: '9. British 75W Roar',
      desc: 'British 75W Roar · 4x12 Brit 75 (906/73) + Vintage 4x12 (414/12)',
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
      name: '10. Garage Thrash Smash',
      desc: 'Garage Thrash Smash · Tiled Garage + Duress Smash',
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
      name: '11. SVT Arena Wall',
      desc: 'SVT Arena Wall · 8x10 Sealed (47/73) + 1x15 Vintage (414/12)',
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
      name: '12. Lo-Fi Garage Cassette',
      desc: 'Lo-Fi Garage Cassette · 1x10 Tweed (57/Porta) + Garage Smash',
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

  const AMP_SECTION_PARAM_IDS = new Set([
    'loadEnabled', 'guitarVol', 'guitarTone', 'cableLenM', 'reactiveMode',
    'loadPickupModel', 'loadWiring', 'loadBleedType', 'loadCablePreset', 'loadDielectricLoss', 'loadCouplingProfile',
    'gateEnabled', 'gateThresh', 'gateRelease',
    'boostEnabled', 'boostTopo', 'boostDrive', 'boostTone', 'boostLevel',
    'preampEnabled', 'channel', 'preampGain', 'bass', 'mid', 'treble', 'preampBias', 'preampAge',
    'powerAmpEnabled', 'rectifier', 'powerBias', 'powerAge', 'xfmrDrive',
    'fxLoopEnabled', 'fxLoopMode', 'fxLoopTime', 'fxLoopFeedback', 'fxLoopMix'
  ]);

  function applyRigPreset(presetIdx) {
    const preset = RIG_PRESETS[presetIdx];
    if (!preset) return;
    if (typeof dismissWtIrConfirmFn === 'function') dismissWtIrConfirmFn(false, false);
    if (typeof window !== 'undefined' && typeof window.__wdDismissIrConfirm === 'function') {
      window.__wdDismissIrConfirm(false);
    }
    const preserveAmpMode = isPowerAmpOn() && !Object.prototype.hasOwnProperty.call(preset.vals, 'powerAmpEnabled');
    const preservedPreferAmpCab = preserveAmpMode && preferAmpCab;
    presetApplyDepth++;
    try {
      activePresetIndex = presetIdx;
      presetVisualDirty = false;
      preferAmpCab = preservedPreferAmpCab;
      clearCabDeltaState();
      clearUserIrSlot(0, false);
      clearUserIrSlot(1, false);
      for (const def of PARAM_LIST) {
        if (preserveAmpMode && AMP_SECTION_PARAM_IDS.has(def.id)) {
          continue;
        }
        const val = Object.prototype.hasOwnProperty.call(preset.vals, def.id) ? preset.vals[def.id] : def.def;
        if (def.type === 'toggle') {
          host.toggleState(def.id).setValue(!!val);
        } else if (def.type === 'combo') {
          host.comboState(def.id).setChoiceIndex(val);
        } else if (def.type === 'slider') {
          host.sliderState(def.id).setNormalisedValue(toNorm(def, val));
        }
      }
      preferAmpCab = !!(preservedPreferAmpCab && isPowerAmpOn());
      syncPresetSelectElements(getDisplayedPresetIndex());
      syncUiEngineAndEmit();
    } finally {
      presetApplyDepth--;
    }
  }

  // ==========================================================================
  // Build Top Demo Transport Bar & Adjust #stage Viewport Fitting
  // ==========================================================================
  let playBtn, clipBtns = {}, scrubEl, scrubFill, scrubHead, scrubTime, statusEl, presetSel;
  let errorBanner, errorTextEl, retryBtn, dismissBtn, dropCueEl, volPctEl;

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
    const isBootLoading = audio.starting && !audio.ready && !audio.playing;
    if (typeof playBtn.setAttribute === 'function') {
      playBtn.setAttribute('aria-busy', isBootLoading ? 'true' : 'false');
    }
    playBtn.innerHTML = isBootLoading
      ? '<span class="wt-ico">⏳</span> LOADING...'
      : (isEngaged
          ? '<span class="wt-ico">■</span> STOP'
          : '<span class="wt-ico">▶</span> PLAY LOOP');

    for (const [id, btn] of Object.entries(clipBtns)) {
      const isOn = audio.activeClipId === id;
      btn.classList.toggle('on', isOn);
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      }
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

  let lastStageEl = null;
  let lastStageTop = '';
  let lastStageHeight = '';
  let lastStageTransform = '';
  let lastBodyCompact = null;
  function fitStageWithBar() {
    const st = document.getElementById('stage');
    if (!st) return;
    const bar = document.getElementById('webTransport');
    const measuredBarH = bar ? Math.ceil(bar.getBoundingClientRect().height) : 48;
    const barH = (Number.isFinite(measuredBarH) && measuredBarH > 0) ? Math.max(48, measuredBarH) : 48;
    const vw = document.documentElement.clientWidth  || window.innerWidth  || 1180;
    const fullVh = document.documentElement.clientHeight || window.innerHeight || 808;
    const availH = Math.max(200, fullVh - barH);
    const isCompact = vw < 1180 || availH < 760;
    if (isCompact !== lastBodyCompact) {
      if (document.body && document.body.classList) {
        if (isCompact && typeof document.body.classList.add === 'function') {
          document.body.classList.add('wd-web-compact');
        } else if (!isCompact && typeof document.body.classList.remove === 'function') {
          document.body.classList.remove('wd-web-compact');
        }
      }
      lastBodyCompact = isCompact;
    }
    let nextTop;
    let nextHeight;
    let nextTransform;
    if (isCompact) {
      window.__wdStageScale = 1.0;
      nextTop = `${barH}px`;
      nextHeight = `${availH}px`;
      nextTransform = 'none';
    } else {
      const vh = availH;
      const scale = Math.min(vw / 1180, vh / 760);
      window.__wdStageScale = (Number.isFinite(scale) && scale > 0) ? scale : 1.0;
      nextTop = `calc(50% + ${barH * 0.5}px)`;
      nextHeight = '';
      nextTransform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    }
    if (st !== lastStageEl || nextTop !== lastStageTop || st.style.top !== nextTop) {
      st.style.top = nextTop;
      lastStageTop = nextTop;
    }
    if (st !== lastStageEl || nextHeight !== lastStageHeight || st.style.height !== nextHeight) {
      st.style.height = nextHeight;
      lastStageHeight = nextHeight;
    }
    if (st !== lastStageEl || nextTransform !== lastStageTransform || st.style.transform !== nextTransform) {
      st.style.transform = nextTransform;
      lastStageTransform = nextTransform;
    }
    lastStageEl = st;
  }

  function isInteractiveHotkeyTarget(tgt) {
    if (!tgt) return false;
    if (typeof tgt.closest === 'function') {
      if (tgt.closest('INPUT, SELECT, TEXTAREA, BUTTON, A, [contenteditable], [contenteditable=""], [contenteditable="true"], [role="button"], [role="option"], [role="slider"]')) {
        return true;
      }
    }
    const tag = tgt.tagName ? String(tgt.tagName).toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') {
      return true;
    }
    if (tgt.isContentEditable === true) return true;
    if (typeof tgt.getAttribute === 'function') {
      const role = tgt.getAttribute('role');
      if (role === 'button' || role === 'option' || role === 'slider') return true;
      const ce = tgt.getAttribute('contenteditable');
      if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
    }
    if (typeof tgt.hasAttribute === 'function' && tgt.hasAttribute('contenteditable')) {
      return true;
    }
    return false;
  }

  function buildTransportBar() {
    const style = document.createElement('style');
    style.textContent = `
      #webTransport {
        position: fixed; top: 0; left: 0; right: 0; min-height: 48px; height: auto;
        box-sizing: border-box;
        background: linear-gradient(180deg, #1b1d22 0%, #131519 100%);
        border-bottom: 1px solid #686f7e;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55);
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap;
        padding: 6px 12px; gap: 6px 8px; z-index: 9999;
        font-family: 'Barlow', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #eceef2;
      }
      #webTransport :is(button, select, input, [tabindex]):focus-visible,
      .wt-preset-item:focus-visible,
      .wt-ir-confirm-banner button:focus-visible {
        outline: 2px solid #6ec6ff;
        outline-offset: 2px;
      }
      .wt-seg button:focus-visible,
      .wt-scrub:focus-visible,
      .wt-preset-item:focus-visible {
        outline: 2px solid #6ec6ff;
        outline-offset: -2px;
      }
      .wt-left, .wt-center, .wt-right {
        display: flex; align-items: center; gap: 6px; min-width: 0;
      }
      .wt-left { flex: 0 0 auto; }
      .wt-center { flex: 1 1 140px; min-width: 0; max-width: 560px; }
      .wt-right { flex: 0 1 auto; min-width: 0; }
      .wt-badge {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
        color: #ff7eb6; background: rgba(255, 126, 182, 0.14);
        border: 1px solid rgba(255, 126, 182, 0.55);
        padding: 4px 9px; border-radius: 999px; white-space: nowrap;
        flex-shrink: 0;
      }
      .wt-btn {
        height: 30px; padding: 0 10px; border-radius: 999px;
        border: 1px solid #686f7e; background: #181a1f;
        color: #eceef2; font-family: inherit; font-size: 10.5px;
        font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        transition: all 0.12s ease; white-space: nowrap; flex-shrink: 0;
      }
      .wt-btn:hover { border-color: #808899; background: #22252c; }
      .wt-btn.playing {
        background: #ff7eb6; color: #121316; border-color: #ff94c2;
        box-shadow: 0 0 14px rgba(255, 126, 182, 0.42);
      }
      .wt-seg {
        display: inline-flex; background: #111215;
        border: 1px solid #686f7e; border-radius: 999px; padding: 2px; gap: 2px;
        flex-shrink: 0;
      }
      .wt-seg button {
        min-width: 24px; height: 26px; padding: 0 10px; border: none; border-radius: 999px;
        background: transparent; color: #949aa6; font-family: inherit;
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
        flex: 1 1 auto; height: 26px; min-width: 96px;
        background: #111215; border: 1px solid #686f7e;
        border-radius: 999px; position: relative; cursor: pointer;
        overflow: hidden; touch-action: none;
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 0 10px; box-sizing: border-box;
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
        position: relative; z-index: 1;
        flex: 0 0 auto; white-space: nowrap;
        font: 600 10px 'JetBrains Mono', monospace;
        font-variant-numeric: tabular-nums;
        color: #d8dce4;
        pointer-events: none;
      }
      .wt-scrub-status {
        position: relative; z-index: 1;
        flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font: 600 10px 'Barlow', sans-serif; color: #eceef2;
        letter-spacing: 0.04em; pointer-events: none;
      }
      .wt-select {
        height: 28px; padding: 0 10px; border-radius: 999px;
        background: #15171c; color: #eceef2; border: 1px solid #686f7e;
        font-family: inherit; font-size: 10px; font-weight: 600;
        cursor: pointer;
        min-width: 0; max-width: 180px; flex: 0 1 180px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .wt-select:hover { border-color: #808899; }
      .wt-preset-menu {
        position: fixed; z-index: 10060;
        background: #16181d; border: 1px solid #808899; border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.65);
        padding: 4px; display: flex; flex-direction: column; gap: 2px;
        overflow-y: auto; font-family: 'Barlow', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .wt-preset-item {
        display: block; width: 100%; text-align: left; min-height: 24px;
        background: transparent; color: #eceef2; border: none; border-radius: 7px;
        padding: 5px 9px; font-family: inherit; font-size: 10px; font-weight: 600;
        cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: background 0.1s ease, color 0.1s ease;
      }
      .wt-preset-item:hover, .wt-preset-item.active {
        background: rgba(255, 126, 182, 0.16); color: #ff94c2;
      }
      .wt-preset-item.selected {
        box-shadow: inset 2px 0 0 #ff7eb6;
      }
      .wt-vol {
        display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
        font: 700 10px 'JetBrains Mono', monospace; color: #b6bcc8;
        font-variant-numeric: tabular-nums;
      }
      .wt-vol input[type=range] {
        width: 64px; min-height: 24px; height: 24px; margin: 0;
        accent-color: #ff7eb6; cursor: pointer;
      }
      .wt-vol-pct {
        min-width: 30px; text-align: right; color: #eceef2;
      }
      .wt-error-banner {
        flex: 1 1 100%; display: flex; align-items: center; justify-content: space-between;
        gap: 8px; flex-wrap: wrap; padding: 5px 10px; border-radius: 10px;
        background: #261418; border: 1px solid #ff6b6b; color: #ffd4d4;
        font: 600 10.5px 'Barlow', sans-serif;
      }
      .wt-error-banner[hidden] { display: none !important; }
      .wt-error-actions {
        display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      }
      .wt-error-btn {
        min-width: 24px; min-height: 24px; padding: 2px 9px; border-radius: 999px;
        border: 1px solid #ff8585; background: #181a1f; color: #eceef2;
        font: 700 10px 'Barlow', sans-serif; cursor: pointer;
      }
      .wt-error-btn:hover { background: #262930; border-color: #ffb3b3; }
      .wt-drop-cue {
        flex: 1 1 100%; display: flex; align-items: center; justify-content: center;
        padding: 5px 10px; border-radius: 10px;
        background: #132230; border: 1px solid #6ec6ff; color: #eceef2;
        font: 700 10.5px 'Barlow', sans-serif; letter-spacing: 0.03em;
      }
      .wt-drop-cue[hidden] { display: none !important; }
      #webTransport.wt-drag-audio {
        border-bottom-color: #6ec6ff;
        box-shadow: 0 6px 24px rgba(110, 198, 255, 0.25);
      }
      .wt-ir-confirm-banner {
        position: static; top: auto; left: auto; right: auto; transform: none; z-index: auto;
        flex: 1 1 100%; max-width: 100%; min-width: 0; box-sizing: border-box;
        display: flex; align-items: center; justify-content: space-between; gap: 6px 8px; flex-wrap: wrap;
        padding: 5px 10px; border-radius: 10px;
        background: #1b1e25; color: #eceef2; border: 1px solid #ffd166;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        font: 600 10.5px 'JetBrains Mono', monospace;
      }
      .wt-ir-confirm-banner[hidden] { display: none !important; }
      #wtIrConfirmText { flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; }
      .wt-ir-confirm-actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
      .wt-ir-confirm-btn {
        min-width: 24px; min-height: 24px; padding: 3px 9px; border-radius: 999px;
        border: 1px solid #686f7e; background: #121316; color: #eceef2;
        font: 700 10px 'Barlow', sans-serif; cursor: pointer;
      }
      .wt-ir-confirm-btn.primary {
        border-color: #ffd166; background: #2f2614; color: #ffd166;
      }
      @media (max-width: 1140px) {
        #webTransport {
          height: auto; flex-wrap: wrap; padding: 6px 10px; gap: 6px 8px;
        }
        .wt-center { flex: 1 1 200px; max-width: none; }
        .wt-right { flex: 1 1 100%; justify-content: space-between; }
        .wt-select { flex: 1 1 180px; max-width: none; }
      }
      @media (max-width: 580px) {
        #webTransport {
          padding: 6px 8px; gap: 5px 6px;
        }
        .wt-left { flex: 1 1 100%; flex-wrap: wrap; max-width: 100%; }
        .wt-seg { flex: 1 1 auto; max-width: 100%; flex-wrap: wrap; flex-shrink: 1; }
        .wt-seg button { padding: 0 8px; flex: 1 1 auto; }
        .wt-center { flex: 1 1 100%; min-width: 0; max-width: 100%; }
        .wt-scrub { min-width: 0; width: 100%; }
        .wt-right { flex: 1 1 100%; flex-wrap: wrap; justify-content: space-between; gap: 5px 6px; }
        .wt-select { flex: 1 1 140px; min-width: 0; max-width: 100%; }
      }
      body.wd-web-compact #stage {
        position: fixed; left: 0; top: 0; width: 100%; height: 100%;
        transform: none; border-radius: 0; padding: 8px; gap: 8px;
        overflow-y: auto; overflow-x: hidden;
      }
      body.wd-web-compact .ui-banner-anchor { margin-top: -8px; }
      body.wd-web-compact .hdr {
        height: auto; flex-wrap: wrap; border-radius: 14px; padding: 6px 8px; gap: 6px; white-space: normal;
      }
      body.wd-web-compact .brand,
      body.wd-web-compact .hdr-right {
        flex-wrap: wrap; white-space: normal; max-width: 100%; gap: 4px;
      }
      body.wd-web-compact .top-row,
      body.wd-web-compact .deck-row,
      body.wd-web-compact .bottom-row,
      body.wd-web-compact #stage.has-bg-summary .deck-row {
        grid-template-columns: minmax(0, 1fr); height: auto; flex: 0 0 auto;
      }
      body.wd-web-compact .scope-box { min-height: 155px; }
      body.wd-web-compact .scope-hdr,
      body.wd-web-compact .scope-legend,
      body.wd-web-compact .scope-badges { flex-wrap: wrap; gap: 6px; }
      body.wd-web-compact .module-card { overflow: visible; height: auto; flex: 0 0 auto; }
      body.wd-web-compact .amp-sub-deck,
      body.wd-web-compact .sub-deck { flex: 0 0 auto !important; min-height: auto; }
      body.wd-web-compact .module-hdr,
      body.wd-web-compact .module-hdr > div,
      body.wd-web-compact .amp-ctrl-row,
      body.wd-web-compact .amp-sub-hdr,
      body.wd-web-compact .seg-group { flex-wrap: wrap; gap: 4px; }
      body.wd-web-compact .cab-body { grid-template-columns: minmax(0, 1fr); }
      body.wd-web-compact .mic-stage-wrap { min-height: 210px; }
      body.wd-web-compact .knob-row { flex-wrap: wrap; justify-content: flex-start; gap: 6px 4px; }
      body.wd-web-compact .knob { flex: 0 1 calc(25% - 4px); min-width: 58px; }
      body.wd-web-compact .amp-telem-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      body.wd-web-compact .bg-rig-summary { white-space: normal; border-radius: 10px; padding: 5px 10px; }
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
          setTransportError(formatAudioError(err), 'play');
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
      if (typeof b.setAttribute === 'function') {
        b.setAttribute('aria-pressed', audio.activeClipId === c.id ? 'true' : 'false');
      }
      b.addEventListener('click', () => {
        selectClip(c.id).catch(err => {
          setTransportError(formatAudioError(err), 'play');
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
    scrubEl = scrub;
    scrub.className = 'wt-scrub';
    scrub.tabIndex = 0;
    scrub.title = 'Click, drag, or use Arrow / Home / End keys to seek in the guitar riff';
    if (typeof scrub.setAttribute === 'function') {
      scrub.setAttribute('role', 'slider');
      scrub.setAttribute('aria-label', 'Riff playback position');
      scrub.setAttribute('aria-valuemin', '0');
      scrub.setAttribute('aria-valuemax', '11.3');
      scrub.setAttribute('aria-valuenow', '0');
      scrub.setAttribute('aria-valuetext', '0:00.0 of 0:11.3');
    }
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

    let scrubDragging = false;
    let scrubPointerId = null;
    let scrubLastPct = 0;
    const calcScrubPct = clientX => {
      const rect = typeof scrub.getBoundingClientRect === 'function'
        ? scrub.getBoundingClientRect()
        : { left: 0, width: 300 };
      return Math.max(0, Math.min(1, ((Number(clientX) || 0) - rect.left) / Math.max(1, rect.width)));
    };

    let endScrubDragRef = null;
    const onScrubWindowBlur = () => {
      if (endScrubDragRef) endScrubDragRef({ type: 'blur' });
    };

    scrub.addEventListener('pointerdown', async e => {
      if (e && typeof e.button === 'number' && e.button !== 0) return;
      const pct = calcScrubPct(e ? e.clientX : 0);
      scrubDragging = true;
      scrubPointerId = e && e.pointerId !== undefined ? e.pointerId : null;
      scrubLastPct = pct;
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('blur', onScrubWindowBlur);
      }
      if (e && e.pointerId !== undefined && typeof scrub.setPointerCapture === 'function') {
        try { scrub.setPointerCapture(e.pointerId); } catch (_) {}
      }
      try {
        await seekPlayback(pct);
      } catch (err) {
        setTransportError(formatAudioError(err), 'play');
      }
    });

    scrub.addEventListener('pointermove', e => {
      if (!scrubDragging) return;
      if (e && e.pointerId !== undefined && scrubPointerId !== null && e.pointerId !== scrubPointerId) return;
      const pct = calcScrubPct(e ? e.clientX : 0);
      scrubLastPct = pct;
      const buf = currentBuffer();
      const dur = (buf && buf.duration > 0) ? buf.duration : (audio.activeClipId === 'nts' ? 11.73 : 11.30);
      audio.playStartOffset = Math.min(dur * 0.999, pct * dur);
    });

    const endScrubDrag = async e => {
      if (!scrubDragging) return;
      const isBlur = !!(e && e.type === 'blur');
      if (!isBlur && e && e.pointerId !== undefined && scrubPointerId !== null && e.pointerId !== scrubPointerId) return;
      scrubDragging = false;
      const pid = scrubPointerId;
      scrubPointerId = null;
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('blur', onScrubWindowBlur);
      }
      if (pid !== null && typeof scrub.releasePointerCapture === 'function') {
        try { scrub.releasePointerCapture(pid); } catch (_) {}
      }
      if (e && e.type === 'pointerup') {
        const finalPct = (e.clientX !== undefined) ? calcScrubPct(e.clientX) : scrubLastPct;
        try {
          await seekPlayback(finalPct);
        } catch (err) {
          setTransportError(formatAudioError(err), 'play');
        }
      }
    };
    endScrubDragRef = endScrubDrag;
    scrub.addEventListener('pointerup', endScrubDrag);
    scrub.addEventListener('pointercancel', endScrubDrag);
    scrub.addEventListener('lostpointercapture', endScrubDrag);

    scrub.addEventListener('keydown', async e => {
      if (!e) return;
      const buf = currentBuffer();
      const dur = (buf && buf.duration > 0) ? buf.duration : (audio.activeClipId === 'nts' ? 11.73 : 11.30);
      const curSec = currentPlayheadSec();
      const stepSec = e.shiftKey ? 0.25 : 1.0;
      let targetPct = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        targetPct = Math.min(0.99, (curSec + stepSec) / Math.max(0.1, dur));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        targetPct = Math.max(0, (curSec - stepSec) / Math.max(0.1, dur));
      } else if (e.key === 'PageUp') {
        targetPct = Math.min(0.99, (curSec + 2.5) / Math.max(0.1, dur));
      } else if (e.key === 'PageDown') {
        targetPct = Math.max(0, (curSec - 2.5) / Math.max(0.1, dur));
      } else if (e.key === 'Home') {
        targetPct = 0;
      } else if (e.key === 'End') {
        targetPct = 0.99;
      }
      if (targetPct === null) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      audio.playStartOffset = targetPct * dur;
      try {
        await seekPlayback(targetPct);
      } catch (err) {
        setTransportError(formatAudioError(err), 'play');
      }
    });
    center.appendChild(scrub);

    // Right: Rig Presets + Custom Audio Loader + Master Volume
    const right = document.createElement('div');
    right.className = 'wt-right';

    presetSel = document.createElement('select');
    presetSel.className = 'wt-select';
    presetSel.title = 'Factory Rig Presets (prompts before clearing User IRs; preserves AMP & LOAD mode)';
    if (typeof presetSel.setAttribute === 'function') {
      presetSel.setAttribute('aria-label', 'Factory Rig Presets');
      presetSel.setAttribute('aria-haspopup', 'listbox');
      presetSel.setAttribute('aria-expanded', 'false');
    }
    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = 'Custom / Edited';
    customOpt.disabled = true;
    customOpt.hidden = true;
    presetSel.appendChild(customOpt);
    RIG_PRESETS.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = p.name;
      if (p.desc) opt.title = p.desc;
      presetSel.appendChild(opt);
    });
    const dispPresetIdx = getDisplayedPresetIndex();
    presetSel.value = dispPresetIdx >= 0 ? String(dispPresetIdx) : '';

    // User IR Clear Confirmation Banner for .wt-select
    let wtIrConfirmBanner = null;
    let wtIrConfirmText = null;
    let wtIrConfirmProceed = null;
    let wtIrConfirmCancel = null;
    let pendingWtPreset = null;

    if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function') {
      wtIrConfirmBanner = document.createElement('div');
      wtIrConfirmBanner.id = 'wtIrConfirmBanner';
      wtIrConfirmBanner.className = 'ir-confirm-banner wt-ir-confirm-banner';
      wtIrConfirmBanner.hidden = true;
      if (typeof wtIrConfirmBanner.setAttribute === 'function') {
        wtIrConfirmBanner.setAttribute('role', 'alertdialog');
        wtIrConfirmBanner.setAttribute('aria-modal', 'false');
        wtIrConfirmBanner.setAttribute('aria-label', 'Confirm clearing User IRs');
      }
      wtIrConfirmText = document.createElement('span');
      wtIrConfirmText.id = 'wtIrConfirmText';
      wtIrConfirmProceed = document.createElement('button');
      wtIrConfirmProceed.id = 'wtIrConfirmProceedBtn';
      wtIrConfirmProceed.type = 'button';
      wtIrConfirmProceed.className = 'ui-banner-btn primary wt-ir-confirm-btn primary';
      wtIrConfirmProceed.textContent = 'Load Preset & Clear IRs';
      wtIrConfirmCancel = document.createElement('button');
      wtIrConfirmCancel.id = 'wtIrConfirmCancelBtn';
      wtIrConfirmCancel.type = 'button';
      wtIrConfirmCancel.className = 'ui-banner-btn wt-ir-confirm-btn';
      wtIrConfirmCancel.textContent = 'Cancel';
      const wtIrActions = document.createElement('div');
      wtIrActions.className = 'wt-ir-confirm-actions';
      wtIrActions.appendChild(wtIrConfirmProceed);
      wtIrActions.appendChild(wtIrConfirmCancel);
      wtIrConfirmBanner.appendChild(wtIrConfirmText);
      wtIrConfirmBanner.appendChild(wtIrActions);

      const closeWtIrConfirm = (restorePrev, syncRig = true) => {
        if (wtIrConfirmBanner) wtIrConfirmBanner.hidden = true;
        if (restorePrev && pendingWtPreset) {
          const disp = getDisplayedPresetIndex();
          const valStr = disp >= 0 ? String(disp) : '';
          if (syncRig) syncPresetSelectElements(disp);
          else if (presetSel && String(presetSel.value) !== valStr) presetSel.value = valStr;
        }
        pendingWtPreset = null;
        fitStageWithBar();
      };
      dismissWtIrConfirmFn = (restorePrev = true, syncRig = true) => {
        if (pendingWtPreset || (wtIrConfirmBanner && !wtIrConfirmBanner.hidden)) {
          closeWtIrConfirm(restorePrev, syncRig);
        }
      };
      if (typeof window !== 'undefined') {
        window.__wdDismissWtIrConfirm = (restorePrev = true, syncRig = false) => {
          if (dismissWtIrConfirmFn) dismissWtIrConfirmFn(restorePrev, syncRig);
        };
      }
      wtIrConfirmProceed.addEventListener('click', () => {
        const req = pendingWtPreset;
        closeWtIrConfirm(false);
        if (req) applyRigPreset(req.idx);
      });
      wtIrConfirmCancel.addEventListener('click', () => {
        closeWtIrConfirm(true);
        if (typeof presetSel.focus === 'function') {
          try { presetSel.focus(); } catch (_) {}
        }
      });
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', e => {
          if (e && e.key === 'Escape' && pendingWtPreset) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            closeWtIrConfirm(true);
            if (typeof presetSel.focus === 'function') {
              try { presetSel.focus(); } catch (_) {}
            }
          }
        });
      }
      if (typeof document.getElementById === 'function') {
        const scheduleRigConfirmSync = () => {
          const syncFn = () => syncPresetSelectElements(getDisplayedPresetIndex());
          if (typeof queueMicrotask === 'function') queueMicrotask(syncFn);
          else setTimeout(syncFn, 0);
        };
        const rigConfirmCancel = document.getElementById('irConfirmCancelBtn');
        if (rigConfirmCancel && typeof rigConfirmCancel.addEventListener === 'function') {
          rigConfirmCancel.addEventListener('click', scheduleRigConfirmSync);
        }
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('keydown', e => {
            if (e && e.key === 'Escape') {
              const rigBanner = document.getElementById('irConfirmBanner');
              if (rigBanner && !rigBanner.hidden) {
                scheduleRigConfirmSync();
              }
            }
          }, true);
        }
      }
    }

    presetSel.addEventListener('change', () => {
      if (presetSel.value === '') return;
      const idx = Number(presetSel.value);
      if (!Number.isInteger(idx) || idx < 0 || idx >= RIG_PRESETS.length) return;
      const hasUserIr = !!(userIrState[0].active || userIrState[1].active);
      if (hasUserIr && wtIrConfirmBanner && wtIrConfirmText) {
        if (typeof window !== 'undefined' && typeof window.__wdDismissIrConfirm === 'function') {
          window.__wdDismissIrConfirm(true);
        }
        const loadedSlots = [];
        if (userIrState[0].active) loadedSlots.push('Cab A (' + (userIrState[0].name || 'User IR') + ')');
        if (userIrState[1].active) loadedSlots.push('Cab B (' + (userIrState[1].name || 'User IR') + ')');
        pendingWtPreset = { idx };
        wtIrConfirmText.textContent = 'Loading factory preset will clear User IR on ' + loadedSlots.join(' & ') + '.';
        wtIrConfirmBanner.hidden = false;
        fitStageWithBar();
        if (wtIrConfirmCancel && typeof wtIrConfirmCancel.focus === 'function') {
          try { wtIrConfirmCancel.focus(); } catch (_) {}
        }
        return;
      }
      applyRigPreset(idx);
    });

    if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function' &&
        typeof presetSel.addEventListener === 'function')
    {
      const menuId = 'wtPresetSel_menu';
      if (typeof presetSel.setAttribute === 'function') {
        presetSel.setAttribute('aria-controls', menuId);
      }
      let menuEl = null;
      let openItems = [];
      let openOpts = [];
      let activeIdx = -1;

      const getVisibleOptions = () => {
        const opts = presetSel.options ? Array.from(presetSel.options) : [];
        return opts.filter(o => o && !o.hidden && !o.disabled);
      };

      const setActive = idx => {
        if (!openItems.length) {
          activeIdx = -1;
          if (typeof presetSel.removeAttribute === 'function') presetSel.removeAttribute('aria-activedescendant');
          return;
        }
        activeIdx = Math.max(0, Math.min(openItems.length - 1, idx));
        for (let i = 0; i < openItems.length; i++) {
          const item = openItems[i];
          if (item && item.classList) item.classList.toggle('active', i === activeIdx);
        }
        const act = openItems[activeIdx];
        if (act && act.id && typeof presetSel.setAttribute === 'function') {
          presetSel.setAttribute('aria-activedescendant', act.id);
        }
        if (act && typeof act.scrollIntoView === 'function') {
          try { act.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        }
      };

      const closeMenu = () => {
        if (!menuEl) return;
        if (typeof document.removeEventListener === 'function') {
          document.removeEventListener('mousedown', onDocMouseDown, true);
          document.removeEventListener('keydown', onDocMenuKeyDown, true);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('blur', closeMenu);
          window.removeEventListener('resize', closeMenu);
        }
        if (typeof presetSel.setAttribute === 'function') {
          presetSel.setAttribute('aria-expanded', 'false');
        }
        if (typeof presetSel.removeAttribute === 'function') {
          presetSel.removeAttribute('aria-activedescendant');
        }
        if (typeof menuEl.remove === 'function') menuEl.remove();
        else if (menuEl.parentElement && typeof menuEl.parentElement.removeChild === 'function') {
          menuEl.parentElement.removeChild(menuEl);
        }
        menuEl = null;
        openItems = [];
        openOpts = [];
        activeIdx = -1;
      };

      const onDocMouseDown = e => {
        if (!menuEl) return;
        const tgt = e && e.target;
        if (tgt === presetSel || (typeof menuEl.contains === 'function' && menuEl.contains(tgt))) return;
        closeMenu();
      };

      const onDocMenuKeyDown = e => {
        if (!menuEl || !e) return;
        if (e.key === 'Escape') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          closeMenu();
          if (typeof presetSel.focus === 'function') {
            try { presetSel.focus(); } catch (_) {}
          }
        }
      };

      const selectValue = val => {
        closeMenu();
        presetSel.value = String(val);
        if (typeof Event === 'function' && typeof presetSel.dispatchEvent === 'function') {
          presetSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      const openMenu = () => {
        closeMenu();
        openOpts = getVisibleOptions();
        if (!openOpts.length) return;

        menuEl = document.createElement('div');
        menuEl.id = menuId;
        menuEl.className = 'wt-preset-menu';
        if (typeof menuEl.setAttribute === 'function') menuEl.setAttribute('role', 'listbox');

        const curVal = String(presetSel.value);
        let initIdx = 0;
        openItems = openOpts.map((opt, idx) => {
          const item = document.createElement('button');
          item.id = menuId + '_opt_' + idx;
          item.type = 'button';
          item.className = 'wt-preset-item';
          item.textContent = opt.textContent || '';
          if (opt.title) item.title = opt.title;
          if (item.dataset) item.dataset.value = String(opt.value);
          if (typeof item.setAttribute === 'function') item.setAttribute('role', 'option');
          const isSel = String(opt.value) === curVal;
          if (isSel) {
            initIdx = idx;
            if (item.classList) item.classList.add('selected');
          }
          if (typeof item.setAttribute === 'function') {
            item.setAttribute('aria-selected', isSel ? 'true' : 'false');
          }
          item.addEventListener('mousedown', e => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
          });
          item.addEventListener('mouseenter', () => setActive(idx));
          item.addEventListener('click', e => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            selectValue(opt.value);
          });
          menuEl.appendChild(item);
          return item;
        });

        const rect = typeof presetSel.getBoundingClientRect === 'function'
          ? presetSel.getBoundingClientRect()
          : { left: 0, top: 0, bottom: 28, width: 220, height: 28 };
        const vw = (document.documentElement && document.documentElement.clientWidth) || (typeof window !== 'undefined' && window.innerWidth) || 1180;
        const vh = (document.documentElement && document.documentElement.clientHeight) || (typeof window !== 'undefined' && window.innerHeight) || 760;
        const minW = Math.max(220, Math.round(rect.width || 220));
        const spaceBelow = Math.max(0, vh - (rect.bottom || 28) - 8);
        const spaceAbove = Math.max(0, (rect.top || 0) - 8);
        const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
        const maxH = Math.max(110, Math.min(320, openAbove ? spaceAbove : spaceBelow));
        menuEl.style.left = Math.max(6, Math.min(rect.left || 0, vw - minW - 6)) + 'px';
        menuEl.style.minWidth = minW + 'px';
        menuEl.style.maxHeight = Math.round(maxH) + 'px';
        if (openAbove) {
          menuEl.style.bottom = Math.max(6, vh - (rect.top || 0) + 4) + 'px';
          menuEl.style.top = 'auto';
        } else {
          menuEl.style.top = Math.min(vh - 40, (rect.bottom || 28) + 4) + 'px';
          menuEl.style.bottom = 'auto';
        }

        document.body.appendChild(menuEl);
        if (typeof presetSel.setAttribute === 'function') {
          presetSel.setAttribute('aria-expanded', 'true');
        }
        setActive(initIdx);

        if (typeof document.addEventListener === 'function') {
          document.addEventListener('mousedown', onDocMouseDown, true);
          document.addEventListener('keydown', onDocMenuKeyDown, true);
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('blur', closeMenu);
          window.addEventListener('resize', closeMenu);
        }
      };

      presetSel.addEventListener('mousedown', e => {
        if (e && typeof e.button === 'number' && e.button !== 0) return;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof presetSel.focus === 'function') {
          try { presetSel.focus(); } catch (_) {}
        }
        if (menuEl) closeMenu();
        else openMenu();
      });

      presetSel.addEventListener('click', e => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.detail === 'number' && e.detail > 0) return;
        if (menuEl) closeMenu();
        else openMenu();
      });

      presetSel.addEventListener('keydown', e => {
        if (!e) return;
        const k = e.key;
        if (!menuEl) {
          if (k === 'Enter' || k === ' ' || k === 'F4' || k === 'ArrowDown' || k === 'ArrowUp') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            openMenu();
          }
          return;
        }
        if (k === 'Escape' || k === 'Tab') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          closeMenu();
        } else if (k === 'ArrowDown') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          setActive(activeIdx + 1);
        } else if (k === 'ArrowUp') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          setActive(activeIdx - 1);
        } else if (k === 'Home') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          setActive(0);
        } else if (k === 'End') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          setActive(openItems.length - 1);
        } else if (k === 'Enter' || k === ' ') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          const opt = openOpts[activeIdx];
          if (opt) selectValue(opt.value);
          else closeMenu();
        }
      });
    }
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
        setTransportError(formatAudioError(err), 'custom');
      }
    });
    right.appendChild(fileInput);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'wt-btn';
    loadBtn.textContent = 'LOAD AUDIO';
    loadBtn.title = 'Load or drag-and-drop your own amp send / guitar stem (WAV, MP3, FLAC, OGG)';
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
    volSlider.title = 'Demo playback master output volume';
    if (typeof volSlider.setAttribute === 'function') {
      volSlider.setAttribute('aria-label', 'Demo playback volume');
    }
    volPctEl = document.createElement('span');
    volPctEl.className = 'wt-vol-pct';
    volPctEl.textContent = `${Math.round(audio.volPct)}%`;
    volSlider.addEventListener('input', () => {
      audio.volPct = volSlider.valueAsNumber;
      if (volPctEl) {
        volPctEl.textContent = `${Math.round(audio.volPct)}%`;
      }
      if (audio.master && audio.ctx) {
        audio.master.gain.setTargetAtTime(volLinear(), audio.ctx.currentTime, 0.015);
      }
    });
    volWrap.append(volLbl, volSlider, volPctEl);
    right.appendChild(volWrap);

    dropCueEl = document.createElement('div');
    dropCueEl.className = 'wt-drop-cue';
    dropCueEl.hidden = true;
    dropCueEl.textContent = 'Drop audio file anywhere to load backing loop (WAV / MP3 / FLAC / OGG) — drop on Cab A/B cards for User IRs';

    errorBanner = document.createElement('div');
    errorBanner.className = 'wt-error-banner is-error';
    errorBanner.hidden = true;
    if (typeof errorBanner.setAttribute === 'function') {
      errorBanner.setAttribute('role', 'alert');
      errorBanner.setAttribute('aria-live', 'assertive');
    }
    errorTextEl = document.createElement('span');
    errorTextEl.className = 'wt-error-text';
    const errorActions = document.createElement('div');
    errorActions.className = 'wt-error-actions';
    retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'wt-error-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      const src = pendingErrorSource;
      clearTransportError();
      if (src === 'wasm' || !uiEngine.wasm) {
        initUiWasmEngine();
      } else if (src === 'custom') {
        fileInput.click();
      } else {
        startPlayback().catch(err => {
          setTransportError(formatAudioError(err), 'play');
        });
      }
    });
    dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'wt-error-btn';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      clearTransportError();
    });
    errorActions.append(retryBtn, dismissBtn);
    errorBanner.append(errorTextEl, errorActions);
    if (pendingStatusError) {
      errorTextEl.textContent = pendingStatusError;
      errorBanner.hidden = false;
    }

    bar.append(left, center, right, dropCueEl, errorBanner);
    if (wtIrConfirmBanner) bar.appendChild(wtIrConfirmBanner);
    document.body.insertBefore(bar, document.body.firstChild);

    // Keyboard shortcuts: Space = Play/Stop, 1 = Super Lead (Mid Gain), 2 = NTS (High Gain)
    window.addEventListener('keydown', e => {
      if (!e || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isInteractiveHotkeyTarget(e.target)) return;
      if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
        if (document.querySelector('.wt-preset-menu, .wd-preset-menu, #wtIrConfirmBanner:not([hidden]), #irConfirmBanner:not([hidden]), [role="alertdialog"]:not([hidden])')) {
          return;
        }
      }
      if (e.code === 'Space') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (audio.playing || audio.starting) {
          stopPlayback(false);
        } else {
          startPlayback().catch(err => {
            setTransportError(formatAudioError(err), 'play');
          });
        }
      } else if (e.key === '1') {
        selectClip('super_lead').catch(err => {
          setTransportError(formatAudioError(err), 'play');
        });
      } else if (e.key === '2') {
        selectClip('nts').catch(err => {
          setTransportError(formatAudioError(err), 'play');
        });
      }
    });

    const clearIrDragHighlights = () => {
      for (const id of ['cardCabA', 'cardCabB']) {
        const el = (document && typeof document.getElementById === 'function') ? document.getElementById(id) : null;
        if (el && el.classList) el.classList.remove('ir-dragover');
      }
    };
    let lastAudioCue = false;
    const setAudioDragCue = active => {
      const next = !!active;
      if (next === lastAudioCue) return;
      lastAudioCue = next;
      if (bar && bar.classList) bar.classList.toggle('wt-drag-audio', next);
      if (dropCueEl) dropCueEl.hidden = !next;
      fitStageWithBar();
    };
    const isOverCabCard = target => !!(target && typeof target.closest === 'function' && target.closest('#cardCabA, #cardCabB'));

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onDocDragOver = e => {
        if (isOverCabCard(e && e.target)) {
          setAudioDragCue(false);
        } else {
          setAudioDragCue(true);
          clearIrDragHighlights();
        }
      };
      document.addEventListener('dragenter', onDocDragOver, true);
      document.addEventListener('dragover', onDocDragOver, true);
      document.addEventListener('drop', () => setAudioDragCue(false), true);
      document.addEventListener('dragend', () => {
        setAudioDragCue(false);
        clearIrDragHighlights();
      }, true);
    }

    // Drag-and-drop custom audio file anywhere on the window
    window.addEventListener('dragenter', e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (!isOverCabCard(e && e.target)) {
        setAudioDragCue(true);
        clearIrDragHighlights();
      }
    });
    window.addEventListener('dragover', e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (!isOverCabCard(e && e.target)) {
        setAudioDragCue(true);
        clearIrDragHighlights();
      }
    });
    window.addEventListener('dragleave', e => {
      if (!e || !e.relatedTarget) setAudioDragCue(false);
    });
    window.addEventListener('dragend', () => {
      setAudioDragCue(false);
      clearIrDragHighlights();
    });
    window.addEventListener('drop', async e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      setAudioDragCue(false);
      clearIrDragHighlights();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        try {
          await loadCustomFile(f);
        } catch (err) {
          setTransportError(formatAudioError(err), 'custom');
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
      setTransportError(msg, 'custom');
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
      clearTransportError();
      audio.customBuffer = downmixToStereoBuffer(audio.ctx, decoded);
      audio.customName   = fileName;
      audio.activeClipId = 'custom';
      audio.playStartOffset = 0;
      await startPlayback(0, 15);
    } catch (err) {
      failCustomLoad(audioReady ? ('Could not decode ' + fileName) : formatAudioError(err));
    }
  }

  let lastPlayheadPct = '';
  let lastTimeText = '';
  function tick() {
    requestAnimationFrame(tick);
    fitStageWithBar();
    if (scrubFill && scrubHead && scrubTime) {
      const buf = currentBuffer();
      const dur = (buf && buf.duration > 0) ? buf.duration : (audio.activeClipId === 'nts' ? 11.73 : 11.30);
      const pos = currentPlayheadSec();
      const pct = Math.max(0, Math.min(100, (pos / Math.max(0.01, dur)) * 100));
      const pctStr = pct.toFixed(2) + '%';
      if (pctStr !== lastPlayheadPct) {
        lastPlayheadPct = pctStr;
        scrubFill.style.width = pctStr;
        scrubHead.style.left  = pctStr;
      }
      const timeText = `${fmtSec(pos)} / ${fmtSec(dur)}`;
      if (timeText !== lastTimeText) {
        lastTimeText = timeText;
        scrubTime.textContent = timeText;
        if (scrubEl && typeof scrubEl.setAttribute === 'function') {
          scrubEl.setAttribute('aria-valuemax', dur.toFixed(1));
          scrubEl.setAttribute('aria-valuenow', pos.toFixed(1));
          scrubEl.setAttribute('aria-valuetext', `${fmtSec(pos)} of ${fmtSec(dur)}`);
        }
      }
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
