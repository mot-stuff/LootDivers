import type { AbilityStoneStack, ItemInstance } from "./item-generation";
import type { PersistentInstanceId } from "./ids";

export const INVENTORY_SLOT_COUNT = 12;
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
    } else if (!this.#addStoneQuantity(candidate, item)) {
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

  public consumeAbilityStone(index: number): boolean {
    this.#requireIndex(index);
    const item = this.#slots[index];
    if (item?.kind !== "ability-stone") return false;
    this.#slots[index] =
      item.quantity === 1 ? null : { ...item, quantity: item.quantity - 1 };
    return true;
  }

  #addStoneQuantity(
    slots: Array<ItemInstance | null>,
    incoming: AbilityStoneStack,
  ): boolean {
    let remaining = incoming.quantity;
    for (let index = 0; index < slots.length && remaining > 0; index += 1) {
      const current = slots[index];
      if (
        current?.kind !== "ability-stone" ||
        current.quantity >= ABILITY_STONE_STACK_LIMIT
      ) {
        continue;
      }
      const moved = Math.min(
        remaining,
        ABILITY_STONE_STACK_LIMIT - current.quantity,
      );
      slots[index] = { ...current, quantity: current.quantity + moved };
      remaining -= moved;
    }

    if (remaining === 0) return true;
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex < 0) return false;
    slots[emptyIndex] = { ...incoming, quantity: remaining };
    return true;
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
