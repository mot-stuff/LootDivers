/**
 * Public highscores feed (DEC-048).
 *
 * Rank is computed from stored character metadata and the client's own
 * combat-power formula (sheet DPS of every damaging ability on the
 * loadout/owned kit). The client never supplies a DPS number — forged
 * saves still have to pass DEC-043 before they can appear here.
 */
import type { FastifyInstance } from "fastify";
import {
  displayedTotalDps,
  parseCharacterSave,
  rankHighscores,
  type CharacterSave,
} from "../../src/core";
import type { DataStore } from "./store.js";

function saveFromEnvelope(envelope: unknown): CharacterSave | null {
  if (typeof envelope !== "object" || envelope === null) {
    return null;
  }
  const payload = (envelope as Record<string, unknown>).payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const character = (payload as Record<string, unknown>).character;
  try {
    return parseCharacterSave(character);
  } catch {
    return null;
  }
}

export function registerHighscoreRoutes(
  app: FastifyInstance,
  store: DataStore,
): void {
  app.get("/highscores", async (_request, reply) => {
    const candidates = await store.listHighscoreCandidates();
    const rows = rankHighscores(
      candidates.map((candidate) => ({
        name: candidate.name,
        class: candidate.class,
        level: candidate.level,
        dps: displayedTotalDps(saveFromEnvelope(candidate.envelope)),
      })),
    );
    return reply.status(200).send(rows);
  });
}
