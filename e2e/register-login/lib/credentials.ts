import { execFileSync } from 'node:child_process';
import util from 'node:util';

export class AkeylessSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AkeylessSecretError';
  }
}

export class RedactedSecret {
  #secret: string;

  constructor(secret: string) {
    if (!secret || typeof secret !== 'string') {
      throw new AkeylessSecretError('Invalid secret payload');
    }
    this.#secret = secret;
  }

  getRawPassword(): string {
    return this.#secret;
  }

  toString(): string {
    return '[REDACTED_SECRET]';
  }

  toJSON(): string {
    return '[REDACTED_SECRET]';
  }

  [util.inspect.custom](): string {
    return '[REDACTED_SECRET]';
  }
}

let cachedSecret: RedactedSecret | null = null;

export function resolveDeterministicPassword(): RedactedSecret {
  if (cachedSecret) {
    return cachedSecret;
  }

  const secretName = '/suara-lapangan/credentials/demo-user';
  let stdout: string;
  try {
    stdout = execFileSync('akeyless', ['get-secret-value', '-n', secretName, '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    throw new AkeylessSecretError(`Failed to retrieve secret from Akeyless: ${secretName}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AkeylessSecretError(`Malformed JSON returned from Akeyless for ${secretName}`);
  }

  const item = parsed[secretName] || parsed;
  let data: any = item;
  if (typeof item === 'string') {
    try {
      data = JSON.parse(item);
    } catch {
      throw new AkeylessSecretError(`Inner payload for ${secretName} is not valid JSON`);
    }
  }

  if (!data || typeof data !== 'object' || typeof data.password !== 'string' || data.password.length === 0) {
    throw new AkeylessSecretError(`Secret payload for ${secretName} missing password property`);
  }

  cachedSecret = new RedactedSecret(data.password);
  return cachedSecret;
}
