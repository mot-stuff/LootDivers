import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_POINTS_PER_LEVEL,
  BASIC_CLEAVE_ID,
  CharacterProgression,
  ENEMY_KILL_EXPERIENCE,
  PASSIVE_POINTS_PER_LEVEL,
  STARTING_ATTRIBUTE_POINTS,
  STARTING_LEVEL,
  STARTING_PASSIVE_POINTS,
  STRENGTH_DAMAGE_BASIS_POINTS,
  VITALITY_MAXIMUM_HEALTH,
  contentId,
  experienceToNextLevel,
  passiveById,
} from "../../src/core";

describe("Phase 4 character progression", () => {
  it("starts at level 1 with unspent points and an empty spend sheet", () => {
    const progression = new CharacterProgression();
    const model = progression.readModel();

    expect(model).toMatchObject({
      level: STARTING_LEVEL,
      experience: 0,
      experienceToNextLevel: experienceToNextLevel(1),
      unspentAttributePoints: STARTING_ATTRIBUTE_POINTS,
      unspentPassivePoints: STARTING_PASSIVE_POINTS,
    });
    expect(
      model.attributes.every((attribute) => attribute.allocated === 0),
    ).toBe(true);
    expect(model.passives).toHaveLength(8);
    expect(model.bonuses.maximumHealth).toBe(0);
  });

  it("levels from enemy-sized grants and keeps leftover experience", () => {
    const progression = new CharacterProgression();
    const first = progression.grantExperience(ENEMY_KILL_EXPERIENCE);
    expect(first).toMatchObject({
      levelsGained: 0,
      level: 1,
      experience: 20,
      experienceToNextLevel: 40,
    });

    const second = progression.grantExperience(ENEMY_KILL_EXPERIENCE);
    expect(second).toMatchObject({
      levelsGained: 1,
      level: 2,
      experience: 0,
      experienceToNextLevel: 60,
    });
    expect(progression.readModel()).toMatchObject({
      unspentAttributePoints:
        STARTING_ATTRIBUTE_POINTS + ATTRIBUTE_POINTS_PER_LEVEL,
      unspentPassivePoints: STARTING_PASSIVE_POINTS + PASSIVE_POINTS_PER_LEVEL,
    });
  });

  it("can multi-level from a large grant and spend or restore training", () => {
    const progression = new CharacterProgression();
    const grant = progression.grantExperience(200);
    expect(grant.levelsGained).toBeGreaterThan(1);

    expect(progression.allocateAttribute("vitality")).toEqual({
      accepted: true,
    });
    expect(progression.allocateAttribute("strength")).toEqual({
      accepted: true,
    });
    const ironTempo = passiveById(contentId("passive:iron-tempo"));
    expect(ironTempo).toBeDefined();
    expect(progression.allocatePassive(ironTempo!.id)).toEqual({
      accepted: true,
    });
    expect(progression.bonuses()).toMatchObject({
      maximumHealth: VITALITY_MAXIMUM_HEALTH,
      outgoingAbilityDamageBasisPoints:
        STRENGTH_DAMAGE_BASIS_POINTS +
        ironTempo!.outgoingAbilityDamageBasisPoints,
    });

    progression.respec();
    expect(progression.readModel()).toMatchObject({
      level: grant.level,
      experience: grant.experience,
      unspentAttributePoints:
        STARTING_ATTRIBUTE_POINTS +
        grant.levelsGained * ATTRIBUTE_POINTS_PER_LEVEL,
      unspentPassivePoints:
        STARTING_PASSIVE_POINTS + grant.levelsGained * PASSIVE_POINTS_PER_LEVEL,
    });
    expect(progression.bonuses().maximumHealth).toBe(0);
  });

  it("rejects spends that exceed the pool or mastery rank", () => {
    const progression = new CharacterProgression();
    expect(progression.deallocateAttribute("strength")).toEqual({
      accepted: false,
      reason: "nothing-allocated",
    });
    expect(progression.allocateAttribute("dexterity")).toEqual({
      accepted: true,
    });
    expect(progression.allocateAttribute("dexterity")).toEqual({
      accepted: true,
    });
    expect(progression.allocateAttribute("dexterity")).toEqual({
      accepted: false,
      reason: "no-unspent-points",
    });

    const cleaving = passiveById(contentId("passive:cleaving-form"))!;
    expect(progression.allocatePassive(cleaving.id)).toEqual({
      accepted: true,
    });
    expect(progression.allocatePassive(cleaving.id)).toEqual({
      accepted: false,
      reason: "no-unspent-points",
    });
    expect(progression.bonuses().abilityDamageBasisPoints).toEqual({
      [BASIC_CLEAVE_ID]: cleaving.abilityDamageBasisPoints,
    });
  });

  it("lets a mastery reach rank 3 and applies intelligence and dexterity bonuses", () => {
    const progression = new CharacterProgression();
    progression.grantExperience(200);
    const ironTempo = passiveById(contentId("passive:iron-tempo"))!;
    expect(progression.allocatePassive(ironTempo.id)).toEqual({
      accepted: true,
    });
    expect(progression.allocatePassive(ironTempo.id)).toEqual({
      accepted: true,
    });
    expect(progression.allocatePassive(ironTempo.id)).toEqual({
      accepted: true,
    });
    expect(progression.allocatePassive(ironTempo.id)).toEqual({
      accepted: false,
      reason: "maximum-rank",
    });
    expect(progression.allocateAttribute("intelligence")).toEqual({
      accepted: true,
    });
    expect(progression.allocateAttribute("dexterity")).toEqual({
      accepted: true,
    });
    expect(progression.bonuses()).toMatchObject({
      maximumMana: 4,
      moveSpeedBasisPoints: 100,
      outgoingAbilityDamageBasisPoints: 1_200,
    });
  });
});
