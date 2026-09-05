import type {
  AbilityStoneStack,
  ItemInstance,
  MaterialStack,
} from "./item-generation";
import type { ContentId, PersistentInstanceId } from "./ids";
import { MATERIAL_STACK_LIMIT } from "./professions";

export const INVENTORY_SLOT_COUNT = 48;
export const ABILITY_STONE_STACK_LIMIT = 9;

export type InventoryAddFailure = "inventory-full" | "duplicate-instance";

export interface InventoryAddResult {
  readonly accepted: boolean;
  readonly reason?: InventoryAddFailure;
}

export class Inventory {
  readonly #slots: Array<ItemInstance | null>;

  public constructor() {
    this.#slots = Array.from({ length: INVENTORY_SLOT_COUNT }, () => null);
  }

  public itemAt(index: number): ItemInstance | null {
    this.#requireIndex(index);
    return this.#slots[index] ?? null;
  }

  public slots(): readonly (ItemInstance | null)[] {
    return [...this.#slots];
  }

  public hasInstance(instanceId: PersistentInstanceId): boolean {
    return this.#slots.some((item) => item?.instanceId === instanceId);
  }

  public materialCount(materialId: ContentId): number {
    return this.#slots.reduce((total, item) => {
      if (item?.kind !== "material" || item.materialId !== materialId) {
        return total;
      }
      return total + item.quantity;
    }, 0);
  }

  public add(item: ItemInstance): InventoryAddResult {
    if (this.hasInstance(item.instanceId)) {
      return { accepted: false, reason: "duplicate-instance" };
    }

    const candidate = [...this.#slots];
    if (item.kind === "equipment") {
      const emptyIndex = candidate.indexOf(null);
      if (emptyIndex < 0) {
        return { accepted: false, reason: "inventory-full" };
      }
      candidate[emptyIndex] = item;
    } else if (!this.#addStackable(candidate, item)) {
      return { accepted: false, reason: "inventory-full" };
    }

    this.#slots.splice(0, this.#slots.length, ...candidate);
    return { accepted: true };
  }

  public take(index: number): ItemInstance | null {
    this.#requireIndex(index);
    const item = this.#slots[index] ?? null;
    this.#slots[index] = null;
    return item;
  }

  public putAt(index: number, item: ItemInstance): void {
    this.#requireIndex(index);
    if (this.#slots[index] !== null) {
      throw new Error(`Inventory slot ${index} is occupied.`);
    }
    if (this.hasInstance(item.instanceId)) {
      throw new Error(`Item instance "${item.instanceId}" is already owned.`);
    }
    this.#slots[index] = item;
  }

  /**
   * Replaces every slot from a saved layout, preserving slot positions
   * (TASK-705 restore). Duplicate instance IDs are rejected via `putAt`.
   */
  public restoreSlots(slots: readonly (ItemInstance | null)[]): void {
    if (slots.length !== INVENTORY_SLOT_COUNT) {
      throw new RangeError(
        `Inventory restore requires exactly ${INVENTORY_SLOT_COUNT} slots.`,
      );
    }
    this.#slots.fill(null);
    slots.forEach((item, index) => {
      if (item !== null) this.putAt(index, item);
    });
  }

  public consumeAbilityStone(index: number): boolean {
    this.#requireIndex(index);
    const item = this.#slots[index];
    if (item?.kind !== "ability-stone") return false;
    this.#slots[index] =
      item.quantity === 1 ? null : { ...item, quantity: item.quantity - 1 };
    return true;
  }

  public consumeMaterial(materialId: ContentId, quantity: number): boolean {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new RangeError("Material consumption must be a positive integer.");
    }
    if (this.materialCount(materialId) < quantity) return false;

    let remaining = quantity;
    for (
      let index = 0;
      index < this.#slots.length && remaining > 0;
      index += 1
    ) {
      const current = this.#slots[index];
      if (current?.kind !== "material" || current.materialId !== materialId) {
        continue;
      }
      if (current.quantity > remaining) {
        this.#slots[index] = {
          ...current,
          quantity: current.quantity - remaining,
        };
        remaining = 0;
        break;
      }
      remaining -= current.quantity;
      this.#slots[index] = null;
    }
    return remaining === 0;
  }

  #addStackable(
    slots: Array<ItemInstance | null>,
    incoming: AbilityStoneStack | MaterialStack,
  ): boolean {
    let remaining = incoming.quantity;
    const limit =
      incoming.kind === "ability-stone"
        ? ABILITY_STONE_STACK_LIMIT
        : MATERIAL_STACK_LIMIT;
    for (let index = 0; index < slots.length && remaining > 0; index += 1) {
      const current = slots[index] ?? null;
      if (!this.#sameStack(current, incoming) || current.quantity >= limit) {
        continue;
      }
      const moved = Math.min(remaining, limit - current.quantity);
      slots[index] = { ...current, quantity: current.quantity + moved };
      remaining -= moved;
    }

    if (remaining === 0) return true;
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex < 0) return false;
    slots[emptyIndex] = { ...incoming, quantity: remaining };
    return true;
  }

  #sameStack(
    current: ItemInstance | null,
    incoming: AbilityStoneStack | MaterialStack,
  ): current is AbilityStoneStack | MaterialStack {
    if (current === null || current.kind !== incoming.kind) return false;
    if (incoming.kind === "ability-stone") return true;
    return (
      current.kind === "material" && current.materialId === incoming.materialId
    );
  }

  #requireIndex(index: number): void {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= INVENTORY_SLOT_COUNT
    ) {
      throw new RangeError(
        `Inventory slot must be from 0 through ${INVENTORY_SLOT_COUNT - 1}.`,
      );
    }
  }
}
