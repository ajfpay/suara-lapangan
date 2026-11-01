import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { Pool } from "pg";
import crypto from "node:crypto";
import { getSmtpConfig } from "@/lib/server/email/config";
import { sendEmail } from "@/lib/server/email/send";
import { redactSecrets } from "@/lib/server/asr/log";

function getAuthDbPool(): Pool {
    const connectionString =
        process.env.DATABASE_URL ||
        process.env.ASR_TEST_DATABASE_URL ||
        "postgres://suara:suara@localhost:5432/suara_test";

    const pool = new Pool({ connectionString });
    pool.on("error", (err) => {
        console.error(redactSecrets(`[auth] pool error: ${String(err)}`));
    });
    return pool;
}

const pool = getAuthDbPool();

export const auth = betterAuth({
    database: pool,
    secret:
        process.env.BETTER_AUTH_SECRET ||
        "suara-lapangan-secret-key-development-minimum-32-chars",
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
        fields: {
            expiresAt: "expires_at",
            createdAt: "created_at",
            updatedAt: "updated_at",
        },
    },
    plugins: [
        admin({
            schema: {
                user: {
                    fields: {
                        banReason: "ban_reason",
                        banExpires: "ban_expires",
                    },
                },
            },
        }),
    ],
    advanced: {
        database: {
            generateId: () => crypto.randomUUID(),
        },
    },
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
    },
    emailVerification: {
        sendVerificationEmail: async ({ user, url }) => {
            const smtpConfig = getSmtpConfig();
            if (smtpConfig) {
                try {
                    await sendEmail(smtpConfig, {
                        to: user.email,
                        subject: "Verifikasi Email — Suara Lapangan",
                        text: `Halo ${user.name},\n\nSilakan klik tautan berikut untuk memverifikasi akun Anda:\n${url}\n\nSalam,\nTim Suara Lapangan`,
                        attachments: [],
                    });
                } catch (err) {
                    console.error(
                        redactSecrets(
                            `[auth] failed to send verification email: ${String(err)}`
                        )
                    );
                }
            } else {
                console.log(
                    `[auth] SMTP not configured. Verification URL for ${user.email}: ${url}`
                );
            }
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

export type Auth = typeof auth;
