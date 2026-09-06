/**
 * Homepage highscores ranking (DEC-048).
 *
 * Rank is computed here so the API and the tests share one comparator:
 * highest level first, then highest displayed Cleave damage, then name
 * (case-insensitive) so ties stay stable. The cap is 100.
 */

export const HIGHSCORE_LIMIT = 100;

export interface HighscoreCandidate {
  readonly name: string;
  readonly class: string;
  readonly level: number;
  readonly damage: number;
}

export interface HighscoreRow extends HighscoreCandidate {
  readonly rank: number;
}

export function rankHighscores(
  candidates: readonly HighscoreCandidate[],
  limit: number = HIGHSCORE_LIMIT,
): readonly HighscoreRow[] {
  const ordered = [...candidates].sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    if (b.damage !== a.damage) return b.damage - a.damage;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
  return ordered.slice(0, Math.max(0, limit)).map((row, index) => ({
    rank: index + 1,
    name: row.name,
    class: row.class,
    level: row.level,
    damage: row.damage,
  }));
}
