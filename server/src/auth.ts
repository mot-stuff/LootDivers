import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/**
 * Credential primitives (DEC-032): argon2id password hashing and opaque
 * session tokens. The server stores only the SHA-256 hash of a session
 * token — a database leak exposes no usable cookies.
 */

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison for token hashes (defense in depth). */
export function tokenHashesEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
