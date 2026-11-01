#!/usr/bin/env node

/**
 * Standalone demo client for Meta Muse Voice Realtime ASR.
 * Connects to wss://api.meta.ai/v1/asr/realtime, streams 16kHz mono WAV audio
 * paced at real time, and prints cumulative partials and turns with speaker labels.
 *
 * Uses built-in Node.js WebSocket (no external dependencies).
 *
 * Usage:
 *   node scripts/asr-realtime.mjs <file.wav> [options]
 *
 * Options:
 *   --mode <mode>            ASR mode: ENDPOINTING (default) or DIARIZATION
 *   --keywords <keywords>    Comma-separated keywords to bias recognition
 *   --language-bias <langs>  Comma-separated languages (default: Indonesian,English)
 *   --endpoint <url>         WebSocket endpoint URL
 *   --help, -h               Show usage information
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENDPOINT = "wss://api.meta.ai/v1/asr/realtime";

const CLOSE_MESSAGES = {
    1000: "Stream completed successfully (1000: Normal Closure).",
    1008: "Authentication or quota policy violation (1008: Policy Violation) — verify MODEL_API_KEY and quota.",
    1011: "Internal server error from Meta ASR service (1011: Internal Error).",
    1013: "Upstream service busy or rate limited (1013: Try Again Later).",
};

function printUsage() {
    console.log(`
Meta ASR Realtime Streaming Client

Usage:
  node scripts/asr-realtime.mjs <file.wav> [options]

Options:
  --mode <mode>            ASR mode: ENDPOINTING (default) or DIARIZATION
  --keywords <keywords>    Comma-separated list of keywords to bias recognition
  --language-bias <langs>  Comma-separated languages (default: Indonesian,English)
  --endpoint <url>         WebSocket endpoint URL (default: ${DEFAULT_ENDPOINT})
  --help, -h               Show this help message

Environment:
  MODEL_API_KEY            Required Bearer token for Meta Voice API
`);
}

function parseArgs(args) {
    const options = {
        file: null,
        mode: "ENDPOINTING",
        keywords: [],
        languageBias: ["Indonesian", "English"],
        endpoint: process.env.META_ASR_WSS_URL || DEFAULT_ENDPOINT,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-h" || arg === "--help") {
            printUsage();
            process.exit(0);
        } else if (arg === "--mode") {
            const next = args[++i];
            if (
                !next ||
                !["ENDPOINTING", "DIARIZATION", "PUSH_TO_TALK"].includes(
                    next.toUpperCase()
                )
            ) {
                console.error(
                    `Invalid mode: ${next}. Expected ENDPOINTING or DIARIZATION.`
                );
                process.exit(1);
            }
            options.mode = next.toUpperCase();
        } else if (arg === "--keywords") {
            const next = args[++i];
            if (next) {
                options.keywords = next
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean);
            }
        } else if (arg === "--language-bias") {
            const next = args[++i];
            if (next) {
                options.languageBias = next
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean);
            }
        } else if (arg === "--endpoint") {
            options.endpoint = args[++i];
        } else if (!arg.startsWith("-") && !options.file) {
            options.file = arg;
        }
    }

    return options;
}

/**
 * Parses a standard RIFF/WAVE file and returns raw 16-bit mono 16kHz PCM data.
 */
function extractPcmFromWav(buffer) {
    if (buffer.length < 44) {
        throw new Error("File too small to be a valid WAV file.");
    }

    const riff = buffer.toString("ascii", 0, 4);
    const wave = buffer.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE") {
        throw new Error("Invalid WAV file: missing RIFF/WAVE header.");
    }

    let offset = 12;
    let dataOffset = -1;
    let dataSize = 0;
    let sampleRate = 16000;
    let channels = 1;
    let bitsPerSample = 16;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkDataOffset = offset + 8;

        if (chunkId === "fmt ") {
            const audioFormat = buffer.readUInt16LE(chunkDataOffset);
            if (audioFormat !== 1) {
                throw new Error(
                    `Unsupported WAV format (${audioFormat}): must be uncompressed PCM (1).`
                );
            }
            channels = buffer.readUInt16LE(chunkDataOffset + 2);
            sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
            bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
        } else if (chunkId === "data") {
            dataOffset = chunkDataOffset;
            dataSize = chunkSize;
            break;
        }

        offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (dataOffset === -1) {
        throw new Error("Invalid WAV file: data chunk not found.");
    }

    if (sampleRate !== 16000 || channels !== 1 || bitsPerSample !== 16) {
        throw new Error(
            `Unsupported audio format: ${sampleRate}Hz, ${channels} ch, ${bitsPerSample}-bit (expected 16000Hz mono 16-bit PCM).`
        );
    }

    const availableDataSize = Math.min(dataSize, buffer.length - dataOffset);
    return buffer.subarray(dataOffset, dataOffset + availableDataSize);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (!options.file) {
        printUsage();
        console.error("Error: path to a .wav audio file is required.");
        process.exit(1);
    }

    const apiKey = process.env.MODEL_API_KEY;
    if (!apiKey) {
        console.error("Error: MODEL_API_KEY environment variable is not set.");
        process.exit(1);
    }

    const filePath = resolve(process.cwd(), options.file);
    if (!existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }

    const wavBuffer = readFileSync(filePath);
    const pcmData = extractPcmFromWav(wavBuffer);
    const durationSec = (pcmData.length / 32000).toFixed(2);

    console.log(
        `[audio] Loaded ${filePath} (${pcmData.length} bytes, ~${durationSec}s)`
    );
    console.log(
        `[config] Mode: ${options.mode}, Endpoint: ${options.endpoint}`
    );
    console.log(`[config] LanguageBias: ${options.languageBias.join(", ")}`);
    if (options.keywords.length > 0) {
        console.log(`[config] Keywords: ${options.keywords.join(", ")}`);
    }

    const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    if (typeof WebSocket === "undefined" || nodeMajor < 22) {
        console.error(
            "Error: global WebSocket is not available. Please run with Node.js >= 22."
        );
        process.exit(1);
    }

    const ws = new WebSocket(options.endpoint);

    let partialActive = false;
    ws.onopen = async () => {
        console.log("[ws] Connected to Meta ASR realtime endpoint.");

        // Handshake JSON carrying authentication and session configuration
        const handshake = {
            authorization: {
                accessToken: apiKey,
            },
            mode: options.mode,
            audioEncoding: "PCM_16KHZ",
            partialMode: "CUMULATIVE",
            languageBias: options.languageBias,
        };
        if (options.keywords.length > 0) {
            handshake.keywords = options.keywords;
        }

        ws.send(JSON.stringify(handshake));
        console.log("[ws] Handshake sent. Streaming audio frames...");

        // Stream audio at real-time pace: 100ms frames = 3,200 bytes per frame
        const FRAME_DURATION_MS = 100;
        const BYTES_PER_FRAME = 3200;

        let offset = 0;
        while (offset < pcmData.byteLength) {
            if (ws.readyState !== WebSocket.OPEN) break;

            const end = Math.min(offset + BYTES_PER_FRAME, pcmData.byteLength);
            const frame = pcmData.subarray(offset, end);
            ws.send(frame);
            offset = end;

            await new Promise((r) => setTimeout(r, FRAME_DURATION_MS));
        }

        if (ws.readyState === WebSocket.OPEN) {
            console.log(
                "\n[ws] Finished streaming audio. Sending endStream..."
            );
            ws.send(JSON.stringify({ type: "endStream" }));
        }
    };

    ws.onmessage = (event) => {
        try {
            const data =
                typeof event.data === "string"
                    ? event.data
                    : event.data.toString("utf8");
            const msg = JSON.parse(data);

            switch (msg.type) {
                case "session":
                    console.log(
                        `[session] Session started: ${msg.sessionId || "active"}`
                    );
                    break;
                case "speechStart":
                    if (partialActive) {
                        process.stdout.write("\n");
                        partialActive = false;
                    }
                    console.log(
                        `[speechStart] Detected speech at ${msg.startMs ?? 0}ms`
                    );
                    break;
                case "transcript":
                    if (msg.partial) {
                        partialActive = true;
                        process.stdout.write(
                            `\r\x1b[K[partial] ${msg.transcript}`
                        );
                    } else {
                        if (partialActive) {
                            process.stdout.write("\n");
                            partialActive = false;
                        }
                        console.log(`[transcript] ${msg.transcript}`);
                    }
                    break;
                case "speechComplete": {
                    if (partialActive) {
                        process.stdout.write("\n");
                        partialActive = false;
                    }
                    const speakerPart = msg.speaker
                        ? ` [Speaker ${msg.speaker}]`
                        : "";
                    const timePart = `(${msg.startMs ?? 0}ms - ${msg.endMs ?? 0}ms)`;
                    console.log(
                        `[turn]${speakerPart} ${timePart}: ${msg.transcript}`
                    );
                    break;
                }
                case "speaker":
                    console.log(`[speaker] Speaker detected: ${msg.speaker}`);
                    break;
                case "error":
                    if (partialActive) {
                        process.stdout.write("\n");
                        partialActive = false;
                    }
                    console.error(
                        `[error] ${msg.code || "unknown"}: ${msg.message || JSON.stringify(msg)}`
                    );
                    break;
                default:
                    if (msg.transcript && !msg.type) {
                        console.log(`[event] ${JSON.stringify(msg)}`);
                    }
                    break;
            }
        } catch {
            console.log(`[raw] ${event.data}`);
        }
    };

    ws.onerror = (err) => {
        if (partialActive) {
            process.stdout.write("\n");
            partialActive = false;
        }
        const message = err.message || err.error?.message || "WebSocket error";
        console.error(`[ws] Error: ${message}`);
    };
    ws.onclose = (event) => {
        if (partialActive) {
            process.stdout.write("\n");
            partialActive = false;
        }
        const description =
            CLOSE_MESSAGES[event.code] ||
            `Connection closed (${event.code}: ${event.reason || "no reason"})`;
        console.log(`[ws] ${description}`);
        if (event.code !== 1000) {
            process.exit(1);
        }
    };
}

main().catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
});
