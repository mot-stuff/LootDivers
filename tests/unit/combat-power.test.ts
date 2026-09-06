import { describe, expect, it } from "vitest";

import {
  BASIC_CLEAVE_ID,
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  DISPLAYED_CLEAVE_BASE_DAMAGE,
  displayedCleaveDamage,
  HIGHSCORE_LIMIT,
  rankHighscores,
} from "../../src/core";

describe("displayedCleaveDamage", () => {
  it("matches the Basic Cleave catalog base for an unsaved character", () => {
    expect(DISPLAYED_CLEAVE_BASE_DAMAGE).toBe(25);
    expect(displayedCleaveDamage(null)).toBe(25);
    expect(
      displayedCleaveDamage(
        new CombatArenaSimulation(
          DEFAULT_COMBAT_ARENA_CONFIG,
        ).captureCharacterSave(),
      ),
    ).toBe(25);
  });

  it("rises when Strength is allocated, matching the arena multiplier", () => {
    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    const starting = displayedCleaveDamage(simulation.captureCharacterSave());
    // Starting characters have 2 unspent attribute points; 10 Strength is
    // +20% outgoing damage → 25 * 1.20 = 30.
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
    expect(displayedCleaveDamage(boosted)).toBe(30);
    expect(displayedCleaveDamage(boosted)).toBeGreaterThan(starting);
    expect(BASIC_CLEAVE_ID.length).toBeGreaterThan(0);
  });
});

describe("rankHighscores", () => {
  it("orders by level, then damage, then name, and caps at 100", () => {
    const rows = rankHighscores([
      { name: "Zed", class: "barbarian", level: 3, damage: 30 },
      { name: "Ann", class: "barbarian", level: 5, damage: 25 },
      { name: "Bo", class: "barbarian", level: 3, damage: 40 },
      { name: "Cy", class: "barbarian", level: 3, damage: 40 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Ann", "Bo", "Cy", "Zed"]);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[3]?.rank).toBe(4);

    const crowd = Array.from({ length: HIGHSCORE_LIMIT + 5 }, (_, index) => ({
      name: `Diver ${String(index)}`,
      class: "barbarian",
      level: 1,
      damage: 25,
    }));
    expect(rankHighscores(crowd)).toHaveLength(HIGHSCORE_LIMIT);
  });
});
