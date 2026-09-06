import { describe, expect, it } from "vitest";

import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  displayedTotalDps,
  HIGHSCORE_LIMIT,
  rankHighscores,
} from "../../src/core";

describe("displayedTotalDps", () => {
  it("sums every damaging ability on the starter bar", () => {
    // Cleave 25 / 0.25s = 100, Dart 30 / 0.5s = 60, Pulse 20 / 2.5s = 8.
    expect(displayedTotalDps(null)).toBe(168);
    expect(
      displayedTotalDps(
        new CombatArenaSimulation(
          DEFAULT_COMBAT_ARENA_CONFIG,
        ).captureCharacterSave(),
      ),
    ).toBe(168);
  });

  it("scales the whole kit when Strength is allocated", () => {
    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    const starting = displayedTotalDps(simulation.captureCharacterSave());
    simulation.grantExperience(40);
    simulation.grantExperience(
      simulation.characterProgression().experienceToNextLevel,
    );
    simulation.grantExperience(
      simulation.characterProgression().experienceToNextLevel,
    );
    simulation.grantExperience(
      simulation.characterProgression().experienceToNextLevel,
    );
    for (let i = 0; i < 10; i += 1) {
      expect(simulation.allocateAttribute("strength").accepted).toBe(true);
    }
    const boosted = simulation.captureCharacterSave();
    expect(boosted.progression.attributes.strength).toBe(10);
    // +20% outgoing: Cleave 30*4=120, Dart 36*2=72, Pulse 24*0.4=9.6 → 201.
    expect(displayedTotalDps(boosted)).toBe(201);
    expect(displayedTotalDps(boosted)).toBeGreaterThan(starting);
  });
});

describe("rankHighscores", () => {
  it("orders by level, then DPS, then name, and caps at 100", () => {
    const rows = rankHighscores([
      { name: "Zed", class: "barbarian", level: 3, dps: 30 },
      { name: "Ann", class: "barbarian", level: 5, dps: 25 },
      { name: "Bo", class: "barbarian", level: 3, dps: 40 },
      { name: "Cy", class: "barbarian", level: 3, dps: 40 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Ann", "Bo", "Cy", "Zed"]);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[3]?.rank).toBe(4);

    const crowd = Array.from({ length: HIGHSCORE_LIMIT + 5 }, (_, index) => ({
      name: `Diver ${String(index)}`,
      class: "barbarian",
      level: 1,
      dps: 168,
    }));
    expect(rankHighscores(crowd)).toHaveLength(HIGHSCORE_LIMIT);
  });
});
