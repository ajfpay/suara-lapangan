/**
 * Guards next.config.js: skipMiddlewareUrlNormalize must only apply in
 * development (dev-proxy bind quirk), never in production where it changes
 * middleware URL semantics for auth redirects and i18n routing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(import.meta.url);
const configPath = path.resolve(__dirname, "../next.config.js");

function loadConfig(env: string): Record<string, unknown> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env);
  delete req.cache[configPath];
  return req(configPath) as Record<string, unknown>;
}

describe("next.config.js middleware flag", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets skipMiddlewareUrlNormalize in development", () => {
    const config = loadConfig("development");
    expect(config.skipMiddlewareUrlNormalize).toBe(true);
  });

  it("does not set skipMiddlewareUrlNormalize in production", () => {
    const config = loadConfig("production");
    expect(config.skipMiddlewareUrlNormalize).toBeUndefined();
  });
});
