/**
 * lib/client/audio.ts
 *
 * Pure functions for audio processing in the browser.
 * All functions are synchronous and side-effect free.
 */

/**
 * Convert an AudioBuffer to a WAV Blob (mono, 16-bit PCM, 16 kHz).
 *
 * The output is always mono (channel 0) at 16 kHz. If the input has
 * multiple channels, only channel 0 is used. If the input has a different
 * sample rate, the samples are re-sampled using linear interpolation.
 *
 * WAV format:
 *   RIFF header  (12 bytes): "RIFF" + file_size + "WAVE"
 *   fmt chunk    (24 bytes): "fmt " + 16 + 1 (PCM) + 1 (mono) + 16000 + 32000 + 2 + 16
 *   data chunk   (8+N bytes): "data" + data_size + N bytes PCM
 *
 * @param buffer - AudioBuffer to convert (any sample rate, any channel count).
 * @returns Blob with MIME type "audio/wav".
 */
export function toWav16k(buffer: AudioBuffer): Blob {
  const targetSampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8; // 2

  // Source samples from channel 0.
  const srcData = buffer.getChannelData(0);
  const srcSampleRate = buffer.sampleRate;

  // Compute target length after resampling.
  const ratio = targetSampleRate / srcSampleRate;
  const srcLength = srcData.length;
  const targetLength = Math.ceil(srcLength * ratio);

  // Resample via linear interpolation.
  const pcmData = new Int16Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const srcIndex = i / ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, srcLength - 1);
    const t = srcIndex - srcIndexFloor;
    const sample = srcData[srcIndexFloor] * (1 - t) + srcData[srcIndexCeil] * t;
    // Clamp to [-1, 1] and convert to 16-bit signed PCM.
    const clamped = Math.max(-1, Math.min(1, sample));
    pcmData[i] = Math.round(clamped * 32767);
  }

  const dataBytes = pcmData.byteLength;
  const headerBytes = 44;
  const totalBytes = headerBytes + dataBytes;

  const wav = new ArrayBuffer(totalBytes);
  const view = new DataView(wav);
  let offset = 0;

  // RIFF header
  view.setUint8(offset++, 0x52); // R
  view.setUint8(offset++, 0x49); // I
  view.setUint8(offset++, 0x46); // F
  view.setUint8(offset++, 0x46); // F
  view.setUint32(offset, totalBytes - 8, true); offset += 4; // file_size - 8
  view.setUint8(offset++, 0x57); // W
  view.setUint8(offset++, 0x41); // A
  view.setUint8(offset++, 0x56); // V
  view.setUint8(offset++, 0x45); // E

  // fmt chunk
  view.setUint8(offset++, 0x66); // f
  view.setUint8(offset++, 0x6d); // m
  view.setUint8(offset++, 0x74); // t
  view.setUint8(offset++, 0x20); // (space)
  view.setUint32(offset, 16, true); offset += 4; // chunk_size = 16
  view.setUint16(offset, 1, true); offset += 2;  // audio_format = PCM
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, targetSampleRate, true); offset += 4;
  view.setUint32(offset, targetSampleRate * numChannels * bytesPerSample, true); offset += 4; // byte_rate
  view.setUint16(offset, numChannels * bytesPerSample, true); offset += 2; // block_align
  view.setUint16(offset, bitsPerSample, true); offset += 2;

  // data chunk
  view.setUint8(offset++, 0x64); // d
  view.setUint8(offset++, 0x61); // a
  view.setUint8(offset++, 0x74); // t
  view.setUint8(offset++, 0x61); // a
  view.setUint32(offset, dataBytes, true); offset += 4;

  // PCM samples (little-endian)
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(offset, pcmData[i], true);
    offset += 2;
  }

  return new Blob([wav], { type: "audio/wav" });
}
