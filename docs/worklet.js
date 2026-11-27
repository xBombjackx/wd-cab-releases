// AudioWorkletProcessor hosting the WD Cab WebAssembly DSP core (wdcab.wasm).
//
// Runs the full C++20 5-state RK4 speaker motor, dual reactive cabinets,
// 8 virtual microphones (2x oversampled capsule + transformer), 6 Analog Suite
// mic preamps, and studio room engine in real time on the WebAudio thread,
// streaming 280-float telemetry + live 64-point scope curves back to the UI.

const NUM_PARAMS     = 100;
const TELEM_FLOATS   = 280;
const MAX_WASM_BLOCK = 2048;
const MAX_BLOCK      = MAX_WASM_BLOCK;

const PARAM_INDEX = {
  loadEnabled: 0, guitarVol: 1, guitarTone: 2, cableLenM: 3, reactiveMode: 4,
  gateEnabled: 5, gateThresh: 6, gateRelease: 7, boostEnabled: 8, boostTopo: 9,
  boostDrive: 10, boostTone: 11, boostLevel: 12, preampEnabled: 13, channel: 14,
  preampGain: 15, bass: 16, mid: 17, treble: 18, preampBias: 19, preampAge: 20,
  powerAmpEnabled: 21, powerTube: 22, rectifier: 23, masterVol: 24, presence: 25,
  depth: 26, nfbAmount: 27, powerBias: 28, powerAge: 29, xfmrDrive: 30,
  powerScaleW: 31, impRatio: 32, cabEnabled: 33, cabModel: 34, cabBoxScale: 35,
  cabConeDamp: 36, cabALoResDb: 37, cabAHiResDb: 38, cabAHpfHz: 39, cabALpfHz: 40,
  cabAPan: 41, cabALevelDb: 42, micEnabled: 43, micModel: 44, micDistCm: 45,
  micOffAxis: 46, micConePos: 47, micDrive: 48, micPreDrive: 49, micPhase: 50,
  micPreModel: 51, cabBEnabled: 52, cabBModel: 53, cabBBoxScale: 54,
  cabBConeDamp: 55, cabBLoResDb: 56, cabBHiResDb: 57, cabBHpfHz: 58, cabBLpfHz: 59,
  cabBPan: 60, cabBLevelDb: 61, micBEnabled: 62, micBModel: 63, micBDistCm: 64,
  micBOffAxis: 65, micBConePos: 66, micBDrive: 67, micBPreDrive: 68, micBPhase: 69,
  micBPreModel: 70, roomEnabled: 71, roomType: 72, roomPanMode: 73, roomSize: 74,
  roomDistM: 75, roomDamp: 76, roomWidth: 77, roomLevel: 78, inputCal: 79,
  outputDb: 80, power: 81, roomSmash: 82,
  cabBDelayMs: 83, roomPreDelayMs: 84, roomLoCutHz: 85, roomHiCutHz: 86,
  fxLoopEnabled: 87, fxLoopMode: 88, fxLoopTime: 89, fxLoopFeedback: 90, fxLoopMix: 91,
  loadPickupModel: 92, loadWiring: 93, loadBleedType: 94, loadCablePreset: 95,
  loadDielectricLoss: 96, loadCouplingProfile: 97,
  cabACutOrder: 98, cabBCutOrder: 99,
};

function stubImports(module) {
  const imports = {};
  for (const d of WebAssembly.Module.imports(module)) {
    imports[d.module] = imports[d.module] || {};
    imports[d.module][d.name] = d.kind === 'function' ? () => 0 : undefined;
  }
  return imports;
}

class WdCabWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.failed = false;
    this.controlsDirty = false;
    this.smoothTransitionPending = false;
    this.pending = [];
    this.telemCountdown = 0;
    this.telemBuf = new Float32Array(TELEM_FLOATS);
    const fsWorklet = (typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0) ? sampleRate : 48000;
    this.telemPeriodQuanta = Math.max(6, Math.round(fsWorklet / (128 * 30))); // ~30 Hz telemetry/scope updates across sample rates
    const optResetSeq = options && options.processorOptions && typeof options.processorOptions.resetSeq === 'number' && Number.isFinite(options.processorOptions.resetSeq) ? options.processorOptions.resetSeq : 0;
    this.resetSeq = optResetSeq;
    this.port.onmessage = e => this.handle(e.data);

    const module = options && options.processorOptions ? options.processorOptions.module : null;
    WebAssembly.instantiate(module, module instanceof WebAssembly.Module ? stubImports(module) : {}).then(instance => {
      this.wasm = instance.exports;
      this.exports = this.wasm;
      this.wasm.wdcab_init(sampleRate);
      this.refreshViews();
      this.ioL   = this.wasm.wdcab_io_l() >> 2;
      this.ioR   = this.wasm.wdcab_io_r() >> 2;
      this.telem = this.wasm.wdcab_telem() >> 2;
      for (const msg of this.pending) this.handleMessage(msg);
      this.pending.length = 0;
      if (this.controlsDirty) {
        this.apply();
      }
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    }).catch(err => {
      this.ready = false;
      this.failed = true;
      this.pending.length = 0;
      this.port.postMessage({ type: 'error', error: String(err && err.message ? err.message : err) });
    });
  }

  refreshViews() {
    if (!this.f32 || this.f32.buffer !== this.wasm.memory.buffer) {
      this.f32 = new Float32Array(this.wasm.memory.buffer);
    }
  }

  handle(msg) {
    if (this.failed) return;
    if (!this.ready) {
      this.pending.push(msg);
      return;
    }
    this.handleMessage(msg);
  }

  handleMessage(msg) {
    if (!msg) return;
    if (msg.type === 'controls') {
      if (msg.params) {
        const p = msg.params;
        const len = Math.min(NUM_PARAMS, p.length);
        for (let i = 0; i < len; i++) {
          this.wasm.wdcab_set_param(i, p[i]);
        }
        this.controlsDirty = true;
      }
      if (Array.isArray(msg.entries)) {
        for (const [k, v] of msg.entries) {
          const idx = typeof k === 'number' ? k : PARAM_INDEX[k];
          if (typeof idx === 'number' && idx >= 0 && idx < NUM_PARAMS) {
            this.wasm.wdcab_set_param(idx, Number(v));
          }
        }
        this.controlsDirty = true;
      }
      if (msg.smoothTransition) {
        this.smoothTransitionPending = true;
      }
    } else if (msg.type === 'smoothTransition') {
      if (this.controlsDirty) {
        this.apply();
      } else if (typeof this.wasm.wdcab_request_smooth_transition === 'function') {
        this.wasm.wdcab_request_smooth_transition();
      }
    } else if (msg.type === 'setCabDelta') {
      const slot = Number(msg.slot) | 0;
      if ((slot === 0 || slot === 1) && typeof this.wasm.wdcab_set_cab_delta === 'function') {
        this.wasm.wdcab_set_cab_delta(slot, msg.enabled ? 1 : 0);
      }
    } else if (msg.type === 'param') {
      this.wasm.wdcab_set_param(msg.idx, msg.val);
      this.controlsDirty = true;
    } else if (msg.type === 'reset') {
      if (this.controlsDirty) {
        this.apply();
      }
      this.wasm.wdcab_reset();
      this.resetSeq = (typeof msg.resetSeq === 'number') ? msg.resetSeq : (this.resetSeq || 0);
    } else if (msg.type === 'applyPreparedUserIr') {
      const slot = Number(msg.slot) | 0;
      const irLen = Number(msg.irLen) | 0;
      const sr = Number(msg.sampleRate) || 48000;
      const irRev = msg.irRev;
      const ref48k = msg.ref48k;
      const magDb = msg.magDb;
      const phaseRad = msg.phaseRad;
      const wave = msg.wave;
      if ((slot === 0 || slot === 1) && irRev && irRev.length > 0 && irLen > 0 &&
          typeof this.wasm.wdcab_apply_prepared_user_ir === 'function' &&
          typeof this.wasm.wdcab_prepared_ir_rev_ptr === 'function')
      {
        const revPtr = this.wasm.wdcab_prepared_ir_rev_ptr();
        const refPtr = this.wasm.wdcab_prepared_ir_ref_ptr();
        const magPtr = this.wasm.wdcab_prepared_ir_mag_ptr();
        const phasePtr = this.wasm.wdcab_prepared_ir_phase_ptr();
        const wavePtr = this.wasm.wdcab_prepared_ir_wave_ptr();
        this.refreshViews();
        const nRev = Math.min(irLen, irRev.length, 16384);
        this.f32.set(irRev.subarray(0, nRev), revPtr >> 2);
        let nRef = 0;
        if (ref48k && ref48k.length > 0 && refPtr) {
          nRef = Math.min(ref48k.length, 8192);
          this.f32.set(ref48k.subarray(0, nRef), refPtr >> 2);
        }
        if (magDb && magDb.length >= 64 && magPtr) {
          this.f32.set(magDb.subarray(0, 64), magPtr >> 2);
        }
        if (phaseRad && phaseRad.length >= 64 && phasePtr) {
          this.f32.set(phaseRad.subarray(0, 64), phasePtr >> 2);
        }
        if (wave && wave.length >= 128 && wavePtr) {
          this.f32.set(wave.subarray(0, 128), wavePtr >> 2);
        }
        this.wasm.wdcab_apply_prepared_user_ir(
          slot,
          revPtr,
          nRev,
          sr,
          nRef > 0 ? refPtr : 0,
          nRef,
          (magDb && magDb.length >= 64) ? magPtr : 0,
          (phaseRad && phaseRad.length >= 64) ? phasePtr : 0,
          (wave && wave.length >= 128) ? wavePtr : 0
        );
      }
    } else if (msg.type === 'loadUserIr') {
      const slot = Number(msg.slot) | 0;
      const samples = (msg.samples instanceof ArrayBuffer) ? new Float32Array(msg.samples) : msg.samples;
      const sr = Number(msg.sampleRate) || 48000;
      if ((slot === 0 || slot === 1) && samples && samples.length > 0 &&
          typeof this.wasm.wdcab_ir_scratch === 'function' &&
          typeof this.wasm.wdcab_load_user_ir === 'function')
      {
        const maxCap = (typeof this.wasm.wdcab_ir_scratch_max === 'function')
          ? this.wasm.wdcab_ir_scratch_max()
          : 131072;
        const copyLen = Math.min(samples.length, maxCap);
        const scratchPtr = this.wasm.wdcab_ir_scratch();
        this.refreshViews();
        const scratchIdx = scratchPtr >> 2;
        if (scratchPtr > 0 && copyLen > 0 && scratchIdx + copyLen <= this.f32.length) {
          this.f32.set(samples.subarray(0, copyLen), scratchIdx);
          this.wasm.wdcab_load_user_ir(slot, scratchPtr, copyLen, sr);
        }
      }
    } else if (msg.type === 'clearUserIr') {
      const slot = Number(msg.slot) | 0;
      if (slot === 0 || slot === 1) {
        if (msg.procIrRev && msg.procIrRev.length > 0 && (Number(msg.irLen) | 0) > 0 &&
            typeof this.wasm.wdcab_clear_user_ir_prepared === 'function' &&
            typeof this.wasm.wdcab_prepared_ir_rev_ptr === 'function')
        {
          const revPtr = this.wasm.wdcab_prepared_ir_rev_ptr();
          this.refreshViews();
          const nRev = Math.min(Number(msg.irLen) | 0, msg.procIrRev.length, 16384);
          this.f32.set(msg.procIrRev.subarray(0, nRev), revPtr >> 2);
          this.wasm.wdcab_clear_user_ir_prepared(slot, revPtr, nRev, Number(msg.sampleRate) || 48000);
        } else if (typeof this.wasm.wdcab_clear_user_ir === 'function') {
          this.wasm.wdcab_clear_user_ir(slot);
        }
      }
    }
  }

  apply(msg) {
    if (msg) {
      this.handleMessage(msg);
      return;
    }
    this.wasm.wdcab_apply();
    this.controlsDirty = false;
    if (this.smoothTransitionPending) {
      this.smoothTransitionPending = false;
      if (typeof this.wasm.wdcab_request_smooth_transition === 'function') {
        this.wasm.wdcab_request_smooth_transition();
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const out   = outputs[0];
    if (!out || out.length === 0 || !out[0]) return true;
    const n = out[0].length;

    if (!this.ready) {
      for (let ch = 0; ch < out.length; ch++) {
        if (out[ch]) out[ch].fill(0);
      }
      return true;
    }

    if (this.controlsDirty) {
      this.apply();
    }

    const inChCount   = (input && input.length > 0) ? input.length : 0;
    const wasmInCount = Math.min(inChCount, 2);
    const outChCount  = out.length;

    const maxBlock = (this.exports && typeof this.exports.wdcab_max_block === 'function')
      ? this.exports.wdcab_max_block()
      : MAX_WASM_BLOCK;

    for (let offset = 0; offset < n; offset += maxBlock) {
      const chunkLen = Math.min(maxBlock, n - offset);
      this.refreshViews();
      const f32 = this.f32;

      f32.fill(0, this.ioL, this.ioL + chunkLen);
      f32.fill(0, this.ioR, this.ioR + chunkLen);

      if (inChCount <= 2) {
        const inL = (inChCount > 0 && input[0]) ? input[0] : null;
        const inR = (inChCount > 1 && input[1]) ? input[1] : null;
        if (inL && offset < inL.length) {
          const copyL = Math.min(chunkLen, inL.length - offset);
          f32.set(inL.subarray(offset, offset + copyL), this.ioL);
        }
        if (inR && offset < inR.length) {
          const copyR = Math.min(chunkLen, inR.length - offset);
          f32.set(inR.subarray(offset, offset + copyR), this.ioR);
        }
      } else {
        const scale = 1.0 / Math.sqrt(Math.ceil(inChCount * 0.5));
        const oddLast = (inChCount & 1) === 1;
        for (let ch = 0; ch < inChCount; ch++) {
          const src = input[ch];
          if (!src || offset >= src.length) continue;
          const copyN = Math.min(chunkLen, src.length - offset);
          if (oddLast && ch === inChCount - 1) {
            const cGain = scale * Math.SQRT1_2;
            for (let i = 0; i < copyN; i++) {
              const raw = src[offset + i];
              const s = Number.isFinite(raw) ? raw : 0.0;
              const v = s * cGain;
              f32[this.ioL + i] += v;
              f32[this.ioR + i] += v;
            }
          } else if ((ch & 1) === 0) {
            for (let i = 0; i < copyN; i++) {
              const raw = src[offset + i];
              const s = Number.isFinite(raw) ? raw : 0.0;
              f32[this.ioL + i] += s * scale;
            }
          } else {
            for (let i = 0; i < copyN; i++) {
              const raw = src[offset + i];
              const s = Number.isFinite(raw) ? raw : 0.0;
              f32[this.ioR + i] += s * scale;
            }
          }
        }
      }

      this.wasm.wdcab_process(chunkLen, wasmInCount, outChCount);

      this.refreshViews();
      const outF32 = this.f32;
      out[0].set(outF32.subarray(this.ioL, this.ioL + chunkLen), offset);
      if (out[1]) {
        out[1].set(outF32.subarray(this.ioR, this.ioR + chunkLen), offset);
      }
      for (let ch = 2; ch < out.length; ch++) {
        if (out[ch]) out[ch].fill(0, offset, offset + chunkLen);
      }
    }

    if (--this.telemCountdown <= 0) {
      this.telemCountdown = this.telemPeriodQuanta; // ~30 Hz at 48-384 kHz
      this.wasm.wdcab_update_telemetry();
      this.refreshViews();
      const f32 = this.f32;
      const telemBase = this.telem;
      const telemBuf = this.telemBuf;
      for (let i = 0; i < TELEM_FLOATS; i++) {
        telemBuf[i] = f32[telemBase + i];
      }
      this.port.postMessage({ type: 'telemetry', data: telemBuf, resetSeq: this.resetSeq });
    }
    return true;
  }
}

registerProcessor('wd-cab', WdCabWorklet);
