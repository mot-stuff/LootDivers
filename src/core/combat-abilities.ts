import type {
  AbilityDefinition,
  AbilityTarget,
} from "./ability-runtime-contracts";
import { contentId, type ContentId } from "./ids";

export const MANA_RESOURCE_ID = contentId("combat:mana");
export const ABILITY_DAMAGE_EXECUTOR_ID = contentId("combat:ability-effect");
export const OUTGOING_DAMAGE_STAT_ID = contentId("combat:outgoing-damage");

export const BASIC_CLEAVE_ID = contentId("ability:basic-cleave");
export const CINDER_DART_ID = contentId("ability:cinder-dart");
export const WINTER_PULSE_ID = contentId("ability:winter-pulse");
export const DEFIANT_SIGNAL_ID = contentId("ability:defiant-signal");

export type CombatAbilityId = ContentId;

const cancellation = {
  allowedDuring: [] as const,
  refund: "none" as const,
  cooldown: "retain" as const,
};

function effect(kind: "cleave" | "projectile" | "area" | "signal") {
  return {
    kind: "custom" as const,
    executorKind: ABILITY_DAMAGE_EXECUTOR_ID,
    parameters: [{ key: "kind", value: kind }],
  };
}

const tags = (...values: readonly string[]) =>
  values.map((value) => contentId(`tag:${value}`));

export const COMBAT_ABILITY_DEFINITIONS: readonly AbilityDefinition[] = [
  {
    id: BASIC_CLEAVE_ID,
    tags: tags("attack", "melee", "aoe", "physical", "primary"),
    targeting: { mode: "direction", range: 110 },
    timing: { startupTicks: 4, activeTicks: 3, recoveryTicks: 8 },
    costs: [],
    cooldown: { durationTicks: 0, startsOn: "pay" },
    cancellation,
    statCaptures: [{ subject: "source", statId: OUTGOING_DAMAGE_STAT_ID }],
    effects: [effect("cleave")],
  },
  {
    id: CINDER_DART_ID,
    tags: tags("spell", "projectile", "fire"),
    targeting: { mode: "direction", range: 600 },
    timing: { startupTicks: 7, activeTicks: 1, recoveryTicks: 8 },
    costs: [{ resourceId: MANA_RESOURCE_ID, amount: 15, settlement: "pay" }],
    cooldown: { durationTicks: 30, startsOn: "pay" },
    cancellation,
    statCaptures: [{ subject: "source", statId: OUTGOING_DAMAGE_STAT_ID }],
    effects: [effect("projectile")],
  },
  {
    id: WINTER_PULSE_ID,
    tags: tags("spell", "aoe", "cold", "debuff"),
    targeting: { mode: "point", range: 360 },
    timing: { startupTicks: 12, activeTicks: 1, recoveryTicks: 11 },
    costs: [{ resourceId: MANA_RESOURCE_ID, amount: 25, settlement: "pay" }],
    cooldown: { durationTicks: 150, startsOn: "pay" },
    cancellation,
    statCaptures: [{ subject: "source", statId: OUTGOING_DAMAGE_STAT_ID }],
    effects: [effect("area")],
  },
  {
    id: DEFIANT_SIGNAL_ID,
    tags: tags("spell", "aoe", "buff", "debuff"),
    targeting: { mode: "self", range: 180 },
    timing: { startupTicks: 6, activeTicks: 1, recoveryTicks: 8 },
    costs: [{ resourceId: MANA_RESOURCE_ID, amount: 20, settlement: "pay" }],
    cooldown: { durationTicks: 300, startsOn: "pay" },
    cancellation,
    statCaptures: [],
    effects: [effect("signal")],
  },
] as const;

export interface StatusInstance {
  readonly targetId: string;
  readonly statusId: "chilled" | "focused" | "weakened";
  readonly appliedTick: number;
  readonly expiresAtTick: number;
}

export class RefreshingStatusStore {
  readonly #statuses = new Map<string, StatusInstance>();

  public apply(
    targetId: string,
    statusId: StatusInstance["statusId"],
    tick: number,
    durationTicks: number,
  ): StatusInstance {
    const status = {
      targetId,
      statusId,
      appliedTick: tick,
      expiresAtTick: tick + durationTicks,
    };
    this.#statuses.set(`${targetId}:${statusId}`, status);
    return status;
  }

  public expire(tick: number): void {
    for (const [key, status] of this.#statuses) {
      if (tick >= status.expiresAtTick) this.#statuses.delete(key);
    }
  }

  public has(targetId: string, statusId: StatusInstance["statusId"]): boolean {
    return this.#statuses.has(`${targetId}:${statusId}`);
  }

  public remaining(
    targetId: string,
    statusId: StatusInstance["statusId"],
    tick: number,
  ): number {
    return Math.max(
      0,
      (this.#statuses.get(`${targetId}:${statusId}`)?.expiresAtTick ?? tick) -
        tick,
    );
  }

  public values(): readonly StatusInstance[] {
    return [...this.#statuses.values()];
  }

  public clear(): void {
    this.#statuses.clear();
  }

  public clearTarget(targetId: string): void {
    for (const [key, status] of this.#statuses) {
      if (status.targetId === targetId) this.#statuses.delete(key);
    }
  }
}

export function damageAfterModifier(base: number, multiplier: number): number {
  return Math.floor(base * multiplier);
}

export function pointInArea(
  centerX: number,
  centerY: number,
  radius: number,
  targetX: number,
  targetY: number,
  targetRadius: number,
): boolean {
  return (
    Math.hypot(targetX - centerX, targetY - centerY) <= radius + targetRadius
  );
}

export function sweptCircleHitFraction(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  projectileRadius: number,
  targetX: number,
  targetY: number,
  targetRadius: number,
): number | null {
  const dx = endX - startX;
  const dy = endY - startY;
  const fx = startX - targetX;
  const fy = startY - targetY;
  const radius = projectileRadius + targetRadius;
  const a = dx * dx + dy * dy;
  if (a === 0) return fx * fx + fy * fy <= radius * radius ? 0 : null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = (-b - root) / (2 * a);
  const far = (-b + root) / (2 * a);
  if (near >= 0 && near <= 1) return near;
  if (far >= 0 && far <= 1) return far;
  return null;
}

export function targetMatches(
  target: AbilityTarget,
  mode: AbilityDefinition["targeting"]["mode"],
): boolean {
  return target.kind === mode;
}

export function definitionById(id: ContentId): AbilityDefinition | undefined {
  return COMBAT_ABILITY_DEFINITIONS.find((definition) => definition.id === id);
}
