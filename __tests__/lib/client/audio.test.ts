/**
 * Tests for lib/client/audio.ts — toWav16k()
 *
 * RED: these fail until the function is implemented.
 * GREEN: implement toWav16k() until all pass.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock AudioBuffer helpers ---

/** Build a minimal AudioBuffer for testing. */
function makeBuffer(
  sampleRate: number,
  numberOfChannels: number,
  length: number,
  channelData: Float32Array[]
): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels,
    length,
    duration: length / sampleRate,
    getChannelData: (n: number) => channelData[n] ?? new Float32Array(0),
    getFloatTimeDomainData: () => {},
    copyFromChannel: () => {},
    copyToChannel: () => {},
    // AudioBuffer is not fully mockable; we only need the properties we use.
  } as unknown as AudioBuffer;
}

/** Silent mono buffer, 16 kHz, given duration in seconds. */
function silentMono(durationSec: number): AudioBuffer {
  const sampleRate = 16000;
  const length = Math.ceil(sampleRate * durationSec);
  return makeBuffer(sampleRate, 1, length, [new Float32Array(length)]);
}

describe("toWav16k", () => {
  // Lazy-import so the module-under-test is fresh per test.
  let toWav16k: (buffer: AudioBuffer) => Blob;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("@/lib/client/audio");
    toWav16k = mod.toWav16k;
  });

  // ── WAV header structure ──────────────────────────────────────────────────

  it("returns a Blob with audio/wav MIME type", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    expect(blob.type).toBe("audio/wav");
  });

  it("starts with RIFF magic bytes", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const buf2 = await blob.arrayBuffer();
    const view = new DataView(buf2);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    expect(riff).toBe("RIFF");
  });

  it('has "WAVE" as the format identifier', async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const buf2 = await blob.arrayBuffer();
    const view = new DataView(buf2);
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(wave).toBe("WAVE");
  });

  // ── fmt chunk ───────────────────────────────────────────────────────────────

  it("sets PCM format code (1) in fmt chunk", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // fmt chunk starts at offset 12; audio_format at offset 20 (2 bytes LE).
    const audioFormat = view.getUint16(20, true);
    expect(audioFormat).toBe(1);
  });

  it("sets 1 channel (mono) in fmt chunk", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // num_channels at offset 22 (2 bytes LE).
    const numChannels = view.getUint16(22, true);
    expect(numChannels).toBe(1);
  });

  it("sets 16000 Hz sample rate in fmt chunk", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // sample_rate at offset 24 (4 bytes LE).
    const sampleRate = view.getUint32(24, true);
    expect(sampleRate).toBe(16000);
  });

  it("sets 16 bits per sample in fmt chunk", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // bits_per_sample at offset 34 (2 bytes LE).
    const bitsPerSample = view.getUint16(34, true);
    expect(bitsPerSample).toBe(16);
  });

  // ── data chunk ─────────────────────────────────────────────────────────────

  it("data chunk starts with 'data' magic", async () => {
    const buf = silentMono(1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // data chunk starts at offset 36 (standard WAV: 12 RIFF+fmt + 24 fmt-chunk).
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    );
    expect(data).toBe("data");
  });

  // ── Duration / size math ───────────────────────────────────────────────────

  it("encodes exactly 1 second of silence as ~32 002 bytes (44 header + 32 000 PCM)", async () => {
    const buf = silentMono(1); // 16 000 samples
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    // Expected: 44-byte header + 16 000 samples × 2 bytes = 32 044 bytes.
    expect(ab.byteLength).toBe(16000 * 2 + 44);
  });

  it("encodes 0.5 seconds correctly (header + 16 000 bytes)", async () => {
    const buf = silentMono(0.5); // 8 000 samples
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    expect(ab.byteLength).toBe(8000 * 2 + 44);
  });

  it("10-minute recording produces ~19 200 044 bytes (≈19.2 MB)", async () => {
    const buf = silentMono(600); // 10 minutes = 600 seconds
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const expected = 16000 * 600 * 2 + 44; // 19 200 044
    expect(ab.byteLength).toBe(expected);
    // Sanity: within 1 byte of expected.
    expect(ab.byteLength).toBeGreaterThan(19_200_000);
    expect(ab.byteLength).toBeLessThan(19_200_100);
  });

  // ── PCM content ─────────────────────────────────────────────────────────────

  it("PCM data is little-endian 16-bit signed integers", async () => {
    // Create a buffer with a known pattern: one sample at 0.5 (max positive for 16-bit).
    const sampleRate = 16000;
    const length = 1;
    const samples = new Float32Array([0.5]);
    const buf = makeBuffer(sampleRate, 1, length, [samples]);

    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // PCM data starts at offset 44 (header size).
    const pcmValue = view.getInt16(44, true);
    // 0.5 in float32 → 0.5 * 32767 ≈ 16383 as 16-bit PCM.
    expect(pcmValue).toBeCloseTo(16383, -1);
  });

  it("silence (all zeros) produces all-zero PCM samples", async () => {
    const buf = silentMono(0.1);
    const blob = toWav16k(buf);
    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    const pcmStart = 44;
    const sampleCount = Math.floor(16000 * 0.1);
    for (let i = 0; i < Math.min(sampleCount, 100); i++) {
      const val = view.getInt16(pcmStart + i * 2, true);
      expect(val).toBe(0);
    }
  });
});
