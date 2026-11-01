// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import id from "@/i18n/locales/id.json";

import { TurnReview } from "./TurnReview";
import { TurnCard } from "./TurnCard";
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/client/audioslice/storage", () => ({
    getLatestLocalRecordingSessionId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/client/audioslice/player", () => ({
    useAudioSlicePlayer: () => ({
        isPlaying: false,
        activeTurnId: null,
        audioUnavailableTurnId: null,
        error: null,
        playTurnSlice: vi.fn(),
        clearUnavailableNotice: vi.fn(),
        clearError: vi.fn(),
    }),
}));

type StepCopy = {
    title: string;
    body: string;
    workItemsTitle?: string;
    workItemsEmpty?: string;
    workItemsEmptyBody?: string;
    manualSessionIdLabel?: string;
    manualSessionIdPlaceholder?: string;
};

/**
 * The copy the susun page hands to <TurnReview />, read from the locale files
 * themselves so a regression in i18n/locales/*.json fails this test.
 */
function copyFrom(messages: { susun: StepCopy }): StepCopy {
    const step = messages.susun;
    return {
        title: step.title,
        body: step.body,
        workItemsTitle: step.workItemsTitle,
        workItemsEmpty: step.workItemsEmpty,
        workItemsEmptyBody: step.workItemsEmptyBody,
        manualSessionIdLabel: step.manualSessionIdLabel,
        manualSessionIdPlaceholder: step.manualSessionIdPlaceholder,
    };
}

describe("TurnReview", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    // vitest runs with globals: false here, so @testing-library/react cannot
    // register its own afterEach cleanup; unmount explicitly or every render
    // in this file stays in the document.
    afterEach(() => {
        cleanup();
    });

    it("renders the Indonesian label from id.json with no English fallback", async () => {
        const { container } = render(
            <TurnReview locale="id" copy={copyFrom(id)} />
        );

        expect(
            await screen.findByText(id.susun.manualSessionIdLabel)
        ).toBeDefined();
        await waitFor(() => {
            expect(screen.queryByText(/Session ID/i)).toBeNull();
            expect(
                screen.queryByText(en.susun.manualSessionIdLabel)
            ).toBeNull();
            expect(container.textContent).not.toContain("Session ID");
            expect(container.textContent).not.toContain(
                en.susun.manualSessionIdLabel
            );
        });
    });

    it("falls back to Indonesian copy when the label prop is omitted", async () => {
        render(
            <TurnReview
                locale="id"
                copy={{ title: id.susun.title, body: id.susun.body }}
            />
        );

        await waitFor(() => {
            expect(screen.queryByText(/Session ID/i)).toBeNull();
        });
        expect(
            await screen.findByText("Atau masukkan ID sesi secara manual:")
        ).toBeDefined();
    });

    it("renders the English label from en.json", async () => {
        render(<TurnReview locale="en" copy={copyFrom(en)} />);

        expect(
            await screen.findByText(en.susun.manualSessionIdLabel)
        ).toBeDefined();
    });

    it("renders speaker badge when turn.speaker is present", () => {
        render(
            <TurnCard
                index={1}
                locale="id"
                isPlaying={false}
                onPlay={() => {}}
                isUnavailable={false}
                onDismissUnavailable={() => {}}
                turn={{
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 1000,
                    transcript: "halo mandor",
                    speaker: "A",
                }}
            />
        );

        const badge = screen.getByTestId("speaker-badge-1");
        expect(badge.textContent).toContain("Pembicara A");
    });
});
