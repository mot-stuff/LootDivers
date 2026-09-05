import { describe, expect, it } from "vitest";

import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  DEFIANT_SIGNAL_ID,
  DeterministicEnemyLootGenerator,
  EQUIPMENT_BASE_CATALOG,
  FIXED_STEP_SECONDS,
  INVENTORY_SLOT_COUNT,
  WINTER_PULSE_ID,
  createAbilityStoneStack,
  definitionById,
  generateEquipmentItem,
  persistentInstanceId,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

function unlockPhaseTwoAbilities(simulation: CombatArenaSimulation): void {
  simulation.addCharacterItem(
    createAbilityStoneStack(persistentInstanceId("item:arena-stones"), 3),
  );
  for (const abilityId of [
    CINDER_DART_ID,
    WINTER_PULSE_ID,
    DEFIANT_SIGNAL_ID,
  ]) {
    expect(simulation.consumeCharacterAbilityStone(0, abilityId)).toMatchObject(
      { accepted: true },
    );
  }
}

function equipCommonWeapon(simulation: CombatArenaSimulation): void {
  simulation.addCharacterItem(
    generateEquipmentItem({
      seed: 1,
      instanceId: persistentInstanceId("item:arena-weapon"),
      baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
      rarity: "common",
    }),
  );
  expect(simulation.equipCharacterItem(0)).toEqual({ accepted: true });
}

function lootArena(seed = 123, pickupRadius = 20): CombatArenaSimulation {
  return new CombatArenaSimulation({
    ...DEFAULT_COMBAT_ARENA_CONFIG,
    loot: {
      ...DEFAULT_COMBAT_ARENA_CONFIG.loot,
      seed,
      pickupRadius,
    },
    enemy: {
      ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
      spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 90,
      spawnY: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
      maxHealth: 1,
    },
  });
}

function killArenaEnemy(simulation: CombatArenaSimulation): void {
  expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
  step(
    simulation,
    (definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0) + 1,
  );
  expect(simulation.diagnostics().enemy.dead).toBe(true);
}

describe("CombatArenaSimulation", () => {
  it("generates a stable weighted sequence containing every supported rarity", () => {
    const generate = (seed: number, kills: number) => {
      const generator = new DeterministicEnemyLootGenerator({
        seed,
        rarityWeights: DEFAULT_COMBAT_ARENA_CONFIG.loot.rarityWeights,
      });
      return Array.from({ length: kills }, () => generator.generateForKill());
    };

    expect(generate(77, 8)).toEqual(generate(77, 8));
    expect(generate(77, 8)).not.toEqual(generate(78, 8));

    const equipment = Array.from({ length: 20 }, (_, seed) =>
      generate(seed, 20),
    );
    const equipmentItems = equipment
      .flat()
      .flatMap(({ items }) => items)
      .filter((item) => item.kind === "equipment");
    const rarities = new Set(equipmentItems.map((item) => item.rarity));
    expect(rarities).toEqual(new Set(["common", "magic", "rare"]));
    expect(new Set(equipmentItems.map((item) => item.baseId))).toEqual(
      new Set(EQUIPMENT_BASE_CATALOG.map(({ id }) => id)),
    );
  });

  it("drops one equipment item per death and one stone on only the first kill", () => {
    const simulation = lootArena();
    killArenaEnemy(simulation);

    const firstDrops = simulation.diagnostics().worldLoot;
    expect(
      firstDrops.filter(({ item }) => item.kind === "equipment"),
    ).toHaveLength(1);
    expect(
      firstDrops.filter(({ item }) => item.kind === "ability-stone"),
    ).toHaveLength(1);
    expect(new Set(firstDrops.map(({ dropId }) => dropId)).size).toBe(2);
    expect(new Set(firstDrops.map(({ item }) => item.instanceId)).size).toBe(2);

    step(simulation, 60);
    expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
    step(
      simulation,
      (definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0) + 1,
    );
    expect(simulation.diagnostics().worldLoot).toHaveLength(2);

    simulation.reset();
    killArenaEnemy(simulation);
    const repeatedDrops = simulation.diagnostics().worldLoot;
    expect(
      repeatedDrops.filter(({ item }) => item.kind === "equipment"),
    ).toHaveLength(2);
    expect(
      repeatedDrops.filter(({ item }) => item.kind === "ability-stone"),
    ).toHaveLength(1);
    expect(new Set(repeatedDrops.map(({ dropId }) => dropId)).size).toBe(3);
    expect(new Set(repeatedDrops.map(({ item }) => item.instanceId)).size).toBe(
      3,
    );
    expect(simulation.diagnostics()).toMatchObject({
      enemyKillCount: 2,
      lootDropCount: 3,
    });
  });

  it("automatically picks nearby drops after movement", () => {
    const simulation = lootArena();
    killArenaEnemy(simulation);
    const dropped = simulation
      .drainEvents()
      .filter((event) => event.type === "loot-dropped");
    expect(dropped).toHaveLength(2);

    simulation.setMovement(1, 0);
    step(simulation, 30);

    expect(simulation.diagnostics().worldLoot).toEqual([]);
    expect(
      simulation.characterItemLoadout().inventory.filter(Boolean),
    ).toHaveLength(2);
    expect(
      simulation.drainEvents().filter((event) => event.type === "loot-picked"),
    ).toHaveLength(2);
  });

  it("retains nearby world loot when inventory is full", () => {
    const simulation = lootArena(123, 200);
    for (let index = 0; index < INVENTORY_SLOT_COUNT; index += 1) {
      expect(
        simulation.addCharacterItem(
          generateEquipmentItem({
            seed: index,
            instanceId: persistentInstanceId(`item:full-${index}`),
            baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
            rarity: "common",
          }),
        ),
      ).toEqual({ accepted: true });
    }

    killArenaEnemy(simulation);
    expect(simulation.diagnostics().worldLoot).toHaveLength(2);
    expect(
      simulation.drainEvents().filter((event) => event.type === "loot-picked"),
    ).toHaveLength(0);
  });

  it("retains unpicked loot and character loadout across combat reset", () => {
    const simulation = lootArena();
    equipCommonWeapon(simulation);
    unlockPhaseTwoAbilities(simulation);
    expect(simulation.assignAbilitySlot("q", CINDER_DART_ID)).toEqual({
      accepted: true,
    });
    const retainedInventoryItem = generateEquipmentItem({
      seed: 88,
      instanceId: persistentInstanceId("item:retained-across-reset"),
      baseId: EQUIPMENT_BASE_CATALOG[1]!.id,
      rarity: "common",
    });
    expect(simulation.addCharacterItem(retainedInventoryItem)).toEqual({
      accepted: true,
    });
    killArenaEnemy(simulation);
    const beforeReset = simulation.diagnostics().worldLoot;

    simulation.reset();

    expect(simulation.diagnostics().worldLoot).toEqual(beforeReset);
    const loadout = simulation.characterItemLoadout();
    expect(loadout.equipment["main-hand"]?.kind).toBe("equipment");
    expect(loadout.inventory).toContainEqual(retainedInventoryItem);
    expect(loadout.ownedAbilities).toContain(CINDER_DART_ID);
    expect(loadout.assignments.q).toBe(CINDER_DART_ID);
  });

  it("normalizes diagonal movement to the cardinal movement speed", () => {
    const cardinal = new CombatArenaSimulation();
    const diagonal = new CombatArenaSimulation();

    cardinal.setMovement(1, 0);
    diagonal.setMovement(1, 1);
    step(cardinal, 30);
    step(diagonal, 30);

    const cardinalState = cardinal.diagnostics();
    const diagonalState = diagonal.diagnostics();
    const centerX = DEFAULT_COMBAT_ARENA_CONFIG.width / 2;
    const centerY = DEFAULT_COMBAT_ARENA_CONFIG.height / 2;
    expect(cardinalState.x - centerX).toBeCloseTo(
      Math.hypot(diagonalState.x - centerX, diagonalState.y - centerY),
      10,
    );
  });

  it("keeps movement independent from mouse-facing aim", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(0, -1);
    simulation.setAim(-1, 0);
    step(simulation, 12);

    const state = simulation.diagnostics();
    expect(state.x).toBe(DEFAULT_COMBAT_ARENA_CONFIG.width / 2);
    expect(state.y).toBeLessThan(DEFAULT_COMBAT_ARENA_CONFIG.height / 2);
    expect(state.facingX).toBe(-1);
    expect(state.facingY).toBe(0);
  });

  it("uses fixed-tick dodge duration and blocks cooldown spam", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(1, 0);
    simulation.requestDodge();
    step(simulation, 1);

    const first = simulation.diagnostics();
    expect(first.dodgeCount).toBe(1);
    expect(first.dodging).toBe(true);
    expect(first.dodgeReady).toBe(false);

    simulation.requestDodge();
    step(simulation, 1);
    expect(simulation.diagnostics().dodgeCount).toBe(1);

    step(simulation, 46);
    expect(simulation.diagnostics()).toMatchObject({
      dodgeCount: 1,
      dodging: false,
      dodgeReady: true,
      cooldownTicksRemaining: 0,
    });

    simulation.requestDodge();
    step(simulation, 1);
    expect(simulation.diagnostics().dodgeCount).toBe(2);
  });

  it("keeps movement and dodges inside the arena bounds", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(-1, -1);
    simulation.requestDodge();
    step(simulation, 600);

    const state = simulation.diagnostics();
    expect(state.x).toBeGreaterThanOrEqual(
      DEFAULT_COMBAT_ARENA_CONFIG.playerRadius,
    );
    expect(state.y).toBeGreaterThanOrEqual(
      DEFAULT_COMBAT_ARENA_CONFIG.playerRadius,
    );
  });

  it("snapshots aim and applies damage on the first active tick", () => {
    const simulation = new CombatArenaSimulation({
      ...DEFAULT_COMBAT_ARENA_CONFIG,
      enemy: {
        ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
        spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 90,
        spawnY: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
      },
    });
    simulation.setAim(1, 0);
    simulation.requestPrimaryAttack();

    step(simulation, definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0);
    expect(simulation.diagnostics()).toMatchObject({
      attackPhase: "active",
      attackAimX: 1,
      attackAimY: 0,
      attackHitCount: 0,
      targets: [{ health: 50 }],
    });

    simulation.setAim(-1, 0);
    step(simulation, 1);
    expect(simulation.diagnostics()).toMatchObject({
      attackPhase: "active",
      attackAimX: 1,
      attackAimY: 0,
      attackHitCount: 1,
      targets: [{ health: 25 }],
    });
  });

  it("uses configured startup, active, and recovery tick windows", () => {
    const simulation = new CombatArenaSimulation();
    const attack = definitionById(BASIC_CLEAVE_ID)?.timing;
    if (attack === undefined) throw new Error("Basic Cleave is not defined.");
    simulation.requestPrimaryAttack();

    step(simulation, attack.startupTicks);
    expect(simulation.diagnostics()).toMatchObject({
      attackPhase: "active",
      attackPhaseTicksRemaining: attack.activeTicks,
      attackCount: 1,
    });
    step(simulation, attack.activeTicks);
    expect(simulation.diagnostics()).toMatchObject({
      attackPhase: "recovery",
      attackPhaseTicksRemaining: attack.recoveryTicks,
    });

    simulation.requestPrimaryAttack();
    step(simulation, attack.recoveryTicks);
    expect(simulation.diagnostics()).toMatchObject({
      attackPhase: "idle",
      attackPhaseTicksRemaining: 0,
      attackCount: 1,
    });
  });

  it("hits each target at most once per attack execution", () => {
    const simulation = new CombatArenaSimulation({
      ...DEFAULT_COMBAT_ARENA_CONFIG,
      enemy: {
        ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
        spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 90,
        spawnY: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
      },
    });
    simulation.requestPrimaryAttack();
    step(
      simulation,
      (definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0) +
        (definitionById(BASIC_CLEAVE_ID)?.timing.activeTicks ?? 0),
    );

    expect(simulation.diagnostics()).toMatchObject({
      attackHitCount: 1,
      targets: [{ health: 25 }],
    });
    expect(
      simulation
        .drainEvents()
        .filter((event) => event.type === "damage-applied"),
    ).toHaveLength(1);
  });

  it("ignores player damage throughout the active dodge state", () => {
    const simulation = new CombatArenaSimulation();
    simulation.requestDodge();
    step(simulation, 1);

    const ignored = simulation.applyPlayerDamage({
      amount: 40,
      sourceId: "enemy",
    });
    expect(ignored).toMatchObject({
      applied: 0,
      currentHealth: 100,
      died: false,
      ignoredReason: "invulnerable",
    });

    while (simulation.diagnostics().dodging) {
      step(simulation, 1);
    }
    expect(
      simulation.applyPlayerDamage({ amount: 40, sourceId: "enemy" }),
    ).toMatchObject({
      applied: 40,
      currentHealth: 60,
      ignoredReason: null,
    });
  });

  it("kills the player once, blocks actions, and fully resets combat", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(1, 0);
    simulation.requestPrimaryAttack();
    simulation.applyPlayerDamage({ amount: 150, sourceId: "enemy" });
    simulation.applyPlayerDamage({ amount: 10, sourceId: "enemy" });
    const deathEvents = simulation
      .drainEvents()
      .filter((event) => event.type === "entity-died");
    expect(deathEvents).toHaveLength(1);

    const deadX = simulation.diagnostics().x;
    step(simulation, 20);
    expect(simulation.diagnostics()).toMatchObject({
      x: deadX,
      playerHealth: 0,
      playerDead: true,
      attackPhase: "idle",
      attackCount: 0,
    });

    simulation.reset();
    expect(simulation.diagnostics()).toMatchObject({
      x: DEFAULT_COMBAT_ARENA_CONFIG.width / 2,
      y: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
      playerHealth: 100,
      playerDead: false,
      attackPhase: "idle",
      attackCount: 0,
      dodgeCount: 0,
      enemy: {
        x: DEFAULT_COMBAT_ARENA_CONFIG.enemy.spawnX,
        y: DEFAULT_COMBAT_ARENA_CONFIG.enemy.spawnY,
        health: DEFAULT_COMBAT_ARENA_CONFIG.enemy.maxHealth,
        state: "approaching",
        attackCount: 0,
        damageAttemptCount: 0,
      },
      eventCount: 0,
    });
  });

  it("rejects every ability after death through authoritative activation state", () => {
    const simulation = new CombatArenaSimulation();
    simulation.applyPlayerDamage({ amount: 1_000, sourceId: "enemy" });
    const before = simulation.diagnostics();

    for (const abilityId of [
      BASIC_CLEAVE_ID,
      CINDER_DART_ID,
      WINTER_PULSE_ID,
      DEFIANT_SIGNAL_ID,
    ]) {
      expect(simulation.abilityActivation(abilityId)).toMatchObject({
        kind: "defeated",
        canActivate: false,
        rejectionReason: "player-defeated",
        currentExecution: null,
      });
      expect(simulation.requestAbility(abilityId)).toMatchObject({
        accepted: false,
        reason: "player-defeated",
      });
    }
    simulation.requestPrimaryAttack();

    expect(simulation.diagnostics()).toMatchObject({
      mana: before.mana,
      cooldowns: before.cooldowns,
      currentExecution: null,
      projectiles: [],
      areaFeedback: [],
      statuses: [],
      lastAbilityResult: {
        abilityId: BASIC_CLEAVE_ID,
        accepted: false,
        reason: "player-defeated",
      },
    });
  });

  it("allows only one startup, active, or recovery execution with no queue", () => {
    const phaseCases = [
      { steps: 0, stage: "startup" },
      { steps: 4, stage: "active" },
      { steps: 7, stage: "recovery" },
    ] as const;

    for (const phaseCase of phaseCases) {
      const simulation = new CombatArenaSimulation();
      expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
      step(simulation, phaseCase.steps);
      expect(simulation.diagnostics().currentExecution?.stage).toBe(
        phaseCase.stage,
      );
      expect(simulation.abilityActivation(CINDER_DART_ID)).toMatchObject({
        kind: "busy",
        canActivate: false,
        rejectionReason: "ability-busy",
      });
      expect(simulation.requestAbility(CINDER_DART_ID)).toMatchObject({
        accepted: false,
        reason: "ability-busy",
      });
      expect(simulation.diagnostics().mana).toBe(100);
      step(simulation, 15 - phaseCase.steps);
      expect(simulation.diagnostics().currentExecution).toBeNull();
      expect(simulation.requestAbility(CINDER_DART_ID).accepted).toBe(true);
    }

    for (const abilityId of [
      CINDER_DART_ID,
      WINTER_PULSE_ID,
      DEFIANT_SIGNAL_ID,
    ]) {
      const simulation = new CombatArenaSimulation();
      const target =
        abilityId === WINTER_PULSE_ID
          ? ({ kind: "point", x: 600, y: 400 } as const)
          : undefined;
      expect(simulation.requestAbility(abilityId, target).accepted).toBe(true);
      expect(simulation.requestAbility(BASIC_CLEAVE_ID)).toMatchObject({
        accepted: false,
        reason: "ability-busy",
      });
      expect(simulation.diagnostics().currentExecution?.abilityId).toBe(
        abilityId,
      );
    }
  });

  it("keeps movement unrestricted during an ability execution", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(1, 0);
    expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);

    step(simulation, 1);

    expect(simulation.diagnostics()).toMatchObject({
      x:
        DEFAULT_COMBAT_ARENA_CONFIG.width / 2 +
        DEFAULT_COMBAT_ARENA_CONFIG.moveSpeed * FIXED_STEP_SECONDS,
      currentExecution: {
        abilityId: BASIC_CLEAVE_ID,
        stage: "startup",
      },
    });
  });

  it("executes assigned slots with direction, point, and self targets", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.characterItemLoadout()).toMatchObject({
      ownedAbilities: [BASIC_CLEAVE_ID],
      assignments: {
        lmb: BASIC_CLEAVE_ID,
        q: CINDER_DART_ID,
        e: WINTER_PULSE_ID,
        f: DEFIANT_SIGNAL_ID,
      },
    });

    expect(
      simulation.requestAbilitySlot("q", {
        kind: "point",
        x: 700,
        y: 400,
      }),
    ).toMatchObject({ accepted: true });
    expect(simulation.diagnostics().currentExecution?.target).toEqual({
      kind: "direction",
      x: 100,
      y: 0,
    });

    simulation.reset();
    expect(
      simulation.requestAbilitySlot("e", { kind: "direction", x: 1, y: 0 }),
    ).toMatchObject({ accepted: true });
    expect(simulation.diagnostics().currentExecution?.target).toEqual({
      kind: "point",
      x: 960,
      y: 400,
    });

    simulation.reset();
    expect(
      simulation.requestAbilitySlot("f", {
        kind: "point",
        x: 700,
        y: 400,
      }),
    ).toMatchObject({ accepted: true });
    expect(simulation.diagnostics().currentExecution?.target).toEqual({
      kind: "self",
    });
  });

  it("keeps Basic Cleave assigned and routes primary attacks through LMB", () => {
    const simulation = new CombatArenaSimulation();
    unlockPhaseTwoAbilities(simulation);

    expect(simulation.assignAbilitySlot("lmb", CINDER_DART_ID)).toEqual({
      accepted: false,
      reason: "basic-cleave-required",
    });
    expect(simulation.assignAbilitySlot("q", BASIC_CLEAVE_ID)).toEqual({
      accepted: true,
    });
    expect(simulation.assignAbilitySlot("lmb", CINDER_DART_ID)).toEqual({
      accepted: true,
    });

    simulation.requestPrimaryAttack();
    expect(simulation.diagnostics().currentExecution).toMatchObject({
      abilityId: CINDER_DART_ID,
      target: { kind: "direction", x: 1, y: 0 },
    });
    expect(simulation.characterItemLoadout().assignments).toMatchObject({
      lmb: CINDER_DART_ID,
      q: BASIC_CLEAVE_ID,
    });
  });

  it("applies equipment damage to every damage ability", () => {
    const base = DEFAULT_COMBAT_ARENA_CONFIG;
    const cases = [
      {
        abilityId: BASIC_CLEAVE_ID,
        target: undefined,
        startupTicks: 5,
        expectedDamage: 26,
        enemyX: 690,
      },
      {
        abilityId: CINDER_DART_ID,
        target: undefined,
        startupTicks: 22,
        expectedDamage: 31,
        enemyX: 750,
      },
      {
        abilityId: WINTER_PULSE_ID,
        target: { kind: "point" as const, x: 750, y: 400 },
        startupTicks: 12,
        expectedDamage: 21,
        enemyX: 750,
      },
    ];

    for (const testCase of cases) {
      const simulation = new CombatArenaSimulation({
        ...base,
        enemy: {
          ...base.enemy,
          spawnX: testCase.enemyX,
          spawnY: 400,
          maxHealth: 100,
        },
      });
      equipCommonWeapon(simulation);
      expect(
        simulation.requestAbility(testCase.abilityId, testCase.target).accepted,
      ).toBe(true);
      step(simulation, testCase.startupTicks);
      expect(simulation.diagnostics().enemy.health).toBe(
        100 - testCase.expectedDamage,
      );
    }
  });

  it("preserves missing health across equipment changes and resets to equipped max", () => {
    const simulation = new CombatArenaSimulation();
    const chest = generateEquipmentItem({
      seed: 2,
      instanceId: persistentInstanceId("item:arena-chest"),
      baseId: EQUIPMENT_BASE_CATALOG[1]!.id,
      rarity: "common",
    });
    simulation.addCharacterItem(chest);
    simulation.applyPlayerDamage({ amount: 30, sourceId: "enemy" });

    expect(simulation.equipCharacterItem(0)).toEqual({ accepted: true });
    expect(simulation.diagnostics()).toMatchObject({
      playerHealth: 80,
      playerMaxHealth: 110,
    });
    expect(simulation.characterItemLoadout()).toMatchObject({
      equipment: { chest },
      stats: { maximumHealth: 110 },
    });

    simulation.reset();
    expect(simulation.diagnostics()).toMatchObject({
      playerHealth: 110,
      playerMaxHealth: 110,
    });
    expect(simulation.unequipCharacterItem("chest")).toEqual({
      accepted: true,
    });
    expect(simulation.diagnostics()).toMatchObject({
      playerHealth: 100,
      playerMaxHealth: 100,
    });
  });

  it("multiplies equipment damage with the temporary Focused modifier", () => {
    const simulation = new CombatArenaSimulation({
      ...DEFAULT_COMBAT_ARENA_CONFIG,
      enemy: {
        ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
        spawnX: 750,
        spawnY: 400,
      },
    });
    equipCommonWeapon(simulation);

    expect(simulation.requestAbility(DEFIANT_SIGNAL_ID).accepted).toBe(true);
    step(simulation, 15);
    expect(simulation.requestAbility(CINDER_DART_ID).accepted).toBe(true);
    step(simulation, 22);

    expect(simulation.diagnostics().enemy.health).toBe(13);
    expect(
      simulation
        .drainEvents()
        .filter(
          (event) =>
            event.type === "damage-applied" &&
            event.targetId === DEFAULT_COMBAT_ARENA_CONFIG.enemy.id,
        ),
    ).toContainEqual(expect.objectContaining({ amount: 37 }));
  });
});
