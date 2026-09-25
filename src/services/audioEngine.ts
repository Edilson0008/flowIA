/**
 * Harmonix Audio Engine
 * Real-time Web Audio API Synthesizer and 16-bit 44.1kHz WAV exporter.
 * Features realistic acoustic & synth modeling, drum machine, multi-track mixer,
 * and high-fidelity offline audio rendering.
 */

import { SongProject, Track, Note, InstrumentType } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private isPlaying = false;
  private currentProject: SongProject | null = null;
  private currentBeat = 0;
  private tempoBpm = 120;
  private scheduledSources: { stop: () => void }[] = [];
  private playbackTimer: number | null = null;
  private startTime = 0;
  private startBeatOffset = 0;
  private audioEl: HTMLAudioElement | null = null;

  // Listeners
  private onBeatUpdateListeners: ((beat: number, totalBeats: number) => void)[] = [];
  private onPlaybackEndListeners: (() => void)[] = [];

  constructor() {
    // Initialized on first user gesture
  }

  private initContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      const chain = this.buildMasterChain(this.ctx, this.ctx.destination);
      this.masterGain = chain.input;
      this.analyser = chain.analyser;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Master bus: dry + generated-impulse reverb + tempo-synced-ish delay
   * into a glue compressor. Used for realtime and offline rendering.
   */
  private buildMasterChain(ctx: BaseAudioContext, destination: AudioDestinationNode): { input: GainNode; analyser: AnalyserNode } {
    const input = ctx.createGain();
    input.gain.setValueAtTime(0.85, ctx.currentTime);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, ctx.currentTime);
    comp.knee.setValueAtTime(22, ctx.currentTime);
    comp.ratio.setValueAtTime(5, ctx.currentTime);
    comp.attack.setValueAtTime(0.004, ctx.currentTime);
    comp.release.setValueAtTime(0.18, ctx.currentTime);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // Dry
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(0.9, ctx.currentTime);
    input.connect(dry);
    dry.connect(comp);

    // Reverb (generated impulse)
    try {
      const conv = ctx.createConvolver();
      conv.buffer = this.makeImpulse(ctx, 1.9, 2.6);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0.24, ctx.currentTime);
      input.connect(conv);
      conv.connect(wet);
      wet.connect(comp);
    } catch {
      // Convolver unavailable — dry only
    }

    // Slapback / echo with feedback
    try {
      const delay = ctx.createDelay(1.0);
      delay.delayTime.setValueAtTime(0.32, ctx.currentTime);
      const fb = ctx.createGain();
      fb.gain.setValueAtTime(0.32, ctx.currentTime);
      const echoOut = ctx.createGain();
      echoOut.gain.setValueAtTime(0.16, ctx.currentTime);
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(echoOut);
      echoOut.connect(comp);
    } catch {
      // Delay unavailable — skip
    }

    comp.connect(analyser);
    analyser.connect(destination);
    return { input, analyser };
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  public getAnalyser(): AnalyserNode | null {
    this.initContext();
    return this.analyser;
  }

  public setMasterVolume(volume: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.05);
    }
  }

  public onBeatUpdate(cb: (beat: number, totalBeats: number) => void) {
    this.onBeatUpdateListeners.push(cb);
  }

  public onPlaybackEnd(cb: () => void) {
    this.onPlaybackEndListeners.push(cb);
  }

  // Convert MIDI note number to frequency in Hz
  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Synthesizes a single note with high-quality instrument synthesis
   */
  private playInstrumentNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    instrument: InstrumentType,
    midi: number,
    startTime: number,
    durationSec: number,
    velocity: number
  ) {
    const freq = this.midiToFreq(midi);
    const velFactor = Math.min(1, Math.max(0.1, velocity / 127));

    switch (instrument) {
      case 'drum_kit': {
        this.playDrumSound(ctx, destination, midi, startTime, velFactor);
        break;
      }
      case 'acoustic_grand_piano':
      case 'electric_piano': {
        // Multi-oscillator harmonic acoustic piano simulation
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = instrument === 'electric_piano' ? 'sine' : 'triangle';
        osc1.frequency.setValueAtTime(freq, startTime);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2.002, startTime); // Harmonic overtone

        // Natural piano attack, decay, sustain, release envelope
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.45 * velFactor, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.2 * velFactor, startTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.25, durationSec));

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(destination);

        osc1.start(startTime);
        osc2.start(startTime);
        const stopTime = startTime + Math.max(0.3, durationSec);
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        break;
      }
      case 'sub_bass_808':
      case 'electric_bass': {
        // Thick bass with saturated sub tone
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = instrument === 'sub_bass_808' ? 'sine' : 'sawtooth';
        osc.frequency.setValueAtTime(freq, startTime);
        if (instrument === 'sub_bass_808') {
          // slight pitch slide down for 808 punch
          osc.frequency.exponentialRampToValueAtTime(Math.max(25, freq * 0.96), startTime + 0.08);
        }

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(instrument === 'sub_bass_808' ? 180 : 350, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.55 * velFactor, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        osc.start(startTime);
        osc.stop(startTime + durationSec + 0.05);
        break;
      }
      case 'acoustic_guitar':
      case 'electric_guitar': {
        // Karplus-Strong / filtered sawtooth string emulation
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(instrument === 'electric_guitar' ? 3200 : 1600, startTime);
        filter.frequency.exponentialRampToValueAtTime(400, startTime + durationSec);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(0.38 * velFactor, startTime + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        osc.start(startTime);
        osc.stop(startTime + durationSec + 0.05);
        break;
      }
      case 'synth_lead': {
        // Punchy supersaw lead with low-pass resonance sweep
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'square';
        osc1.frequency.setValueAtTime(freq, startTime);
        osc2.frequency.setValueAtTime(freq * 1.004, startTime); // detuned

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2500, startTime);
        filter.Q.value = 4.0;
        filter.frequency.exponentialRampToValueAtTime(800, startTime + durationSec);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.28 * velFactor, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + durationSec + 0.05);
        osc2.stop(startTime + durationSec + 0.05);
        break;
      }
      case 'synth_pad':
      case 'strings_ensemble': {
        // Lush warm detuned pad with slow attack
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        osc1.frequency.setValueAtTime(freq * 0.997, startTime);
        osc2.frequency.setValueAtTime(freq * 1.003, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(0.22 * velFactor, startTime + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.3);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + durationSec + 0.35);
        osc2.stop(startTime + durationSec + 0.35);
        break;
      }
      case 'vocal_choir': {
        // "Aah" choir: detuned saws through ah-vowel formant bandpass filters
        const formants = [730, 1090, 2440];
        const gains = [0.5, 0.32, 0.18];
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, startTime);
        master.gain.linearRampToValueAtTime(0.3 * velFactor, startTime + 0.09);
        master.gain.setValueAtTime(0.3 * velFactor, startTime + Math.max(0.09, durationSec - 0.12));
        master.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.1);
        master.connect(destination);

        const oscs: OscillatorNode[] = [];
        for (const detune of [0, 4, -5]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, startTime);
          osc.detune.setValueAtTime(detune, startTime);
          // gentle vibrato like a human voice
          const lfo = ctx.createOscillator();
          lfo.frequency.setValueAtTime(5.2, startTime);
          const lfoGain = ctx.createGain();
          lfoGain.gain.setValueAtTime(6, startTime);
          lfo.connect(lfoGain);
          lfoGain.connect(osc.detune);
          oscs.push(osc, lfo);
          formants.forEach((f, fi) => {
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(f, startTime);
            bp.Q.value = 7;
            const fg = ctx.createGain();
            fg.gain.setValueAtTime(gains[fi], startTime);
            osc.connect(bp);
            bp.connect(fg);
            fg.connect(master);
          });
          osc.start(startTime);
          lfo.start(startTime);
          osc.stop(startTime + durationSec + 0.15);
          lfo.stop(startTime + durationSec + 0.15);
        }
        void oscs;
        break;
      }
      case 'brass_section':
      case 'flute_sax': {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = instrument === 'brass_section' ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(instrument === 'brass_section' ? 2400 : 1800, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.3 * velFactor, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        osc.start(startTime);
        osc.stop(startTime + durationSec + 0.05);
        break;
      }
      default: {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.2 * velFactor, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(startTime);
        osc.stop(startTime + durationSec + 0.05);
      }
    }
  }

  /**
   * Synthesizes drum kit hits according to MIDI percussion map (35/36 = Kick, 38/40 = Snare, 42 = Closed HH, etc.)
   */
  private playDrumSound(
    ctx: BaseAudioContext,
    destination: AudioNode,
    midi: number,
    startTime: number,
    velFactor: number
  ) {
    if (midi === 35 || midi === 36) {
      // Bass Kick Drum: Pitch sweep + sine thump
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, startTime);
      osc.frequency.exponentialRampToValueAtTime(38, startTime + 0.08);

      gain.gain.setValueAtTime(0.7 * velFactor, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

      osc.connect(gain);
      gain.connect(destination);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    } else if (midi === 38 || midi === 40) {
      // Snare Drum: Noise burst + body tone
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.setValueAtTime(1000, startTime);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.55 * velFactor, startTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(destination);
      whiteNoise.start(startTime);
      whiteNoise.stop(startTime + 0.2);

      // Body tone
      const osc = ctx.createOscillator();
      const toneGain = ctx.createGain();
      osc.frequency.setValueAtTime(190, startTime);
      osc.frequency.exponentialRampToValueAtTime(80, startTime + 0.08);
      toneGain.gain.setValueAtTime(0.35 * velFactor, startTime);
      toneGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
      osc.connect(toneGain);
      toneGain.connect(destination);
      osc.start(startTime);
      osc.stop(startTime + 0.15);
    } else if (midi === 42 || midi === 44) {
      // Closed Hi-Hat: Filtered bandpass noise
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7000, startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.3 * velFactor, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      noise.start(startTime);
      noise.stop(startTime + 0.06);
    } else if (midi === 46 || midi === 49) {
      // Open Hi-Hat / Crash Cymbal: Sizzle noise
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(5500, startTime);
      filter.Q.value = 1.2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35 * velFactor, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      noise.start(startTime);
      noise.stop(startTime + 0.4);
    } else {
      // Generic Percussion / Tom
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, startTime);
      osc.frequency.exponentialRampToValueAtTime(60, startTime + 0.15);
      gain.gain.setValueAtTime(0.4 * velFactor, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(startTime);
      osc.stop(startTime + 0.25);
    }
  }

  /**
   * Starts playback of a song project
   */
  public play(project: SongProject, startBeat = 0) {
    this.initContext();
    this.stop();

    this.currentProject = project;
    this.tempoBpm = project.bpm || 120;
    this.startBeatOffset = startBeat;
    this.isPlaying = true;

    // Check if we have real rendered audio (Replicate URL or Lyria base64)
    if (project.audioUrl) {
      this.playUrlAudio(project.audioUrl, startBeat);
      return;
    }
    if (project.audioBase64) {
      this.playBase64Audio(project.audioBase64, project.audioMimeType || 'audio/wav', startBeat);
      return;
    }

    if (!this.ctx || !this.masterGain) return;

    this.startTime = this.ctx.currentTime;
    const secondsPerBeat = 60 / this.tempoBpm;

    // Calculate total beats in composition
    let maxBeat = 16;
    project.tracks.forEach((track) => {
      track.notes.forEach((note) => {
        const end = note.startBeat + note.duration;
        if (end > maxBeat) maxBeat = end;
      });
    });

    const hasAnySolo = project.tracks.some((t) => t.solo);

    // Schedule each active track
    project.tracks.forEach((track) => {
      if (track.muted) return;
      if (hasAnySolo && !track.solo) return;

      // Track sub-mixer
      const trackGain = this.ctx!.createGain();
      const trackVol = track.volume !== undefined ? track.volume : 0.8;
      trackGain.gain.setValueAtTime(trackVol, this.ctx!.currentTime);

      const panner = this.ctx!.createStereoPanner();
      if (panner) {
        panner.pan.setValueAtTime(track.pan || 0, this.ctx!.currentTime);
        trackGain.connect(panner);
        panner.connect(this.masterGain!);
      } else {
        trackGain.connect(this.masterGain!);
      }

      track.notes.forEach((note) => {
        if (note.startBeat + note.duration <= startBeat) return; // already passed

        const noteStartOffsetBeats = Math.max(0, note.startBeat - startBeat);
        const noteStartTime = this.startTime + noteStartOffsetBeats * secondsPerBeat;
        const noteDurationSec = note.duration * secondsPerBeat;

        this.playInstrumentNote(
          this.ctx!,
          trackGain,
          track.instrument,
          note.midi,
          noteStartTime,
          noteDurationSec,
          note.velocity
        );
      });
    });

    // Beat polling ticker for UI scrubbers & visualizers
    const totalDurationSec = (maxBeat - startBeat) * secondsPerBeat;
    const intervalMs = 40;

    this.playbackTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.ctx) return;
      const elapsedSec = this.ctx.currentTime - this.startTime;
      const elapsedBeats = startBeat + elapsedSec / secondsPerBeat;
      this.currentBeat = elapsedBeats;

      this.onBeatUpdateListeners.forEach((fn) => fn(elapsedBeats, maxBeat));

      if (elapsedSec >= totalDurationSec) {
        this.stop();
        this.onPlaybackEndListeners.forEach((fn) => fn());
      }
    }, intervalMs);
  }

  private playUrlAudio(url: string, startOffsetBeat: number) {
    try {
      if (this.audioEl) {
        this.audioEl.pause();
        this.audioEl = null;
      }
      const audio = new Audio(url);
      this.audioEl = audio;
      const secondsPerBeat = 60 / this.tempoBpm;

      audio.onloadedmetadata = () => {
        if (startOffsetBeat > 0 && audio.duration) {
          audio.currentTime = Math.min(audio.duration - 0.5, startOffsetBeat * secondsPerBeat);
        }
      };

      if (this.ctx && this.masterGain && this.analyser) {
        try {
          const source = this.ctx.createMediaElementSource(audio);
          source.connect(this.masterGain);
        } catch {
          // Fallback direct playback
        }
      }

      audio.play().catch(console.error);

      audio.ontimeupdate = () => {
        if (!this.isPlaying) return;
        const curBeat = audio.currentTime / secondsPerBeat;
        const totBeats = (audio.duration || 60) / secondsPerBeat;
        this.onBeatUpdateListeners.forEach((fn) => fn(curBeat, totBeats));
      };

      audio.onended = () => {
        this.stop();
        this.onPlaybackEndListeners.forEach((fn) => fn());
      };
    } catch (err) {
      console.error('Error playing URL audio:', err);
    }
  }

  private playBase64Audio(base64: string, mimeType: string, startOffsetBeat: number) {
    try {
      if (this.audioEl) {
        this.audioEl.pause();
        this.audioEl = null;
      }

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      this.audioEl = audio;

      const secondsPerBeat = 60 / this.tempoBpm;
      if (startOffsetBeat > 0) {
        audio.currentTime = startOffsetBeat * secondsPerBeat;
      }

      // Connect HTML Audio element to analyser node if possible
      if (this.ctx && this.masterGain && this.analyser) {
        try {
          const source = this.ctx.createMediaElementSource(audio);
          source.connect(this.masterGain);
        } catch {
          // Fallback direct playback
        }
      }

      audio.play().catch(console.error);

      audio.ontimeupdate = () => {
        if (!this.isPlaying) return;
        const currentSec = audio.currentTime;
        const durationSec = audio.duration || 30;
        const curBeat = currentSec / secondsPerBeat;
        const totBeats = durationSec / secondsPerBeat;
        this.onBeatUpdateListeners.forEach((fn) => fn(curBeat, totBeats));
      };

      audio.onended = () => {
        this.stop();
        this.onPlaybackEndListeners.forEach((fn) => fn());
      };
    } catch (err) {
      console.error('Error playing base64 audio:', err);
    }
  }

  public stop() {
    this.isPlaying = false;
    if (this.playbackTimer !== null) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    this.scheduledSources.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Ignored
      }
    });
    this.scheduledSources = [];
  }

  public pause() {
    this.stop();
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Renders the complete multi-track song project to a standard 16-bit 44.1kHz stereo WAV Blob
   */
  public async renderProjectToWav(project: SongProject): Promise<Blob> {
    // If project has real AI audio URL, fetch it directly
    if (project.audioUrl) {
      try {
        const r = await fetch(project.audioUrl);
        if (r.ok) return await r.blob();
      } catch (e) {
        console.warn('URL audio fetch failed, rendering synth:', e);
      }
    }
    if (project.audioBase64) {
      const binary = atob(project.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: project.audioMimeType || 'audio/wav' });
    }

    const sampleRate = 44100;
    const bpm = project.bpm || 120;
    const secondsPerBeat = 60 / bpm;

    let maxBeat = 16;
    project.tracks.forEach((track) => {
      track.notes.forEach((note) => {
        const end = note.startBeat + note.duration;
        if (end > maxBeat) maxBeat = end;
      });
    });

    const totalSeconds = Math.max(3, maxBeat * secondsPerBeat + 1.5);
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalSeconds * sampleRate), sampleRate);

    // Master bus with FX
    const offlineMaster = this.buildMasterChain(offlineCtx, offlineCtx.destination).input;

    const hasAnySolo = project.tracks.some((t) => t.solo);

    project.tracks.forEach((track) => {
      if (track.muted) return;
      if (hasAnySolo && !track.solo) return;

      const trackGain = offlineCtx.createGain();
      trackGain.gain.setValueAtTime(track.volume !== undefined ? track.volume : 0.8, 0);

      const panner = offlineCtx.createStereoPanner();
      if (panner) {
        panner.pan.setValueAtTime(track.pan || 0, 0);
        trackGain.connect(panner);
        panner.connect(offlineMaster);
      } else {
        trackGain.connect(offlineMaster);
      }

      track.notes.forEach((note) => {
        const noteStartTime = note.startBeat * secondsPerBeat;
        const noteDurationSec = note.duration * secondsPerBeat;

        this.playInstrumentNote(
          offlineCtx,
          trackGain,
          track.instrument,
          note.midi,
          noteStartTime,
          noteDurationSec,
          note.velocity
        );
      });
    });

    const renderedBuffer = await offlineCtx.startRendering();
    return this.audioBufferToWavBlob(renderedBuffer);
  }

  /**
   * Encodes an AudioBuffer into RIFF WAVE 16-bit PCM format
   */
  private audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2; // 16-bit samples
    const bufferArray = new ArrayBuffer(44 + length);
    const view = new DataView(bufferArray);

    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    // file length
    view.setUint32(4, 36 + length, true);
    // RIFF type & format
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw PCM = 1)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sampleRate * blockAlign)
    view.setUint32(28, sampleRate * numChannels * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, numChannels * 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    this.writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, length, true);

    // Interleave channels and write 16-bit PCM samples
    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        // Clamp sample between -1 and 1
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        // Scale to 16-bit signed integer
        const val = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, val, true);
        offset += 2;
      }
    }

    return new Blob([bufferArray], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  public async downloadWav(project: SongProject, filename?: string): Promise<void> {
    const blob = await this.renderProjectToWav(project);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${project.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const audioEngine = new AudioEngine();
