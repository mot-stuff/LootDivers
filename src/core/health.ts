export type DamageIgnoreReason = "dead" | "invulnerable";

export interface DamageRequest {
  readonly amount: number;
  readonly sourceId?: string;
}

export interface DamageResult {
  readonly applied: number;
  readonly previousHealth: number;
  readonly currentHealth: number;
  readonly died: boolean;
  readonly ignoredReason: DamageIgnoreReason | null;
}

export interface HealthReadModel {
  readonly current: number;
  readonly max: number;
  readonly dead: boolean;
}

export interface Damageable {
  readonly health: HealthReadModel;
  applyDamage(request: DamageRequest, invulnerable?: boolean): DamageResult;
}

export class HealthPool implements Damageable {
  readonly #health: { current: number; max: number; dead: boolean };

  public constructor(maxHealth: number) {
    if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
      throw new RangeError("Maximum health must be finite and positive.");
    }
    this.#health = { current: maxHealth, max: maxHealth, dead: false };
  }

  public get health(): HealthReadModel {
    return { ...this.#health };
  }

  public updateMaximum(maxHealth: number): HealthReadModel {
    if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
      throw new RangeError("Maximum health must be finite and positive.");
    }

    const missingHealth = this.#health.max - this.#health.current;
    this.#health.max = maxHealth;
    this.#health.current = Math.min(
      maxHealth,
      Math.max(0, maxHealth - missingHealth),
    );
    this.#health.dead = this.#health.current === 0;
    return this.health;
  }

  public applyDamage(
    request: DamageRequest,
    invulnerable = false,
  ): DamageResult {
    if (!Number.isFinite(request.amount) || request.amount < 0) {
      throw new RangeError("Damage must be finite and non-negative.");
    }

    const previousHealth = this.#health.current;
    const ignoredReason = this.#health.dead
      ? "dead"
      : invulnerable
        ? "invulnerable"
        : null;
    if (ignoredReason !== null || request.amount === 0) {
      return {
        applied: 0,
        previousHealth,
        currentHealth: previousHealth,
        died: false,
        ignoredReason,
      };
    }

    this.#health.current = Math.max(0, previousHealth - request.amount);
    this.#health.dead = this.#health.current === 0;
    return {
      applied: previousHealth - this.#health.current,
      previousHealth,
      currentHealth: this.#health.current,
      died: this.#health.dead,
      ignoredReason: null,
    };
  }

  /**
   * Restores health, clamped at maximum (overflow is lost). Dead pools are
   * never healed — revival goes through `reset()`. Returns the amount
   * actually applied (TASK-711 flask recovery).
   */
  public heal(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError("Healing must be finite and non-negative.");
    }
    if (this.#health.dead || amount === 0) return 0;
    const applied = Math.min(amount, this.#health.max - this.#health.current);
    this.#health.current += applied;
    return applied;
  }

  public reset(): void {
    this.#health.current = this.#health.max;
    this.#health.dead = false;
  }
}
