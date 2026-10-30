import { AsrError, httpStatusFor, userMessage } from "@/lib/server/asr/errors";
import { DEFAULT_ASR_LOCALE } from "@/lib/server/asr/locale";
import { getTurnsStore } from "@/lib/server/db/store";

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

type RouteContext = {
    params: Promise<{ sessionId: string }>;
};

export async function GET(
    _request: Request,
    context: RouteContext
): Promise<Response> {
    try {
        const params = await context.params;
        const sessionId = params?.sessionId ?? "";

        if (!SESSION_ID.test(sessionId)) {
            return Response.json(
                {
                    error: {
                        code: "invalid_request",
                        message: "sessionId is missing or malformed",
                    },
                },
                { status: 400 }
            );
        }

        const store = getTurnsStore();
        const session = await store.findSession(sessionId);

        if (!session) {
            return Response.json(
                {
                    error: {
                        code: "not_found",
                        message: "Session not found",
                    },
                },
                { status: 404 }
            );
        }

        // Ordered ascending startMs per contract
        const turns = [...session.turns].sort((a, b) => a.startMs - b.startMs);

        return Response.json(
            {
                sessionId: session.sessionId,
                locale: session.locale,
                turns,
            },
            { status: 200 }
        );
    } catch (error) {
        const failure =
            error instanceof AsrError
                ? error
                : new AsrError("internal_error", { cause: error });

        return Response.json(
            {
                error: {
                    code: failure.code,
                    message: userMessage(failure.code, DEFAULT_ASR_LOCALE),
                },
            },
            { status: httpStatusFor(failure.code) }
        );
    }
}
