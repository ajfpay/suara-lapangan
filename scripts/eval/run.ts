/**
 * TypeScript entrypoint for Suara Lapangan MVP Gate 1 WER Evaluation.
 */

import { runEval } from "./eval";

export async function run(): Promise<void> {
    const summary = await runEval();
    console.log(
        `Evaluation finished: ${summary.totalRecordings} recordings, Gate 1 status = ${summary.gate1.status}`
    );
}

export { runEval };
