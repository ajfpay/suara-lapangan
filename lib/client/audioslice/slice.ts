/**
 * lib/client/audioslice/slice.ts
 *
 * Pure functions for parsing and slicing WAV audio by millisecond ranges.
 * Fully deterministic, zero external dependencies.
 */

export interface WavInfo {
    numChannels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
    dataOffset: number;
    dataLength: number;
    totalSamples: number;
    durationMs: number;
}

/**
 * Parse standard PCM WAV header and locate audio chunks.
 */
export function parseWav(buffer: ArrayBuffer | Uint8Array): WavInfo {
    const rawBuffer =
        buffer instanceof Uint8Array
            ? buffer.buffer.slice(
                  buffer.byteOffset,
                  buffer.byteOffset + buffer.byteLength
              )
            : buffer;
    const view = new DataView(rawBuffer);

    if (view.byteLength < 12) {
        throw new Error("Invalid WAV: file too small");
    }

    const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    );
    if (riff !== "RIFF") {
        throw new Error("Invalid WAV: missing RIFF header");
    }

    const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11)
    );
    if (wave !== "WAVE") {
        throw new Error("Invalid WAV: missing WAVE header");
    }

    let offset = 12;
    let fmt: {
        numChannels: number;
        sampleRate: number;
        byteRate: number;
        blockAlign: number;
        bitsPerSample: number;
    } | null = null;
    let dataOffset = -1;
    let dataLength = -1;

    while (offset + 8 <= view.byteLength) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === "fmt ") {
            const numChannels = view.getUint16(offset + 10, true);
            const sampleRate = view.getUint32(offset + 12, true);
            const byteRate = view.getUint32(offset + 16, true);
            const blockAlign = view.getUint16(offset + 20, true);
            const bitsPerSample = view.getUint16(offset + 22, true);

            fmt = {
                numChannels,
                sampleRate,
                byteRate,
                blockAlign,
                bitsPerSample,
            };
        } else if (chunkId === "data") {
            dataOffset = offset + 8;
            dataLength = Math.min(chunkSize, view.byteLength - dataOffset);
            break;
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) {
            offset += 1;
        }
    }

    if (!fmt) {
        throw new Error("Invalid WAV: missing fmt chunk");
    }
    if (dataOffset === -1 || dataLength === -1) {
        throw new Error("Invalid WAV: missing data chunk");
    }

    const totalSamples = Math.floor(dataLength / fmt.blockAlign);
    const durationMs = (totalSamples / fmt.sampleRate) * 1000;

    return {
        ...fmt,
        dataOffset,
        dataLength,
        totalSamples,
        durationMs,
    };
}

/**
 * Slice a WAV buffer to only the given millisecond range [startMs, endMs].
 * Returns a new ArrayBuffer with valid 44-byte WAV header and sliced PCM samples.
 */
export function sliceWavBuffer(
    buffer: ArrayBuffer | Uint8Array,
    startMs: number,
    endMs: number
): ArrayBuffer {
    const info = parseWav(buffer);
    const rawBuffer =
        buffer instanceof Uint8Array
            ? buffer.buffer.slice(
                  buffer.byteOffset,
                  buffer.byteOffset + buffer.byteLength
              )
            : buffer;

    const clampedStartMs = Math.max(0, startMs);
    const clampedEndMs = Math.max(clampedStartMs, endMs);

    const startSample = Math.min(
        info.totalSamples,
        Math.floor((clampedStartMs / 1000) * info.sampleRate)
    );
    const endSample = Math.min(
        info.totalSamples,
        Math.ceil((clampedEndMs / 1000) * info.sampleRate)
    );

    const sliceSamples = Math.max(0, endSample - startSample);
    const sliceByteLength = sliceSamples * info.blockAlign;

    const headerLength = 44;
    const outputBuffer = new ArrayBuffer(headerLength + sliceByteLength);
    const outView = new DataView(outputBuffer);

    let offset = 0;
    // RIFF
    outView.setUint8(offset++, 0x52); // R
    outView.setUint8(offset++, 0x49); // I
    outView.setUint8(offset++, 0x46); // F
    outView.setUint8(offset++, 0x46); // F
    outView.setUint32(offset, 36 + sliceByteLength, true);
    offset += 4;
    outView.setUint8(offset++, 0x57); // W
    outView.setUint8(offset++, 0x41); // A
    outView.setUint8(offset++, 0x56); // V
    outView.setUint8(offset++, 0x45); // E

    // fmt
    outView.setUint8(offset++, 0x66); // f
    outView.setUint8(offset++, 0x6d); // m
    outView.setUint8(offset++, 0x74); // t
    outView.setUint8(offset++, 0x20); // ' '
    outView.setUint32(offset, 16, true);
    offset += 4;
    outView.setUint16(offset, 1, true);
    offset += 2; // PCM
    outView.setUint16(offset, info.numChannels, true);
    offset += 2;
    outView.setUint32(offset, info.sampleRate, true);
    offset += 4;
    outView.setUint32(offset, info.byteRate, true);
    offset += 4;
    outView.setUint16(offset, info.blockAlign, true);
    offset += 2;
    outView.setUint16(offset, info.bitsPerSample, true);
    offset += 2;

    // data
    outView.setUint8(offset++, 0x64); // d
    outView.setUint8(offset++, 0x61); // a
    outView.setUint8(offset++, 0x74); // t
    outView.setUint8(offset++, 0x61); // a
    outView.setUint32(offset, sliceByteLength, true);
    offset += 4;

    // Copy PCM bytes
    if (sliceByteLength > 0) {
        const srcByteOffset = info.dataOffset + startSample * info.blockAlign;
        const srcBytes = new Uint8Array(
            rawBuffer,
            srcByteOffset,
            sliceByteLength
        );
        const outBytes = new Uint8Array(outputBuffer, 44, sliceByteLength);
        outBytes.set(srcBytes);
    }

    return outputBuffer;
}

/**
 * Slice a WAV blob or buffer into a new WAV Blob with MIME type "audio/wav".
 */
export async function sliceWav(
    audioSource: Blob | ArrayBuffer | Uint8Array,
    startMs: number,
    endMs: number
): Promise<Blob> {
    const buffer =
        audioSource instanceof Blob
            ? await audioSource.arrayBuffer()
            : audioSource;
    const sliced = sliceWavBuffer(buffer, startMs, endMs);
    return new Blob([sliced], { type: "audio/wav" });
}
