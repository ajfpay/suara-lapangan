# ASR fixtures (contract K5)

`sample-16k.wav` is the audio the tests and the browser E2E upload: 1.0 s of a
440 Hz tone, PCM s16le, mono, 16 kHz — the frozen K1 format, 32 044 bytes.

Regenerate it with:

```bash
node -e '
const fs = require("fs");
const rate = 16000, seconds = 1, samples = rate * seconds;
const data = Buffer.alloc(samples * 2);
for (let i = 0; i < samples; i++) {
  const v = Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate));
  data.writeInt16LE(v, i * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
fs.writeFileSync("lib/server/asr/__fixtures__/sample-16k.wav", Buffer.concat([header, data]));
'
```

`meta-transcribe.json` is the body `POST https://api.meta.ai/v1/asr/transcribe`
answers in `mode: ENDPOINTING`, copied field for field from the verified
`meta-model-cookbook/06_muse_voice` client (`turns[]` with `startMs`, `endMs`,
`transcript`, plus the top-level `sessionId`, `transcript` and
`audioDurationMs`). Its `audioDurationMs` matches `sample-16k.wav`. Tests and the
Playwright suite replay it instead of calling Meta, so no key and no network are
needed to prove the route.
