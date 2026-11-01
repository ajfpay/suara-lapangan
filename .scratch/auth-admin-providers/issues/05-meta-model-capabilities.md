# 05: Meta Model API capabilities — streaming, tools, search grounding, files, images, video, SAM

**What to build:** extend the model client with streaming, tool calling and tool search, search grounding, file uploads, image understanding, image generation with Muse Image, video understanding, and media segmentation with SAM 3.1. Provide minimal demo routes or a small panel so each capability is reachable and verifiable; keep them additive and not on the critical quotation path.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Streaming returns incremental deltas and a final usage chunk
- [ ] Tool calling detects tool_calls and runs the execute → feed-back loop
- [ ] Tool search is supported
- [ ] Search grounding maps url_citation annotations to footnotes
- [ ] File upload helper works and is reusable
- [ ] Image understanding accepts URL and base64 inputs
- [ ] Image generation with Muse Image produces an image
- [ ] Video understanding accepts video input
- [ ] SAM 3.1 segmentation returns masks for a given image
- [ ] Each capability has at least one test or a documented manual check
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green
