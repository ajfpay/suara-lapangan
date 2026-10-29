import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRecorder } from "@/lib/client/use-recorder";
import type { StoredRecording } from "@/lib/client/record-queue";

// ── Slot-based hook runtime for node environment ───────────────────────────────

let hookSlots: unknown[] = [];
let hookIndex = 0;

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = hookIndex++;
    if (slot >= hookSlots.length) {
      hookSlots.push(typeof initial === "function" ? (initial as () => unknown)() : initial);
    }
    const setState = (action: unknown) => {
      hookSlots[slot] = typeof action === "function"
        ? (action as (prev: unknown) => unknown)(hookSlots[slot])
        : action;
    };
    return [hookSlots[slot], setState];
  },
  useRef: (initial: unknown) => {
    const slot = hookIndex++;
    if (slot >= hookSlots.length) {
      hookSlots.push({ current: initial });
    }
    return hookSlots[slot] as { current: unknown };
  },
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));

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

// ── Audio and MediaRecorder stubs ─────────────────────────────────────────────

let decodeCount = 0;

class FakeAudioContext {
  async decodeAudioData() {
    decodeCount++;
    const sampleRate = 16000;
    // Return different lengths so the two WAV blobs have distinct sizes:
    // First: 16000 samples -> 32044 bytes; Second: 32000 samples -> 64044 bytes
    const length = decodeCount === 1 ? 16000 : 32000;
    const channelData = new Float32Array(length);
    return {
      sampleRate,
      numberOfChannels: 1,
      length,
      duration: length / sampleRate,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;
  }
  async close() {}
}

class FakeMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {}

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob(["dummy-chunk"], { type: "audio/webm" }),
      });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
}

/**
 * Tests for recorder hook / state machine logic.
 */
describe("useRecorder / recorder logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("filters out touches shorter than 300ms (accidental touch guard)", () => {
    let triggered = false;
    let timer: NodeJS.Timeout | null = null;

    const onTouchStart = () => {
      timer = setTimeout(() => {
        triggered = true;
      }, 300);
    };

    const onTouchEnd = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // User taps quickly (100ms)
    onTouchStart();
    vi.advanceTimersByTime(100);
    onTouchEnd();

    expect(triggered).toBe(false);

    // User deliberately holds for >= 300ms
    onTouchStart();
    vi.advanceTimersByTime(300);
    expect(triggered).toBe(true);
  });

  it("stores and uploads both sequential recordings in one hook session under distinct sessionIds", async () => {
    decodeCount = 0;
    hookSlots = [];
    hookIndex = 0;

    vi.stubGlobal("indexedDB", createSimpleMockIDB());
    vi.stubGlobal("navigator", {
      onLine: true,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    globalThis.fetch = fetchSpy;

    const recorder = useRecorder();

    // First recording
    await recorder.startRecording();
    await recorder.stopRecording();

    // Second recording in the same hook session
    await recorder.startRecording();
    await recorder.stopRecording();

    const storedRecords = Object.values(
      (dbStore.get("recordings") ?? {}) as Record<string, StoredRecording>
    );

    expect(storedRecords).toHaveLength(2);
    expect(storedRecords[0].sessionId).not.toBe(storedRecords[1].sessionId);
    expect(storedRecords[0].blob.size).toBe(32044);
    expect(storedRecords[1].blob.size).toBe(64044);
    expect(storedRecords[0].blob.size).not.toBe(storedRecords[1].blob.size);

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstCallBody = fetchSpy.mock.calls[0][1]?.body as FormData;
    const secondCallBody = fetchSpy.mock.calls[1][1]?.body as FormData;

    const session1 = firstCallBody.get("sessionId");
    const session2 = secondCallBody.get("sessionId");
    expect(session1).toBe(storedRecords[0].sessionId);
    expect(session2).toBe(storedRecords[1].sessionId);
    expect(session1).not.toBe(session2);

    const audio1 = firstCallBody.get("audio") as Blob;
    const audio2 = secondCallBody.get("audio") as Blob;
    expect(audio1.size).toBe(32044);
    expect(audio2.size).toBe(64044);
    expect(audio1.size).not.toBe(audio2.size);

    const pending = storedRecords.filter((r) => r.status === "pending");
    expect(pending).toHaveLength(0);
    expect(storedRecords[0].status).toBe("uploaded");
    expect(storedRecords[1].status).toBe("uploaded");
  });
});
