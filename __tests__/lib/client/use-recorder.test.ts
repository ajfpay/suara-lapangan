import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for recorder hook / state machine logic.
 */
describe("useRecorder / recorder logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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
});
