// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import en from "@/i18n/locales/en.json";
import id from "@/i18n/locales/id.json";
import { RecorderControl } from "@/app/[locale]/(suara)/rekam/RecorderControl";

describe("RecorderControl mode selector and accessibility", () => {
  const enCopy = {
    primary: en.rekam.primary,
    recording: en.rekam.recording,
    stop: en.rekam.stop,
    processing: en.rekam.processing,
    processingHint: en.rekam.processingHint,
    uploadPending: en.rekam.uploadPending,
    holdHint: en.rekam.holdHint,
    recordingHint: en.rekam.recordingHint,
    modeLabel: en.rekam.modeLabel,
    modeEndpointing: en.rekam.modeEndpointing,
    modeDiarization: en.rekam.modeDiarization,
  };

  const idCopy = {
    primary: id.rekam.primary,
    recording: id.rekam.recording,
    stop: id.rekam.stop,
    processing: id.rekam.processing,
    processingHint: id.rekam.processingHint,
    uploadPending: id.rekam.uploadPending,
    holdHint: id.rekam.holdHint,
    recordingHint: id.rekam.recordingHint,
    modeLabel: id.rekam.modeLabel,
    modeEndpointing: id.rekam.modeEndpointing,
    modeDiarization: id.rekam.modeDiarization,
  };

  afterEach(() => {
    cleanup();
  });

  it("renders with associated label and default ENDPOINTING mode in English", () => {
    render(<RecorderControl copy={enCopy} />);

    // Accessible label association
    const select = screen.getByLabelText(en.rekam.modeLabel) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.id).toBe("asr-mode-select");
    expect(select.value).toBe("ENDPOINTING");

    // Two options exist
    const options = Array.from(select.options);
    expect(options).toHaveLength(2);
    expect(options[0].value).toBe("ENDPOINTING");
    expect(options[0].textContent).toBe(en.rekam.modeEndpointing);
    expect(options[1].value).toBe("DIARIZATION");
    expect(options[1].textContent).toBe(en.rekam.modeDiarization);

    // Visible focus classes
    expect(select.className).toContain("focus:ring-2");
    expect(select.className).toContain("focus:ring-primary");
  });

  it("renders with Indonesian locale copy", () => {
    render(<RecorderControl copy={idCopy} />);

    const select = screen.getByLabelText(id.rekam.modeLabel) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("ENDPOINTING");

    const options = Array.from(select.options);
    expect(options[0].textContent).toBe(id.rekam.modeEndpointing);
    expect(options[1].textContent).toBe(id.rekam.modeDiarization);
  });

  it("allows changing mode to DIARIZATION", () => {
    render(<RecorderControl copy={enCopy} />);

    const select = screen.getByLabelText(en.rekam.modeLabel) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DIARIZATION" } });
    expect(select.value).toBe("DIARIZATION");
  });
});
