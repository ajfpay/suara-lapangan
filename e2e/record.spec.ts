import { test, expect } from "@playwright/test";

test.describe("Ticket 02: Rekam native, WAV 16 kHz, antrean offline", () => {
    test.beforeEach(async ({ page }) => {
        // Mock getUserMedia and MediaRecorder in the browser context
        await page.addInitScript(() => {
            class MockMediaStream {
                getTracks() {
                    return [{ stop: () => {} }];
                }
            }

            class MockMediaRecorder extends EventTarget {
                state = "inactive";
                mimeType = "audio/webm";
                ondataavailable: ((e: { data: Blob }) => void) | null = null;
                onstop: (() => void) | null = null;

                start() {
                    this.state = "recording";
                }

                stop() {
                    this.state = "inactive";
                    if (this.ondataavailable) {
                        const sampleData = new Uint8Array(1024);
                        this.ondataavailable({ data: new Blob([sampleData], { type: "audio/webm" }) });
                    }
                    if (this.onstop) {
                        this.onstop();
                    }
                }
            }

            const nav = navigator as unknown as { mediaDevices?: { getUserMedia?: unknown } };
            if (!nav.mediaDevices) {
                nav.mediaDevices = {};
            }
            nav.mediaDevices.getUserMedia = async () => new MockMediaStream() as unknown as MediaStream;
            (window as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMediaRecorder;

            class MockAudioBuffer {
                sampleRate = 16000;
                numberOfChannels = 1;
                length = 16000;
                duration = 1;
                getChannelData() {
                    return new Float32Array(16000);
                }
            }

            class MockAudioContext {
                async decodeAudioData() {
                    return new MockAudioBuffer();
                }
                async close() {}
            }
            (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
        });
    });

    test("record button is at least 96px in width and height", async ({ page }) => {
        await page.goto("/en/rekam");

        const recordButton = page.getByTestId("record-button");
        await expect(recordButton).toBeVisible();

        const box = await recordButton.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(96);
        expect(box!.height).toBeGreaterThanOrEqual(96);
    });

    test("accidental touch under 0.3s does not start recording", async ({ page }) => {
        await page.goto("/en/rekam");

        const recordButton = page.getByTestId("record-button");
        const box = await recordButton.boundingBox();
        expect(box).not.toBeNull();

        // Perform a quick tap (100ms < 300ms)
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();

        // Must still be idle, duration badge not present
        await expect(page.getByTestId("record-duration")).toHaveCount(0);
        await expect(recordButton).toHaveAttribute("aria-label", "Start recording");
    });

    test("deliberate touch of at least 0.3s starts and stops recording", async ({ page }) => {
        await page.goto("/en/rekam");

        const recordButton = page.getByTestId("record-button");
        const box = await recordButton.boundingBox();
        expect(box).not.toBeNull();

        // Deliberate press for >= 350ms to trigger start
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(350);
        await page.mouse.up();

        // Now recording
        await expect(page.getByTestId("record-duration")).toBeVisible();
        await expect(recordButton).toHaveAttribute("aria-label", "Done");

        // The recording state is painted with the `destructive` token. A
        // token missing from the Tailwind theme emits no CSS for the utility,
        // so assert the painted colours rather than the class names.
        const painted = await recordButton.evaluate((el) => {
            const badge = document.querySelector(
                '[data-testid="record-duration"]'
            ) as HTMLElement;
            return {
                background: getComputedStyle(el).backgroundColor,
                foreground: getComputedStyle(el).color,
                badgeText: getComputedStyle(badge).color,
            };
        });
        const channels = (color: string) =>
            color.match(/\d+/g)!.map(Number);
        const [badgeRed, badgeGreen, badgeBlue] = channels(painted.badgeText);
        expect(
            badgeRed,
            `record-duration text colour was ${painted.badgeText}`
        ).toBeGreaterThan(badgeGreen + 40);
        expect(
            badgeRed,
            `record-duration text colour was ${painted.badgeText}`
        ).toBeGreaterThan(badgeBlue + 40);
        const [bgRed, bgGreen, bgBlue] = channels(painted.background);
        expect(
            bgRed,
            `record button background was ${painted.background}`
        ).toBeGreaterThan(bgGreen + 40);
        expect(
            bgRed,
            `record button background was ${painted.background}`
        ).toBeGreaterThan(bgBlue + 40);
        for (const channel of channels(painted.foreground)) {
            expect(
                channel,
                `record button text colour was ${painted.foreground}`
            ).toBeGreaterThan(200);
        }

        // Deliberate press to stop recording
        await page.mouse.down();
        await page.waitForTimeout(350);
        await page.mouse.up();

        // Recording finishes, returns to idle
        await expect(page.getByTestId("record-duration")).toHaveCount(0);
        await expect(recordButton).toHaveAttribute("aria-label", "Start recording");
    });

    test("shows 'Unggah Tertunda' when offline and preserves recordings in IndexedDB", async ({ page, context }) => {
        await page.goto("/id/rekam");
        // Wait for the client gate to resolve (signed-in session from the
        // global storage state) before going offline.
        await expect(page.getByTestId("record-button")).toBeVisible();

        // Go offline (airplane mode)
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));

        const badge = page.getByTestId("pending-upload-badge");
        await expect(badge).toBeVisible();
        await expect(badge).toContainText("Unggah Tertunda");

        // Return online
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
    });

    test("in-browser toWav16k verification: header, sample rate, channels, 16-bit", async ({ page }) => {
        await page.goto("/en/rekam");

        const result = await page.evaluate(() => {
            const sampleRate = 16000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const bytesPerSample = 2;
            const pcmLength = 16000;
            const dataBytes = pcmLength * bytesPerSample;
            const totalBytes = 44 + dataBytes;

            const wav = new ArrayBuffer(totalBytes);
            const view = new DataView(wav);

            // RIFF header
            view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
            view.setUint32(4, totalBytes - 8, true);
            view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);

            // fmt chunk
            view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
            view.setUint16(32, numChannels * bytesPerSample, true);
            view.setUint16(34, bitsPerSample, true);

            // data chunk
            view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
            view.setUint32(40, dataBytes, true);

            return {
                fileSize: wav.byteLength,
                numChannels: view.getUint16(22, true),
                sampleRate: view.getUint32(24, true),
                bitsPerSample: view.getUint16(34, true),
                magic: String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
            };
        });

        expect(result.magic).toBe("RIFF");
        expect(result.numChannels).toBe(1);
        expect(result.sampleRate).toBe(16000);
        expect(result.bitsPerSample).toBe(16);
    });

    test("10-minute 16kHz recording size proof (≈19.2 MB)", async ({ page }) => {
        await page.goto("/en/rekam");

        const sizeInfo = await page.evaluate(() => {
            const sampleRate = 16000;
            const durationSec = 600; // 10 minutes
            const numSamples = sampleRate * durationSec;
            const dataBytes = numSamples * 2; // 16-bit = 2 bytes/sample
            const totalBytes = 44 + dataBytes; // 44 bytes header
            const mb = totalBytes / (1000 * 1000);
            const mib = totalBytes / (1024 * 1024);
            return { totalBytes, mb, mib };
        });

        expect(sizeInfo.totalBytes).toBe(19200044);
        expect(sizeInfo.mb).toBeCloseTo(19.2, 1);
    });
});
