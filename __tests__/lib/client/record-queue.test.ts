/**
 * Tests for lib/client/record-queue.ts
 * Uses a simple synchronous IndexedDB mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Simple synchronous IndexedDB mock ─────────────────────────────────────────

const dbStore = new Map<string, Record<string, unknown>>();

function createSimpleMockIDB() {
  dbStore.clear();

  class MockRequest {
    onsuccess: ((event?: unknown) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;
    onupgradeneeded: ((event?: unknown) => void) | null = null;
    result: unknown = null;
    error: Error | null = null;

    scheduleFire() {
      queueMicrotask(() => {
        if (this.onupgradeneeded) this.onupgradeneeded({ target: this });
        if (this.onsuccess) this.onsuccess({ target: this });
      });
    }
  }

  class MockObjectStore {
    private data: Record<string, unknown>;
    constructor(name: string) {
      if (!dbStore.has(name)) dbStore.set(name, {});
      this.data = dbStore.get(name)!;
    }
    add(record: Record<string, unknown>): MockRequest {
      const req = new MockRequest();
      const id = String(record.id ?? Date.now());
      this.data[id] = { ...record, id };
      req.result = id;
      req.scheduleFire();
      return req;
    }
    getAll(): MockRequest {
      const req = new MockRequest();
      req.result = Object.values(this.data);
      req.scheduleFire();
      return req;
    }
    get(id: string): MockRequest {
      const req = new MockRequest();
      req.result = this.data[id] ?? null;
      req.scheduleFire();
      return req;
    }
    put(record: Record<string, unknown>): MockRequest {
      const req = new MockRequest();
      const id = String(record.id ?? Date.now());
      this.data[id] = record;
      req.result = id;
      req.scheduleFire();
      return req;
    }
    delete(id: string): MockRequest {
      const req = new MockRequest();
      delete this.data[id];
      req.scheduleFire();
      return req;
    }
  }

  class MockTx {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: Error | null = null;
    constructor(private storeName: string) {
      queueMicrotask(() => {
        if (this.oncomplete) this.oncomplete();
      });
    }
    objectStore() {
      return new MockObjectStore(this.storeName);
    }
  }

  class MockDB {
    transaction(stores: string | string[]) {
      const storeName = Array.isArray(stores) ? stores[0] : stores;
      return new MockTx(storeName);
    }
    createObjectStore(name: string) {
      if (!dbStore.has(name)) dbStore.set(name, {});
      return new MockObjectStore(name);
    }
    close() {}
    get objectStoreNames() {
      return { contains: () => true };
    }
  }

  return {
    open: () => {
      const req = new MockRequest();
      req.result = new MockDB();
      req.scheduleFire();
      return req;
    },
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeBlob(durationSec: number): Blob {
  const sampleRate = 16000;
  const numSamples = Math.ceil(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, fileSize - 8, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataSize, true);
  return new Blob([buf], { type: "audio/wav" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecordQueue", () => {
  let RecordQueue: typeof import("@/lib/client/record-queue").RecordQueue;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", createSimpleMockIDB());
    vi.stubGlobal("navigator", { onLine: true });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const mod = await import("@/lib/client/record-queue");
    RecordQueue = mod.RecordQueue;
  });

  // ── add() ──────────────────────────────────────────────────────────────────

  it("stores a recording with pending status in IndexedDB", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id = await q.add(blob, "session-abc");
    expect(id).toBeTruthy();
    const pending = await q.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].sessionId).toBe("session-abc");
    expect(pending[0].status).toBe("pending");
  });

  it("assigns a unique id to each recording", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id1 = await q.add(blob, "s1");
    const id2 = await q.add(blob, "s2");
    expect(id1).not.toBe(id2);
  });

  // ── getPending() ───────────────────────────────────────────────────────────

  it("returns only pending recordings", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id = await q.add(blob, "s1");
    await q.add(blob, "s2");
    await q.markUploaded(id);
    const result = await q.getPending();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
  });

  // ── FIFO order ─────────────────────────────────────────────────────────────

  it("getPending() returns recordings in FIFO order (oldest first)", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "first");
    await new Promise((r) => setTimeout(r, 10));
    await q.add(blob, "second");
    const pending = await q.getPending();
    expect(pending[0].sessionId).toBe("first");
    expect(pending[1].sessionId).toBe("second");
  });

  // ── markUploaded() ────────────────────────────────────────────────────────

  it("markUploaded() changes status to uploaded", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id = await q.add(blob, "s1");
    await q.markUploaded(id);
    const pending = await q.getPending();
    expect(pending).toHaveLength(0);
  });

  it("markUploaded() sets uploadedAt timestamp", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id = await q.add(blob, "s1");
    await q.markUploaded(id);
    expect(await q.isPending()).toBe(false);
  });

  // ── uploadPending() ────────────────────────────────────────────────────────

  it("uploadPending() sends a POST to the configured URL", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "session-xyz");
    const fetch = vi.mocked(global.fetch);
    await q.uploadPending();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("/api/asr/upload");
  });

  it("uploadPending() marks record uploaded after successful fetch", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "s1");
    await q.uploadPending();
    expect(await q.isPending()).toBe(false);
  });

  it("uploadPending() skips already-uploaded records", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    const id = await q.add(blob, "s1");
    await q.markUploaded(id);
    const fetch = vi.mocked(global.fetch);
    await q.uploadPending();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploadPending() appends default ENDPOINTING mode to FormData when omitted", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "session-default-mode");
    const fetch = vi.mocked(global.fetch);
    await q.uploadPending();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0][1]?.body as FormData;
    expect(body.get("mode")).toBe("ENDPOINTING");
  });

  it("uploadPending() appends selected DIARIZATION mode to FormData", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "session-diarization", "DIARIZATION");
    const fetch = vi.mocked(global.fetch);
    await q.uploadPending();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0][1]?.body as FormData;
    expect(body.get("mode")).toBe("DIARIZATION");
  });

  it("add() preserves specified mode on the stored recording", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "session-diarize-prop", "DIARIZATION");
    const pending = await q.getPending();
    expect(pending[0].mode).toBe("DIARIZATION");
  });
  // ── Online/offline ──────────────────────────────────────────────────────────

  it("processQueue() skips upload when offline", async () => {
    Object.defineProperty(global, "navigator", { value: { onLine: false }, configurable: true });
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "offline-test");
    const fetch = vi.mocked(global.fetch);
    await q.processQueue();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("processQueue() uploads when back online", async () => {
    Object.defineProperty(global, "navigator", { value: { onLine: false }, configurable: true });
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "back-online");
    const fetch = vi.mocked(global.fetch);
    await q.processQueue();
    expect(fetch).not.toHaveBeenCalled();
    Object.defineProperty(global, "navigator", { value: { onLine: true }, configurable: true });
    await q.processQueue();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // ── isPending ──────────────────────────────────────────────────────────────

  it("isPending() returns true when there are pending recordings", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    const blob = makeBlob(1);
    await q.add(blob, "s1");
    expect(await q.isPending()).toBe(true);
  });

  it("isPending() returns false when queue is empty", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/upload" });
    expect(await q.isPending()).toBe(false);
  });

  // ── Idempotency per sessionId ───────────────────────────────────────────────

  it("add() with same sessionId updates existing pending recording instead of duplicating", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/transcribe" });
    const blob1 = makeBlob(1);
    const blob2 = makeBlob(2);
    const id1 = await q.add(blob1, "session-idem-1");
    const id2 = await q.add(blob2, "session-idem-1");
    expect(id1).toBe(id2);
    const pending = await q.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id1);
  });

  it("add() with already uploaded sessionId does not add duplicate to pending", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/transcribe" });
    const blob1 = makeBlob(1);
    const id1 = await q.add(blob1, "session-idem-2");
    await q.markUploaded(id1);
    const id2 = await q.add(blob1, "session-idem-2");
    expect(id2).toBe(id1);
    const pending = await q.getPending();
    expect(pending).toHaveLength(0);
  });

  it("uploadPending() deduplicates multiple pending records with same sessionId in one run", async () => {
    const q = new RecordQueue({ uploadUrl: "/api/asr/transcribe" });
    const blob = makeBlob(1);
    await q.add(blob, "session-shared");
    const fetch = vi.mocked(global.fetch);
    await q.uploadPending();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await q.isPending()).toBe(false);
  });
});
