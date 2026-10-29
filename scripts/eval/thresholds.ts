export interface Gate1ThresholdMetrics {
    enWer: number;
    idWer: number;
    moneyVolumeWer?: number;
    isSynthetic?: boolean;
}

export type Gate1Status =
    | "GO"
    | "STOP_24_JAM"
    | "NEEDS_REVIEW"
    | "SYNTHETIC_SMOKE_PASS";

export interface Gate1Decision {
    status: Gate1Status;
    stop24Jam: boolean;
    escalateTo: "pemilik" | null;
    passed: boolean;
    isSynthetic?: boolean;
    reasons: string[];
    thresholds: {
        enTarget: number;
        idTarget: number;
        idStop: number;
        moneyVolumeTarget: number;
    };
}

export const GATE_1_THRESHOLDS = {
    EN_TARGET: 0.1, // <= 10%
    ID_TARGET: 0.15, // <= 15%
    ID_STOP: 0.25, // > 25% triggers STOP 24 jam
    MONEY_VOLUME_TARGET: 0.1, // <= 10%
};

/**
 * Evaluates Gate 1 thresholds according to docs/03-GATE-GO-NO-GO.md:
 * - EN WER <= 10%: Global native English target passed
 * - ID WER <= 15%: Accented Indonesian target passed
 * - ID WER > 25%: STOP 24 jam immediately and escalate to pemilik
 * - Money/volume WER <= 10%: Target for numerical and volume integrity
 */
export function evaluateGate1Thresholds(
    metrics: Gate1ThresholdMetrics
): Gate1Decision {
    const reasons: string[] = [];
    const thresholds = {
        enTarget: GATE_1_THRESHOLDS.EN_TARGET,
        idTarget: GATE_1_THRESHOLDS.ID_TARGET,
        idStop: GATE_1_THRESHOLDS.ID_STOP,
        moneyVolumeTarget: GATE_1_THRESHOLDS.MONEY_VOLUME_TARGET,
    };

    // Hard stop rule: ID WER > 25%
    if (metrics.idWer > GATE_1_THRESHOLDS.ID_STOP) {
        const idPct = (metrics.idWer * 100).toFixed(2);
        reasons.push(
            `Indonesian WER (${idPct}%) exceeds the 25.0% hard-stop threshold. ` +
                `Marking STOP 24 jam and escalating to pemilik for segment/route pivot decision.`
        );
        return {
            status: "STOP_24_JAM",
            stop24Jam: true,
            escalateTo: "pemilik",
            passed: false,
            reasons,
            thresholds,
        };
    }

    const enPassed = metrics.enWer <= GATE_1_THRESHOLDS.EN_TARGET;
    const idPassed = metrics.idWer <= GATE_1_THRESHOLDS.ID_TARGET;
    const mvPassed =
        typeof metrics.moneyVolumeWer === "number"
            ? metrics.moneyVolumeWer <= GATE_1_THRESHOLDS.MONEY_VOLUME_TARGET
            : true;

    if (enPassed && idPassed && mvPassed) {
        if (metrics.isSynthetic) {
            reasons.push(
                `Pipeline smoke test PASSED: Both EN (WER ${(metrics.enWer * 100).toFixed(2)}% <= 10%) ` +
                    `and ID (WER ${(metrics.idWer * 100).toFixed(2)}% <= 15%) meet numerical thresholds under synthetic mock perturbations.`
            );
            if (typeof metrics.moneyVolumeWer === "number") {
                reasons.push(
                    `Money/volume WER (${(metrics.moneyVolumeWer * 100).toFixed(2)}%) meets <= 10% threshold.`
                );
            }
            reasons.push(
                `Gate 1 ASR Accuracy NOT CERTIFIED: Evaluated hypotheses are synthetic mocks derived from reference transcripts (circular oracle). WER measures authored perturbation, NOT Meta ASR accuracy. Gate 1 GO on ASR accuracy cannot be granted without real ASR hypotheses.`
            );
            return {
                status: "SYNTHETIC_SMOKE_PASS",
                stop24Jam: false,
                escalateTo: null,
                passed: false,
                isSynthetic: true,
                reasons,
                thresholds,
            };
        }

        reasons.push(
            `Gate 1 GO: Both EN (WER ${(metrics.enWer * 100).toFixed(2)}% <= 10%) ` +
                `and ID (WER ${(metrics.idWer * 100).toFixed(2)}% <= 15%) meet Gate 1 quality thresholds on real ASR hypotheses.`
        );
        if (typeof metrics.moneyVolumeWer === "number") {
            reasons.push(
                `Money/volume WER (${(metrics.moneyVolumeWer * 100).toFixed(2)}%) meets <= 10% threshold.`
            );
        }
        return {
            status: "GO",
            stop24Jam: false,
            escalateTo: null,
            passed: true,
            isSynthetic: false,
            reasons,
            thresholds,
        };
    }

    if (!enPassed) {
        reasons.push(
            `EN WER (${(metrics.enWer * 100).toFixed(2)}%) exceeds target threshold of 10.0%.`
        );
    }
    if (!idPassed) {
        reasons.push(
            `ID WER (${(metrics.idWer * 100).toFixed(2)}%) exceeds target threshold of 15.0%.`
        );
    }
    if (!mvPassed && typeof metrics.moneyVolumeWer === "number") {
        reasons.push(
            `Money/volume WER (${(metrics.moneyVolumeWer * 100).toFixed(2)}%) exceeds target threshold of 10.0%.`
        );
    }

    return {
        status: "NEEDS_REVIEW",
        stop24Jam: false,
        escalateTo: "pemilik",
        passed: false,
        reasons,
        thresholds,
    };
}
