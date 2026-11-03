// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

let mockSession: { data: unknown; isPending: boolean } = {
  data: { user: { id: "u1" } },
  isPending: true,
};
const stopRecording = vi.fn();
let mockRecorderState = { isRecording: false, isProcessing: false };

vi.mock("@/lib/auth-client", () => ({
  useSession: () => mockSession,
}));
vi.mock("@/lib/client/use-recorder", () => ({
  useRecorder: () => ({
    isRecording: mockRecorderState.isRecording,
    isProcessing: mockRecorderState.isProcessing,
    duration: 0,
    error: null,
    isOnline: true,
    pendingCount: 0,
    handlePointerDown: vi.fn(),
    handlePointerUp: vi.fn(),
    handlePointerCancel: vi.fn(),
    mode: "ENDPOINTING",
    setMode: vi.fn(),
    stopRecording,
  }),
}));

import { RecorderControl } from "@/app/[locale]/(suara)/rekam/RecorderControl";

const copy = {
  primary: "Start",
  recording: "Recording",
  stop: "Stop",
  processing: "Processing {seconds}",
  uploadPending: "Pending",
  holdHint: "Hold",
  recordingHint: "Recording…",
  modeLabel: "Mode",
  modeEndpointing: "Endpointing",
  modeDiarization: "Diarization",
};

describe("RecorderControl auth race", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockRecorderState = { isRecording: false, isProcessing: false };
    mockSession = { data: { user: { id: "u1" } }, isPending: true };
  });

  it("record button is disabled while session is pending", () => {
    mockSession = { data: null, isPending: true };
    render(<RecorderControl copy={copy} />);
    expect((screen.getByTestId("record-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("pending->null transition while recording stops recorder, never shows logged-out notice while running", async () => {
    mockSession = { data: { user: { id: "u1" } }, isPending: false };
    mockRecorderState = { isRecording: true, isProcessing: false };
    const { rerender } = render(<RecorderControl copy={copy} />);
    expect(screen.queryByTestId("login-required-notice")).toBeNull();

    // Session resolves to null while own recorder still running.
    mockSession = { data: null, isPending: false };
    rerender(<RecorderControl copy={copy} />);

    await waitFor(() => expect(stopRecording).toHaveBeenCalled());
    // stopRecording stops all MediaStream tracks and releases the stream
    // (see useRecorder.stopRecording + __tests__/lib/client/use-recorder.test.ts).
    // While our recorder reports running, no logged-out notice may appear.
    expect(screen.queryByTestId("login-required-notice")).toBeNull();
  });

  it("shows logged-out notice once recorder has stopped", () => {
    mockSession = { data: null, isPending: false };
    mockRecorderState = { isRecording: false, isProcessing: false };
    render(<RecorderControl copy={copy} />);
    expect(screen.getByTestId("login-required-notice")).toBeTruthy();
    expect(screen.queryByTestId("record-button")).toBeNull();
  });
});
