import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRecorder } from "@/lib/client/use-recorder";
import { resetRecordQueue, type StoredRecording } from "@/lib/client/record-queue";

// ── Slot-based hook runtime for node environment ───────────────────────────────

let hookSlots: unknown[] = [];
let hookIndex = 0;
let capturedEffect: (() => () => void) | null = null;

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
  useEffect: (fn: () => () => void) => {
    capturedEffect = fn;
  },
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

  constructor() {
    (globalThis as { __lastRecorder?: unknown }).__lastRecorder = this;
  }

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
    resetRecordQueue();
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
    expect(firstCallBody.get("mode")).toBe("ENDPOINTING");
    expect(secondCallBody.get("mode")).toBe("ENDPOINTING");
    const audio1 = firstCallBody.get("audio") as Blob;
    const audio2 = secondCallBody.get("audio") as Blob;
    expect(audio1.size).toBe(32044);
    expect(audio2.size).toBe(64044);
    expect(audio1.size).not.toBe(audio2.size);

    const pending = storedRecords.filter((r) => r.status === "pending");
    expect(pending).toHaveLength(0);
    expect(storedRecords[0].status).toBe("uploaded");
    expect(storedRecords[1].status).toBe("uploaded");
    expect(storedRecords[0].mode).toBe("ENDPOINTING");
    expect(storedRecords[1].mode).toBe("ENDPOINTING");
  });

  it("defaults mode to ENDPOINTING", () => {
    hookSlots = [];
    hookIndex = 0;
    const recorder = useRecorder();
    expect(recorder.mode).toBe("ENDPOINTING");
  });

  it("threads chosen DIARIZATION mode through useRecorder into queue and upload body", async () => {
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
    expect(recorder.mode).toBe("ENDPOINTING");

    recorder.setMode("DIARIZATION");
    expect(recorder.mode).toBe("DIARIZATION");

    await recorder.startRecording();
    await recorder.stopRecording();

    const storedRecords = Object.values(
      (dbStore.get("recordings") ?? {}) as Record<string, StoredRecording>
    );

    expect(storedRecords).toHaveLength(1);
    expect(storedRecords[0].mode).toBe("DIARIZATION");
    expect(storedRecords[0].status).toBe("uploaded");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callBody = fetchSpy.mock.calls[0][1]?.body as FormData;
    expect(callBody.get("mode")).toBe("DIARIZATION");
  });

  it("updates mode between recordings so subsequent uploads reflect the new mode", async () => {
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

    // First recording with default ENDPOINTING
    await recorder.startRecording();
    await recorder.stopRecording();

    // Switch mode to DIARIZATION
    recorder.setMode("DIARIZATION");
    expect(recorder.mode).toBe("DIARIZATION");

    // Second recording with DIARIZATION
    await recorder.startRecording();
    await recorder.stopRecording();

    const storedRecords = Object.values(
      (dbStore.get("recordings") ?? {}) as Record<string, StoredRecording>
    );
    expect(storedRecords).toHaveLength(2);
    expect(storedRecords[0].mode).toBe("ENDPOINTING");
    expect(storedRecords[1].mode).toBe("DIARIZATION");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = fetchSpy.mock.calls[0][1]?.body as FormData;
    const secondBody = fetchSpy.mock.calls[1][1]?.body as FormData;
    expect(firstBody.get("mode")).toBe("ENDPOINTING");
    expect(secondBody.get("mode")).toBe("DIARIZATION");
  });

  it("re-entry guard: second startRecording while active does not call getUserMedia twice", async () => {
    hookSlots = [];
    hookIndex = 0;
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    vi.stubGlobal("navigator", { onLine: true, mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const recorder = useRecorder();
    await recorder.startRecording();
    await recorder.startRecording();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await recorder.stopRecording();
  });

  it("unmount cleanup nulls onstop and ondataavailable so a forced stop cannot fire into an unmounted hook", async () => {
    hookSlots = [];
    hookIndex = 0;
    capturedEffect = null;
    (globalThis as { __lastRecorder?: unknown }).__lastRecorder = undefined;

    const trackStop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: trackStop }],
    });
    vi.stubGlobal("indexedDB", createSimpleMockIDB());
    vi.stubGlobal("navigator", {
      onLine: true,
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const recorder = useRecorder();
    await recorder.startRecording();

    const rec = (globalThis as { __lastRecorder?: FakeMediaRecorder }).__lastRecorder;
    if (!rec) throw new Error("expected a MediaRecorder to be created");
    expect(rec.ondataavailable).not.toBeNull();
    // onstop attaches in stopRecording; simulate an in-flight recording.
    rec.onstop = () => {};
    expect(rec.onstop).not.toBeNull();

    // Simulate unmount: run the effect's cleanup.
    const effect = capturedEffect as (() => unknown) | null;
    const cleanup = effect?.() as (() => void) | void;
    expect(cleanup).toBeTypeOf("function");
    (cleanup as (() => void) | undefined)?.();

    expect(rec.onstop).toBeNull();
    expect(rec.ondataavailable).toBeNull();
    // Tracks are released on unmount so the microphone is never left live.
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
});
