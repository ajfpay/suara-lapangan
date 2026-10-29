import { describe, expect, it } from "vitest";

import {
    getLatestLocalRecordingSessionId,
    getLocalRecordingBlob,
    hasLocalRecording,
    listLocalRecordings,
} from "./storage";

describe("lib/client/audioslice/storage", () => {
    it("handles missing indexedDB gracefully (SSR / unsupported environment)", async () => {
        // In node environment without window.indexedDB
        const blob = await getLocalRecordingBlob("sess-test-1");
        expect(blob).toBeNull();

        const exists = await hasLocalRecording("sess-test-1");
        expect(exists).toBe(false);

        const latest = await getLatestLocalRecordingSessionId();
        expect(latest).toBeNull();

        const list = await listLocalRecordings();
        expect(list).toEqual([]);
    });
});
