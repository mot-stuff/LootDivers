import { PersistenceError } from "./contracts";

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PersistenceError(
        "corrupt",
        "Save data contains a non-finite number.",
      );
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new PersistenceError(
    "corrupt",
    `Save data contains unsupported value type "${typeof value}".`,
  );
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function withoutChecksum(
  envelope: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const unsigned: Record<string, unknown> = { ...envelope };
  delete unsigned.checksum;
  return unsigned;
}
