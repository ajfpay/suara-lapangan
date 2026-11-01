import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsrError } from "./errors";
import { logAsrFailure, redactSecrets } from "./log";

const SECRET_KEY = "SUPER_SECRET_MODEL_API_KEY_99999";

describe("log redaction & secrets scrubbing", () => {
    let originalApiKey: string | undefined;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let capturedLogs: string[] = [];

    beforeEach(() => {
        originalApiKey = process.env.MODEL_API_KEY;
        process.env.MODEL_API_KEY = SECRET_KEY;

        capturedLogs = [];
        consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation((...args) => {
                capturedLogs.push(args.map(String).join(" "));
            });
        consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation((...args) => {
                capturedLogs.push(args.map(String).join(" "));
            });
    });

    afterEach(() => {
        if (originalApiKey !== undefined) {
            process.env.MODEL_API_KEY = originalApiKey;
        } else {
            delete process.env.MODEL_API_KEY;
        }
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    it("redacts MODEL_API_KEY from arbitrary strings and JSON", () => {
        const raw = `Connecting to Meta with key ${SECRET_KEY} now`;
        const result = redactSecrets(raw);

        expect(result).not.toContain(SECRET_KEY);
        expect(result).toBe("Connecting to Meta with key [redacted] now");
    });

    it("redacts SMTP_PASS from arbitrary log strings", () => {
        const originalPass = process.env.SMTP_PASS;
        const secretPass = "super_secret_smtp_password_xyz";
        try {
            process.env.SMTP_PASS = secretPass;
            const line = `SMTP connection failed with password ${secretPass} on port 587`;
            const result = redactSecrets(line);
            expect(result).not.toContain(secretPass);
            expect(result).toBe("SMTP connection failed with password [redacted] on port 587");
        } finally {
            if (originalPass !== undefined) {
                process.env.SMTP_PASS = originalPass;
            } else {
                delete process.env.SMTP_PASS;
            }
        }
    });

    it("redacts Bearer tokens from authorization strings", () => {
        const raw = "Headers: Authorization: Bearer some-other-random-token-xyz123";
        const result = redactSecrets(raw);

        expect(result).not.toContain("some-other-random-token-xyz123");
        expect(result).toContain("Bearer [redacted]");
    });

    it("redacts credentials from error stack traces / tracebacks", () => {
        const fakeStack = `Error: Request failed with key ${SECRET_KEY}
    at transcribeWithMeta (lib/server/asr/meta.ts:74:13)
    at async transcribeSession (lib/server/asr/transcribe.ts:43:18)
    at async POST (app/api/asr/transcribe/route.ts:83:23)`;

        const result = redactSecrets(fakeStack);

        expect(result).not.toContain(SECRET_KEY);
        expect(result).toContain("[redacted]");
        expect(result).toContain("at transcribeWithMeta");
    });

    it("logAsrFailure never leaks MODEL_API_KEY even when present in detail, metaBody, and traceback", () => {
        const causeError = new Error(`Connection refused to Meta with ${SECRET_KEY}`);
        causeError.stack = `Error: Connection refused with ${SECRET_KEY}\n    at fetch (mock.ts:1:1)`;

        const asrError = new AsrError("upstream_failure", {
            detail: `Failed sending credential ${SECRET_KEY}`,
            metaStatus: 401,
            metaBody: `{"error":"unauthorized key ${SECRET_KEY}"}`,
            cause: causeError,
        });

        logAsrFailure(asrError, { sessionId: "sess-test-log-1" });

        const output = capturedLogs.join("\n");

        // The searchable string check
        expect(output).not.toContain(SECRET_KEY);
        expect(output).toContain("[redacted]");
        expect(output).toContain("sess-test-log-1");
        expect(output).toContain("upstream_failure");
    });

    it("proves MODEL_API_KEY never appears in logs after a full session flow", async () => {
        // Simulate a full session with multiple phases and potential failures
        const sessionId = "sess-full-session-audit";

        // Phase 1: Upstream 401 with raw key in Meta error body
        const err401 = new AsrError("upstream_auth", {
            detail: `Authorization failed with ${SECRET_KEY}`,
            metaStatus: 401,
            metaBody: `{"error":"invalid bearer token: ${SECRET_KEY}"}`,
        });
        logAsrFailure(err401, { sessionId });

        // Phase 2: Upstream 500 with stack trace
        const fakeInternalErr = new Error(`Upstream timeout while using ${SECRET_KEY}`);
        fakeInternalErr.stack = `Error: timeout\n    at meta.ts:44 (key: ${SECRET_KEY})`;
        const err500 = new AsrError("upstream_failure", {
            cause: fakeInternalErr,
            metaStatus: 500,
        });
        logAsrFailure(err500, { sessionId });

        // Phase 3: Uncaught exception
        const unhandled = new Error(`Fatal socket drop with Bearer ${SECRET_KEY}`);
        const wrappedUnhandled = new AsrError("internal_error", { cause: unhandled });
        logAsrFailure(wrappedUnhandled, { sessionId });

        // Phase 4: Searchable string check on entire accumulated log output
        const allLogOutput = capturedLogs.join("\n");

        expect(allLogOutput).not.toContain(SECRET_KEY);
        expect(allLogOutput).not.toMatch(new RegExp(SECRET_KEY));
        expect(allLogOutput.includes(SECRET_KEY)).toBe(false);

        // Confirm redaction marker is consistently present
        expect(allLogOutput).toContain("[redacted]");
        const redactionCount = (allLogOutput.match(/\[redacted\]/g) || []).length;
        expect(redactionCount).toBeGreaterThanOrEqual(4);
    });
});
