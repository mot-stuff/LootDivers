/**
 * DEC-036 character identity rules (TASK-709 client side).
 *
 * This is the client mirror of `server/src/validation.ts` — one naming
 * rule shared client/server, duplicated only because the server workspace
 * compiles separately. Keep the pattern, the separator rule, and the slot
 * limit in sync with that file and the DEC-036 record.
 */

/** 3–16 chars, letter first, then letters/digits/apostrophes/hyphens/spaces. */
export const CHARACTER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9'\- ]{2,15}$/;
const CONSECUTIVE_SEPARATORS = /[' -]{2}/;

/** DEC-036: four server character slots per account in v1. */
export const CHARACTER_SLOT_LIMIT = 4;

/** One user-facing rule string, matching the server's 422 message. */
export const CHARACTER_NAME_RULE_MESSAGE =
  "Names are 3-16 characters, start with a letter, use only letters, " +
  "digits, apostrophes, hyphens, and spaces, with no consecutive separators.";

/**
 * Validates a raw name input the way the server will: trim, then apply the
 * DEC-036 pattern plus the no-consecutive-separators rule. Returns the
 * trimmed name to send, or null when the server would reply 422.
 */
export function normalizeCharacterName(raw: string): string | null {
  const name = raw.trim();
  if (!CHARACTER_NAME_PATTERN.test(name)) {
    return null;
  }
  if (CONSECUTIVE_SEPARATORS.test(name)) {
    return null;
  }
  return name;
}
