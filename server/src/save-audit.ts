/**
 * Retroactive save audit (TASK-718, DEC-044).
 *
 * Re-runs the DEC-043 write-time validator over every STORED blob, catching
 * saves that landed before validation shipped (pre-TASK-717 rows) or through
 * rule gaps that were closed later — the rules re-apply to history because
 * the validator is the client's own core/persistence code, not a snapshot.
 *
 * Pure function of a `DataStore`, so the contract suite exercises it against
 * MemoryStore and Postgres; `src/audit.ts` is the droplet CLI around it.
 */
import { validateSaveEnvelope } from "./save-validation.js";
import type { DataStore, SaveRejectionCount } from "./store.js";

export interface AuditFinding {
  readonly userId: string;
  readonly email: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly verdict: "valid" | "invalid";
  /** Rejection codes (DEC-043 vocabulary); empty when valid. */
  readonly codes: readonly string[];
  readonly detail: string | null;
}

export interface AuditReport {
  /** One finding per character with a stored blob, ordered by email/name. */
  readonly findings: readonly AuditFinding[];
  readonly invalidFindings: readonly AuditFinding[];
  /**
   * Per-account write-time rejection totals (the save_rejections trail).
   * A signal for a human decision — never an automatic ban (DEC-044).
   */
  readonly rejectionCounts: readonly SaveRejectionCount[];
}

export async function auditStoredSaves(store: DataStore): Promise<AuditReport> {
  const characters = await store.listCharactersForAudit();
  const findings: AuditFinding[] = [];
  for (const character of characters) {
    const shared = {
      userId: character.userId,
      email: character.email,
      characterId: character.characterId,
      characterName: character.characterName,
    };
    const validated = await validateSaveEnvelope(character.envelope);
    if (!validated.ok) {
      findings.push({
        ...shared,
        verdict: "invalid",
        codes: [validated.code],
        detail: validated.message,
      });
      continue;
    }
    // The same metadata consistency the write path enforces (DEC-043).
    if (validated.save.progression.level !== character.level) {
      findings.push({
        ...shared,
        verdict: "invalid",
        codes: ["level-mismatch"],
        detail: `Stored level column is ${String(character.level)} but the save's progression level is ${String(validated.save.progression.level)}.`,
      });
      continue;
    }
    findings.push({ ...shared, verdict: "valid", codes: [], detail: null });
  }
  return {
    findings,
    invalidFindings: findings.filter(
      (finding) => finding.verdict === "invalid",
    ),
    rejectionCounts: await store.listSaveRejectionCounts(),
  };
}

/** Human-readable report for the CLI (one line per character + signals). */
export function renderAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(
    `Audited ${String(report.findings.length)} stored save(s); ${String(report.invalidFindings.length)} invalid.`,
    "",
  );
  for (const finding of report.findings) {
    const codes =
      finding.codes.length > 0 ? ` [${finding.codes.join(", ")}]` : "";
    lines.push(
      `${finding.verdict.toUpperCase().padEnd(7)} ${finding.email}  "${finding.characterName}" (${finding.characterId})${codes}`,
    );
    if (finding.detail !== null) {
      lines.push(`        ${finding.detail}`);
    }
  }
  lines.push("", "Write-time rejection counts (save_rejections):");
  if (report.rejectionCounts.length === 0) {
    lines.push("  none recorded");
  }
  for (const count of report.rejectionCounts) {
    lines.push(
      `  ${count.email} (${count.userId}): ${String(count.count)} rejection(s)`,
    );
  }
  lines.push(
    "",
    "DEC-044: rejections and invalid saves are signals for a HUMAN decision;",
    "nothing is banned or deleted automatically. Ban with `npm run ban`.",
  );
  return lines.join("\n");
}
