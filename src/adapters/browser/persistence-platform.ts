import type { ChecksumProvider, SaveClock } from "../../persistence";

export class WebCryptoSha256 implements ChecksumProvider {
  async digest(canonicalValue: string): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalValue);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
}

export class SystemSaveClock implements SaveClock {
  nowIso(): string {
    return new Date().toISOString();
  }
}
