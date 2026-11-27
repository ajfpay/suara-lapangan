import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";
import crypto from "node:crypto";
import { getEmailConfig } from "@/lib/server/email/config";
import { sendEmail } from "@/lib/server/email/send";
import { createResetRequestLimiter } from "@/lib/server/reset-request-limiter";
import { redactSecrets } from "@/lib/server/asr/log";

const authConnectionString =
    process.env.DATABASE_URL ||
    process.env.ASR_TEST_DATABASE_URL ||
    "postgres://suara:suara@localhost:5432/suara_test";

function getAuthDbPool(): Pool {
    const pool = new Pool({ connectionString: authConnectionString });
    pool.on("error", (err) => {
        console.error(redactSecrets(`[auth] pool error: ${String(err)}`));
    });
    return pool;
}

const pool = getAuthDbPool();

const DEV_FALLBACK_SECRET =
    "suara-lapangan-secret-key-development-minimum-32-chars";

export function resolveAuthSecret(): string {
    const env = process.env.BETTER_AUTH_SECRET;
    if (env) return env;
    if (process.env.NODE_ENV === "production") {
        console.error(
            "[auth] BETTER_AUTH_SECRET is not set in production; " +
                "generating a random per-boot secret. Set BETTER_AUTH_SECRET " +
                "for stable sessions."
        );
        return crypto.randomBytes(32).toString("hex");
    }
    return DEV_FALLBACK_SECRET;
}

export const AUTH_SECRET = resolveAuthSecret();
export const resolvedAuthSecret = AUTH_SECRET;
export const authSecret = AUTH_SECRET;

/**
 * Origins allowed to send credentialed POSTs. Origins come from
 * `TRUSTED_ORIGINS` (comma-separated), better-auth also reads
 * `BETTER_AUTH_URL`, and the Playwright harness sets `TRUSTED_ORIGINS`
 * itself; `npm run dev` does not, so developers must export it by hand.
 * Without a matching origin better-auth rejects credentialed POSTs with 403.
 */
const envTrustedOrigins = (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const nativeOrigins = (process.env.NATIVE_AUTH_ORIGINS ?? "suara-lapangan://")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) =>
        /^suara-lapangan(?:-development|-staging)?:\/\/$/.test(origin)
    );

const nativePlugin = expo();
const allowResetRequest = createResetRequestLimiter(AUTH_SECRET);

function checkResetIdentity(email: string): void {
    if (!allowResetRequest(email)) {
        throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many requests. Try again later.",
        });
    }
}

async function sendAuthMail(
    to: string,
    subject: string,
    text: string
): Promise<void> {
    const config = getEmailConfig();
    if (!config) {
        console.warn("[auth] mail transport not configured");
        return;
    }
    try {
        await sendEmail(config, { to, subject, text, attachments: [] });
    } catch {
        console.error("[auth] mail delivery failed");
    }
}

export const auth = betterAuth({
    database: pool,
    secret: AUTH_SECRET,
    trustedOrigins: [
        ...envTrustedOrigins.filter((origin) => {
            try {
                const url = new URL(origin);
                return (
                    (url.protocol === "https:" || url.protocol === "http:") &&
                    origin === url.origin &&
                    !origin.includes("*")
                );
            } catch {
                return false;
            }
        }),
        ...nativeOrigins,
    ],
    logger: {
        level: "warn",
        log: (level) => console.warn("[auth] Better Auth " + level),
    },
    rateLimit: {
        enabled: true,
        customRules: {
            "/request-password-reset": { window: 900, max: 5 },
            "/reset-password": { window: 60, max: 10 },
        },
    },
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (
                ctx.path === "/request-password-reset" &&
                typeof ctx.body?.email === "string"
            ) {
                checkResetIdentity(ctx.body.email);
            }
        }),
    },
    user: {
        modelName: "auth_user",
        fields: {
            emailVerified: "email_verified",
            createdAt: "created_at",
            updatedAt: "updated_at",
        },
    },
    session: {
        modelName: "auth_session",
        fields: {
            expiresAt: "expires_at",
            createdAt: "created_at",
            updatedAt: "updated_at",
            ipAddress: "ip_address",
            userAgent: "user_agent",
            userId: "user_id",
        },
    },
    account: {
        modelName: "auth_account",
        fields: {
            accountId: "account_id",
            providerId: "provider_id",
            userId: "user_id",
            accessToken: "access_token",
            refreshToken: "refresh_token",
            idToken: "id_token",
            accessTokenExpiresAt: "access_token_expires_at",
            refreshTokenExpiresAt: "refresh_token_expires_at",
            idTokenExpiresAt: "id_token_expires_at",
            createdAt: "created_at",
            updatedAt: "updated_at",
        },
    },
    verification: {
        modelName: "auth_verification",
        storeIdentifier: {
            default: "plain",
            overrides: { "reset-password:": "hashed" },
        },
        fields: {
            expiresAt: "expires_at",
            createdAt: "created_at",
            updatedAt: "updated_at",
        },
    },
    plugins: [
        { ...nativePlugin, init: () => ({ options: { trustedOrigins: [] } }) },
        admin({
            schema: {
                user: {
                    fields: {
                        banReason: "ban_reason",
                        banExpires: "ban_expires",
                    },
                },
                session: {
                    fields: {
                        impersonatedBy: "impersonated_by",
                    },
                },
            },
        }),
    ],
    advanced: {
        disableOriginCheck: false,
        disableCSRFCheck: false,
        database: {
            generateId: () => crypto.randomUUID(),
        },
    },
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        resetPasswordTokenExpiresIn: 30 * 60,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url, token }) => {
            const identifier = crypto
                .createHash("sha256")
                .update("reset-password:" + token)
                .digest("base64url");
            const credential = await pool.query(
                "select 1 from auth_account where user_id=$1 and provider_id='credential' and password is not null limit 1",
                [user.id]
            );
            if (!credential.rowCount) {
                await pool.query(
                    "delete from auth_verification where identifier=$1",
                    [identifier]
                );
                return;
            }
            const generated = new URL(url);
            const callback = generated.searchParams.get("callbackURL") ?? "";
            const locale = /(?:^|\/)en\/reset-password(?:$|[?#])/.test(callback)
                ? "en"
                : "id";
            const web = new URL(
                "/" + locale + "/reset-password",
                generated.origin
            );
            web.hash = new URLSearchParams({ token }).toString();
            const subject =
                locale === "en"
                    ? "Reset your Suara Lapangan password"
                    : "Atur ulang kata sandi Suara Lapangan";
            const text =
                locale === "en"
                    ? "Use this link within 30 minutes to reset your password:\n" +
                      web.href
                    : "Gunakan tautan berikut dalam 30 menit untuk mengatur ulang kata sandi:\n" +
                      web.href;
            await sendAuthMail(user.email, subject, text);
        },
    },
    emailVerification: {
        sendVerificationEmail: async ({ user, url }) => {
            await sendAuthMail(
                user.email,
                "Verifikasi Email — Suara Lapangan",
                "Halo " +
                    user.name +
                    ",\n\nSilakan verifikasi akun Anda:\n" +
                    url
            );
        },
    },
    socialProviders: {
        ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? {
                  google: {
                      clientId: process.env.GOOGLE_CLIENT_ID,
                      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                  },
              }
            : {}),
    },
});

let resetLockPool: Pool | undefined;

export async function handleAuthRequest(request: Request): Promise<Response> {
    if (
        request.method !== "POST" ||
        new URL(request.url).pathname.replace(/\/+$/, "") !==
            "/api/auth/reset-password"
    ) {
        return auth.handler(request);
    }
    const invalid = () =>
        Response.json(
            { code: "INVALID_TOKEN", message: "Invalid or expired token" },
            { status: 400 }
        );
    let token: unknown;
    try {
        const body = await request.clone().json();
        token = body?.token;
    } catch {
        return invalid();
    }
    if (typeof token !== "string" || !token || token.length > 128)
        return invalid();
    const unavailable = () =>
        Response.json(
            { code: "SERVICE_UNAVAILABLE", message: "Try again later" },
            { status: 503 }
        );
    const key = crypto
        .createHash("sha256")
        .update("password-reset:" + token)
        .digest()
        .readBigInt64BE()
        .toString();
    resetLockPool ??= new Pool({
        connectionString: authConnectionString,
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        query_timeout: 5000,
    });
    const client = await resetLockPool.connect().catch(() => null);
    if (!client) return unavailable();
    try {
        await client.query("begin");
        const lock = await client.query<{ locked: boolean }>(
            "select pg_try_advisory_xact_lock($1::bigint) as locked",
            [key]
        );
        if (!lock.rows[0]?.locked) return invalid();
        return await auth.handler(request);
    } catch {
        return unavailable();
    } finally {
        try {
            await client.query("rollback");
            client.release();
        } catch {
            client.release(true);
        }
    }
}

export type Auth = typeof auth;

export type AuthUser = {
    id: string;
    email: string;
    name: string;
    role: string;
};

export type AuthSession = {
    user: AuthUser;
};

/**
 * Resolves the session carried by a request's cookies. Answers `null` when the
 * request is unauthenticated, so callers decide the status code.
 */
export async function getSession(
    request: Request
): Promise<AuthSession | null> {
    let session: Awaited<ReturnType<typeof auth.api.getSession>>;
    try {
        session = await auth.api.getSession({ headers: request.headers });
    } catch {
        return null;
    }
    if (!session?.user) return null;
    return {
        user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            role: (session.user as { role?: string }).role ?? "user",
        },
    };
}

export function isAdmin(session: AuthSession | null): boolean {
    return session?.user.role === "admin";
}

/**
 * Document access authorization rule:
 * - Unowned (legacy) documents are accessible to admins only.
 * - Owned documents are accessible to their owner and to admins.
 */
export function canAccessDocument(
    session: AuthSession,
    ownerUserId: string | null
): boolean {
    if (ownerUserId === null) return isAdmin(session);
    return session.user.id === ownerUserId || isAdmin(session);
}
