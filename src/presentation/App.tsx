import { useEffect, useLayoutEffect, useState } from "preact/hooks";

import { FOUNDATION_ID, slotAcceptsKind } from "../core";
import type {
  FixtureSaveState,
  PersistenceStatus,
  SaveLoadResult,
} from "../persistence";
import type {
  CombatHudReadModel,
  EquipmentItemHudReadModel,
  InventoryHudReadModel,
  ItemEquipmentSlot,
  ItemEquipmentSlotKind,
  ItemHudReadModel,
  ItemUiCommand,
  ShellBindings,
  ShellReadModel,
} from "./shell-contracts";
import { ITEM_COMMAND_EVENT, ITEM_HUD_EVENT } from "./shell-contracts";

export interface PersistenceFixtureActions {
  save(state: FixtureSaveState): Promise<void>;
  load(): Promise<SaveLoadResult>;
  exportJson(): Promise<string>;
  importJson(serializedEnvelope: string): Promise<void>;
}

export interface AppProps {
  readonly bindings: ShellBindings;
  readonly persistenceStatus?: PersistenceStatus;
  readonly persistenceActions?: PersistenceFixtureActions;
  readonly showPersistence?: boolean;
  readonly showCombatPrototype?: boolean;
}

interface CombatVitalsProps {
  readonly model: CombatHudReadModel;
}

const EMPTY_ITEM_HUD: InventoryHudReadModel = {
  revision: 0,
  inventorySlots: Array.from({ length: 12 }, (_, index) => ({
    index,
    item: null,
  })),
  equipmentSlots: [
    { slot: "helmet", label: "Helmet", item: null },
    { slot: "chest", label: "Chest", item: null },
    { slot: "amulet", label: "Amulet", item: null },
    { slot: "belt", label: "Belt", item: null },
    { slot: "boots", label: "Boots", item: null },
    { slot: "main-hand", label: "Main hand", item: null },
    { slot: "offhand", label: "Offhand", item: null },
    { slot: "ring-1", label: "Ring 1", item: null },
    { slot: "ring-2", label: "Ring 2", item: null },
  ],
  abilityChoices: [],
  loadout: [
    {
      slot: "lmb",
      keyLabel: "LMB",
      accessibleKeyLabel: "Left click",
      abilityId: "ability:basic-cleave",
      displayName: "Basic Cleave",
      borrowedDefault: false,
    },
    {
      slot: "q",
      keyLabel: "Q",
      accessibleKeyLabel: "Q",
      abilityId: "ability:cinder-dart",
      displayName: "Cinder Dart",
      borrowedDefault: true,
    },
    {
      slot: "e",
      keyLabel: "E",
      accessibleKeyLabel: "E",
      abilityId: "ability:winter-pulse",
      displayName: "Winter Pulse",
      borrowedDefault: true,
    },
    {
      slot: "r",
      keyLabel: "R",
      accessibleKeyLabel: "R",
      abilityId: "ability:defiant-signal",
      displayName: "Defiant Signal",
      borrowedDefault: true,
    },
  ],
  playerMaximumHealth: 100,
  outgoingAbilityDamagePercent: 100,
};

type ItemSelection =
  | { readonly kind: "inventory"; readonly index: number }
  | { readonly kind: "equipment"; readonly slot: ItemEquipmentSlot };

type ItemDropTarget =
  | { readonly kind: "equipment"; readonly slot: ItemEquipmentSlot }
  | { readonly kind: "inventory-area" };

interface ItemDragState {
  readonly source: ItemSelection;
  readonly item: EquipmentItemHudReadModel;
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
  /** True once the pointer travelled far enough to count as a drag. */
  readonly active: boolean;
  readonly hover: ItemDropTarget | null;
}

/** Pointer travel in CSS pixels before a press becomes a drag. */
const DRAG_ACTIVATION_DISTANCE = 5;

function dropTargetAt(x: number, y: number): ItemDropTarget | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;
    const slot = element.dataset["dropEquipmentSlot"];
    if (slot !== undefined) {
      return { kind: "equipment", slot: slot as ItemEquipmentSlot };
    }
    if (element.dataset["dropInventory"] !== undefined) {
      return { kind: "inventory-area" };
    }
  }
  return null;
}

function dropAccepts(drag: ItemDragState, target: ItemDropTarget): boolean {
  if (target.kind === "equipment") {
    return (
      drag.source.kind === "inventory" &&
      slotAcceptsKind(target.slot, drag.item.slotKind)
    );
  }
  return drag.source.kind === "equipment";
}

interface ItemMenuProps {
  readonly model: InventoryHudReadModel;
  readonly onClose: () => void;
  readonly onCommand: (command: ItemUiCommand) => void;
}

function selectedItem(
  model: InventoryHudReadModel,
  selection: ItemSelection | null,
): ItemHudReadModel | null {
  if (selection === null) return null;
  if (selection.kind === "inventory") {
    return (
      model.inventorySlots.find(({ index }) => index === selection.index)
        ?.item ?? null
    );
  }
  return (
    model.equipmentSlots.find(({ slot }) => slot === selection.slot)?.item ??
    null
  );
}

const ITEM_SLOT_KIND_LABELS: Readonly<Record<ItemEquipmentSlotKind, string>> = {
  helmet: "Helmet",
  chest: "Chest",
  amulet: "Amulet",
  belt: "Belt",
  boots: "Boots",
  "main-hand": "Main hand",
  offhand: "Offhand",
  ring: "Ring",
};

function itemSlotLabel(slotKind: ItemEquipmentSlotKind): string {
  return ITEM_SLOT_KIND_LABELS[slotKind];
}

function ItemTooltip({ item }: { readonly item: ItemHudReadModel | null }) {
  if (item === null) {
    return (
      <aside class="item-tooltip item-tooltip-empty" aria-live="polite">
        <p>Focus or select an item to inspect it.</p>
      </aside>
    );
  }

  return (
    <aside
      class={`item-tooltip rarity-${item.rarity}`}
      aria-live="polite"
      data-testid="item-tooltip"
    >
      <p class="item-rarity">{item.rarity}</p>
      <h3>{item.displayName}</h3>
      <p>
        {item.kind === "equipment"
          ? `${itemSlotLabel(item.slotKind)} · ${item.typeLabel}`
          : `${item.typeLabel} · Stack ${item.quantity}`}
      </p>
      {item.kind === "equipment" && (
        <ul aria-label="Item modifiers">
          {item.modifiers.map((modifier) => (
            <li key={modifier.id} data-source={modifier.source}>
              <span>{modifier.source === "base" ? "Base" : "Affix"}</span>{" "}
              {modifier.label}
              {modifier.tier !== null && (
                <>
                  {" "}
                  <span
                    class="affix-tier"
                    data-tier={modifier.tier}
                    aria-label={`Tier ${modifier.tier}`}
                  >
                    T{modifier.tier}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function ItemMenu({ model, onClose, onCommand }: ItemMenuProps) {
  const [selection, setSelection] = useState<ItemSelection | null>(null);
  const [drag, setDrag] = useState<ItemDragState | null>(null);
  const item = selectedItem(model, selection);
  const inventorySlots = Array.from({ length: 12 }, (_, index) => {
    return (
      model.inventorySlots.find((slot) => slot.index === index) ?? {
        index,
        item: null,
      }
    );
  });
  const selectedInventoryIndex =
    selection?.kind === "inventory" ? selection.index : null;
  const stoneChoices = model.abilityChoices.filter(
    ({ selectableFromStone }) => selectableFromStone,
  );
  const ownedChoices = model.abilityChoices.filter(({ owned }) => owned);

  useEffect(() => {
    if (drag === null) return;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      setDrag((previous) => {
        if (previous === null) return previous;
        const active =
          previous.active ||
          Math.hypot(
            event.clientX - previous.originX,
            event.clientY - previous.originY,
          ) >= DRAG_ACTIVATION_DISTANCE;
        return {
          ...previous,
          x: event.clientX,
          y: event.clientY,
          active,
          hover: active ? dropTargetAt(event.clientX, event.clientY) : null,
        };
      });
    };
    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      if (drag.active) {
        const target = dropTargetAt(event.clientX, event.clientY);
        if (target !== null && dropAccepts(drag, target)) {
          if (target.kind === "equipment" && drag.source.kind === "inventory") {
            onCommand({
              type: "item.equip",
              inventoryIndex: drag.source.index,
              targetEquipmentSlot: target.slot,
            });
          } else if (
            target.kind === "inventory-area" &&
            drag.source.kind === "equipment"
          ) {
            onCommand({
              type: "item.unequip",
              equipmentSlot: drag.source.slot,
            });
          }
        }
      }
      setDrag(null);
    };
    const handleCancel = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      setDrag(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [drag, onCommand]);

  function beginDrag(
    event: PointerEvent,
    source: ItemSelection,
    dragged: EquipmentItemHudReadModel,
  ): void {
    if (event.button !== 0 || drag !== null) return;
    setDrag({
      source,
      item: dragged,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      hover: null,
    });
  }

  function equipmentDropClass(slot: ItemEquipmentSlot): string {
    if (drag === null || !drag.active) return "";
    const valid = dropAccepts(drag, { kind: "equipment", slot });
    const hovered =
      drag.hover?.kind === "equipment" && drag.hover.slot === slot;
    return `${valid ? " drop-valid" : " drop-invalid"}${hovered ? " drop-hover" : ""}`;
  }

  const inventoryDropClass =
    drag !== null &&
    drag.active &&
    dropAccepts(drag, { kind: "inventory-area" })
      ? `inventory-panel drop-valid${drag.hover?.kind === "inventory-area" ? " drop-hover" : ""}`
      : "inventory-panel";

  return (
    <section
      id="inventory-menu"
      class="item-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-menu-title"
      data-testid="inventory-menu"
      tabIndex={-1}
    >
      <header>
        <div>
          <p class="eyebrow">Phase 3 loadout</p>
          <h2 id="inventory-menu-title">Inventory &amp; equipment</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close inventory">
          Close <kbd>Esc</kbd>
        </button>
      </header>

      <div
        class={drag?.active ? "item-menu-layout dragging" : "item-menu-layout"}
      >
        <section
          class={inventoryDropClass}
          aria-labelledby="inventory-slots-title"
          data-drop-inventory
        >
          <h3 id="inventory-slots-title">Inventory</h3>
          <ol class="inventory-grid" aria-label="12 inventory slots">
            {inventorySlots.map((slot) => (
              <li key={slot.index}>
                <button
                  type="button"
                  class={
                    selection?.kind === "inventory" &&
                    selection.index === slot.index
                      ? "inventory-slot selected"
                      : "inventory-slot"
                  }
                  data-rarity={slot.item?.rarity}
                  aria-label={
                    slot.item === null
                      ? `Inventory slot ${slot.index + 1}, empty`
                      : `Inventory slot ${slot.index + 1}, ${slot.item.displayName}`
                  }
                  onClick={() =>
                    setSelection({ kind: "inventory", index: slot.index })
                  }
                  onFocus={() =>
                    setSelection({ kind: "inventory", index: slot.index })
                  }
                  onPointerDown={(event) => {
                    if (slot.item?.kind === "equipment") {
                      beginDrag(
                        event,
                        { kind: "inventory", index: slot.index },
                        slot.item,
                      );
                    }
                  }}
                >
                  <span>{slot.item?.displayName ?? "Empty"}</span>
                  {slot.item?.kind === "ability-stone" &&
                    slot.item.quantity > 1 && (
                      <small>×{slot.item.quantity}</small>
                    )}
                </button>
              </li>
            ))}
          </ol>
          {selection?.kind === "inventory" &&
            item?.kind === "equipment" &&
            (item.slotKind === "ring" ? (
              <div class="item-actions">
                <button
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: "item.equip",
                      inventoryIndex: selection.index,
                      targetEquipmentSlot: "ring-1",
                    })
                  }
                >
                  Equip {item.displayName} to Ring 1
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: "item.equip",
                      inventoryIndex: selection.index,
                      targetEquipmentSlot: "ring-2",
                    })
                  }
                >
                  Equip {item.displayName} to Ring 2
                </button>
              </div>
            ) : (
              <div class="item-actions">
                <button
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: "item.equip",
                      inventoryIndex: selection.index,
                    })
                  }
                >
                  Equip {item.displayName}
                </button>
              </div>
            ))}
        </section>

        <section aria-labelledby="equipment-slots-title">
          <h3 id="equipment-slots-title">Equipment</h3>
          <div class="paper-doll" role="group" aria-label="Equipped items">
            {model.equipmentSlots.map((slot) => (
              <button
                key={slot.slot}
                type="button"
                class={`equipment-slot doll-${slot.slot}${
                  selection?.kind === "equipment" &&
                  selection.slot === slot.slot
                    ? " selected"
                    : ""
                }${equipmentDropClass(slot.slot)}`}
                data-drop-equipment-slot={slot.slot}
                data-rarity={slot.item?.rarity}
                aria-label={`${slot.label}, ${slot.item?.displayName ?? "empty"}`}
                onClick={() =>
                  setSelection({ kind: "equipment", slot: slot.slot })
                }
                onFocus={() =>
                  setSelection({ kind: "equipment", slot: slot.slot })
                }
                onPointerDown={(event) => {
                  if (slot.item !== null) {
                    beginDrag(
                      event,
                      { kind: "equipment", slot: slot.slot },
                      slot.item,
                    );
                  }
                }}
              >
                <strong>{slot.label}</strong>
                <span>{slot.item?.displayName ?? "Empty"}</span>
              </button>
            ))}
          </div>
          {selection?.kind === "equipment" && item !== null && (
            <div class="item-actions">
              <button
                type="button"
                class="unequip-button"
                onClick={() =>
                  onCommand({
                    type: "item.unequip",
                    equipmentSlot: selection.slot,
                  })
                }
              >
                Unequip{" "}
                {model.equipmentSlots.find(
                  ({ slot }) => slot === selection.slot,
                )?.label ?? selection.slot}
              </button>
            </div>
          )}
        </section>

        <ItemTooltip item={item} />

        <section
          class="character-summary"
          aria-labelledby="character-summary-title"
        >
          <h3 id="character-summary-title">Character</h3>
          <dl>
            <div>
              <dt>Maximum health</dt>
              <dd>{model.playerMaximumHealth}</dd>
            </div>
            <div>
              <dt>Outgoing damage</dt>
              <dd>{model.outgoingAbilityDamagePercent}%</dd>
            </div>
          </dl>
        </section>

        {item?.kind === "ability-stone" && selectedInventoryIndex !== null && (
          <section class="stone-choice" aria-labelledby="stone-choice-title">
            <h3 id="stone-choice-title">Create an ability</h3>
            {stoneChoices.length === 0 ? (
              <p>All currently implemented abilities are owned.</p>
            ) : (
              <ul>
                {stoneChoices.map((ability) => (
                  <li key={ability.id}>
                    <button
                      type="button"
                      onClick={() =>
                        onCommand({
                          type: "item.consume-ability-stone",
                          inventoryIndex: selectedInventoryIndex,
                          abilityId: ability.id,
                        })
                      }
                    >
                      Create {ability.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section class="loadout-editor" aria-labelledby="loadout-title">
          <h3 id="loadout-title">Combat loadout</h3>
          <div class="loadout-controls">
            {model.loadout.map((assignment) => (
              <label key={assignment.slot}>
                <span>
                  <kbd>{assignment.keyLabel}</kbd>{" "}
                  <strong>{assignment.displayName}</strong>
                  {assignment.borrowedDefault && (
                    <small>Borrowed default</small>
                  )}
                </span>
                <select
                  aria-label={`Assign ${assignment.accessibleKeyLabel} ability`}
                  value={assignment.abilityId ?? ""}
                  onChange={(event) => {
                    const abilityId = event.currentTarget.value;
                    if (
                      abilityId !== "" &&
                      ownedChoices.some((choice) => choice.id === abilityId)
                    ) {
                      onCommand({
                        type: "item.assign-ability",
                        loadoutSlot: assignment.slot,
                        abilityId,
                      });
                    }
                  }}
                >
                  {assignment.abilityId !== null &&
                    !ownedChoices.some(
                      ({ id }) => id === assignment.abilityId,
                    ) && (
                      <option value={assignment.abilityId} disabled>
                        {assignment.displayName} (borrowed)
                      </option>
                    )}
                  {ownedChoices.map((ability) => (
                    <option key={ability.id} value={ability.id}>
                      {ability.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      </div>

      {drag !== null && drag.active && (
        <div
          class="drag-ghost"
          data-testid="drag-ghost"
          aria-hidden="true"
          style={{ left: `${drag.x}px`, top: `${drag.y}px` }}
        >
          {drag.item.displayName}
        </div>
      )}
    </section>
  );
}

function CombatVitals({ model }: CombatVitalsProps) {
  const healthPercent =
    model.playerMaxHealth > 0
      ? Math.max(
          0,
          Math.min(100, (model.playerHealth / model.playerMaxHealth) * 100),
        )
      : 0;
  const manaPercent =
    model.manaMaximum > 0
      ? Math.max(
          0,
          Math.min(100, (model.manaCurrent / model.manaMaximum) * 100),
        )
      : 0;
  const experiencePercent =
    model.placeholderExperienceMaximum > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (model.placeholderExperienceCurrent /
              model.placeholderExperienceMaximum) *
              100,
          ),
        )
      : 0;

  return (
    <section
      class="combat-vitals-hud"
      aria-label="Player vitals"
      data-testid="combat-vitals-hud"
    >
      <div
        class="combat-vitals-row"
        data-state={model.playerDead ? "dead" : "alive"}
      >
        <span class="combat-vitals-label">HP</span>
        <div
          class="combat-vitals-meter combat-health-meter"
          role="progressbar"
          aria-label="Player health"
          aria-valuemin={0}
          aria-valuemax={model.playerMaxHealth}
          aria-valuenow={model.playerHealth}
          aria-valuetext={`${model.playerHealth} of ${model.playerMaxHealth} health${model.playerDead ? ", defeated" : ""}`}
        >
          <span style={{ width: `${healthPercent}%` }} />
        </div>
      </div>
      <div class="combat-vitals-row">
        <span class="combat-vitals-label">MP</span>
        <div
          class="combat-vitals-meter combat-mana-meter"
          role="progressbar"
          aria-label="Player mana"
          aria-valuemin={0}
          aria-valuemax={model.manaMaximum}
          aria-valuenow={model.manaCurrent}
          aria-valuetext={`${model.manaCurrent} of ${model.manaMaximum} mana`}
        >
          <span style={{ width: `${manaPercent}%` }} />
        </div>
      </div>
      <div class="combat-vitals-row">
        <span class="combat-vitals-label">XP</span>
        <div
          class="combat-vitals-meter combat-experience-meter"
          role="progressbar"
          aria-label="Reserved experience placeholder"
          aria-valuemin={0}
          aria-valuemax={model.placeholderExperienceMaximum}
          aria-valuenow={model.placeholderExperienceCurrent}
          aria-valuetext={`${model.placeholderExperienceCurrent} of ${model.placeholderExperienceMaximum} reserved experience placeholder`}
        >
          <span style={{ width: `${experiencePercent}%` }} />
        </div>
      </div>
    </section>
  );
}

function formatSeconds(seconds: number): string {
  return `${Math.ceil(seconds * 10) / 10}s`;
}

function CombatActionBar({ model }: CombatVitalsProps) {
  return (
    <section
      class="combat-action-hud"
      aria-label="Combat abilities"
      data-testid="combat-action-hud"
    >
      <ol
        class="combat-flask-list"
        aria-label="Reserved flask slots"
        data-testid="combat-flask-slots"
      >
        {[1, 2, 3, 4].map((slot) => (
          <li
            key={slot}
            class="combat-flask-slot"
            aria-label={`Flask slot ${slot}, not implemented`}
          >
            <kbd>{slot}</kbd>
          </li>
        ))}
      </ol>
      <ol class="combat-ability-list">
        {model.abilities.map((ability) => {
          const cooldownPercent =
            ability.cooldownMaximumSeconds > 0
              ? Math.min(
                  100,
                  (ability.cooldownRemainingSeconds /
                    ability.cooldownMaximumSeconds) *
                    100,
                )
              : 0;
          const stateText =
            ability.state === "cooldown"
              ? `Cooldown ${formatSeconds(ability.cooldownRemainingSeconds)}`
              : ability.state === "executing"
                ? "Executing"
                : ability.state === "busy"
                  ? "Busy"
                  : ability.state === "insufficient-mana"
                    ? `Need ${ability.manaCost} mana`
                    : ability.state === "defeated"
                      ? "Defeated"
                      : "Ready";
          const costText =
            ability.manaCost > 0 ? `${ability.manaCost} mana` : "Free";
          const cooldownText =
            ability.cooldownMaximumSeconds > 0
              ? `${formatSeconds(ability.cooldownMaximumSeconds)} cooldown`
              : "No cooldown";

          return (
            <li
              key={ability.id}
              class="combat-ability"
              data-ability-id={ability.id}
              data-state={ability.state}
              aria-label={`${ability.accessibleKeyLabel}, ${ability.name}, ${costText}, ${cooldownText}, ${stateText}`}
            >
              <span
                class="combat-ability-cooldown"
                style={{ height: `${cooldownPercent}%` }}
                aria-hidden="true"
              />
              <div class="combat-ability-heading">
                <kbd>{ability.keyLabel}</kbd>
                <strong>{ability.name}</strong>
              </div>
              <span class="combat-ability-state">{stateText}</span>
            </li>
          );
        })}
      </ol>
      {model.activeStatuses.length > 0 && (
        <div class="combat-statuses" aria-label="Active combat effects">
          {model.activeStatuses.map((status) => (
            <span
              key={status.id}
              class="combat-status"
              data-status-id={status.id}
            >
              {status.target === "enemy" ? "Enemy " : ""}
              {status.label} {formatSeconds(status.remainingSeconds)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function App({
  bindings,
  persistenceStatus,
  persistenceActions,
  showPersistence,
  showCombatPrototype,
}: AppProps) {
  const [model, setModel] = useState<ShellReadModel>(() =>
    bindings.models.getSnapshot(),
  );
  const [counter, setCounter] = useState(1);
  const [serialized, setSerialized] = useState("");
  const [itemHud, setItemHud] = useState<InventoryHudReadModel>(EMPTY_ITEM_HUD);
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [combatHud, setCombatHud] = useState<CombatHudReadModel>({
    paused: true,
    playerHealth: 100,
    playerMaxHealth: 100,
    playerDead: false,
    manaCurrent: 100,
    manaMaximum: 100,
    placeholderExperienceCurrent: 0,
    placeholderExperienceMaximum: 100,
    abilities: [
      {
        id: "ability:basic-cleave",
        keyLabel: "LMB",
        accessibleKeyLabel: "Left click",
        name: "Basic Cleave",
        manaCost: 0,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 0,
        state: "ready",
      },
      {
        id: "ability:cinder-dart",
        keyLabel: "Q",
        accessibleKeyLabel: "Q",
        name: "Cinder Dart",
        manaCost: 15,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 0.5,
        state: "ready",
      },
      {
        id: "ability:winter-pulse",
        keyLabel: "E",
        accessibleKeyLabel: "E",
        name: "Winter Pulse",
        manaCost: 25,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 2.5,
        state: "ready",
      },
      {
        id: "ability:defiant-signal",
        keyLabel: "R",
        accessibleKeyLabel: "R",
        name: "Defiant Signal",
        manaCost: 20,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 5,
        state: "ready",
      },
    ],
    activeStatuses: [],
  });

  useLayoutEffect(
    () => bindings.models.subscribe((nextModel) => setModel(nextModel)),
    [bindings.models],
  );
  useEffect(() => {
    if (!showCombatPrototype) {
      return;
    }
    const updateHud = (event: Event) => {
      setCombatHud((event as CustomEvent<CombatHudReadModel>).detail);
    };
    window.addEventListener("rarpg:combat-hud", updateHud);
    return () => window.removeEventListener("rarpg:combat-hud", updateHud);
  }, [showCombatPrototype]);
  useEffect(() => {
    if (!showCombatPrototype) return;
    const updateItems = (event: CustomEvent<InventoryHudReadModel>) => {
      setItemHud(event.detail);
    };
    window.addEventListener(ITEM_HUD_EVENT, updateItems);
    return () => window.removeEventListener(ITEM_HUD_EVENT, updateItems);
  }, [showCombatPrototype]);
  useEffect(() => {
    if (!showCombatPrototype) return;
    const isTextEntryTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable);
    const handleMenuKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        if (itemMenuOpen) {
          event.preventDefault();
          closeItemMenu();
        }
        return;
      }
      if (event.code !== "KeyI" || event.repeat || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (isTextEntryTarget(event.target)) return;
      event.preventDefault();
      if (itemMenuOpen) {
        closeItemMenu();
      } else {
        setItemMenuOpen(true);
      }
    };
    // Capture phase: the canvas keyboard-capture adapter stops propagation of
    // canvas-focused keydowns before the bubble phase reaches window.
    window.addEventListener("keydown", handleMenuKey, true);
    return () => window.removeEventListener("keydown", handleMenuKey, true);
  }, [itemMenuOpen, showCombatPrototype]);
  useLayoutEffect(() => {
    if (itemMenuOpen) {
      document.querySelector<HTMLElement>("#inventory-menu")?.focus();
    }
  }, [itemMenuOpen]);

  function closeItemMenu(): void {
    setItemMenuOpen(false);
    document
      .querySelector<HTMLCanvasElement>("#game-canvas")
      ?.focus({ preventScroll: true });
  }

  function emitItemCommand(command: ItemUiCommand): void {
    window.dispatchEvent(
      new CustomEvent<ItemUiCommand>(ITEM_COMMAND_EVENT, { detail: command }),
    );
  }

  const fixtureState = (): FixtureSaveState => ({
    label: "Phase 0 synthetic fixture",
    counter,
    markers: [
      { id: "fixture:alpha", value: counter * 2 },
      { id: "fixture:beta", value: counter * 3 },
    ],
  });

  return (
    <main
      class={
        showCombatPrototype ? "technical-shell combat-shell" : "technical-shell"
      }
    >
      <a class="skip-link" href="#shell-controls">
        Skip canvas
      </a>
      <header class="diagnostic-shell">
        <div>
          <p class="eyebrow">
            {showCombatPrototype
              ? "RARPG Phase 3 item prototype"
              : "RARPG technical foundation"}
          </p>
          <h1>
            {showCombatPrototype
              ? "Item and loadout combat arena"
              : "UI and renderer diagnostics"}
          </h1>
        </div>
        <dl class="diagnostics" aria-label="Foundation diagnostics">
          <div>
            <dt>Core</dt>
            <dd>{FOUNDATION_ID}</dd>
          </div>
          <div>
            <dt>UI</dt>
            <dd>Preact 10.29.8</dd>
          </div>
          <div class="combat-essential-diagnostic">
            <dt>Renderer</dt>
            <dd>
              {model.phase.kind === "ready"
                ? model.phase.rendererVersion
                : "WebGL2 required"}
            </dd>
          </div>
          <div class="combat-essential-diagnostic">
            <dt>Zone</dt>
            <dd>
              {model.phase.kind === "ready"
                ? (model.phase.zoneId ?? "Loading on demand")
                : "Loading on demand"}
            </dd>
          </div>
          <div>
            <dt>Viewport</dt>
            <dd data-testid="viewport-diagnostic">
              {model.viewport.cssWidth}×{model.viewport.cssHeight} CSS /{" "}
              {model.viewport.backingWidth}×{model.viewport.backingHeight} px /{" "}
              DPR {model.viewport.devicePixelRatio}
            </dd>
          </div>
          <div>
            <dt>Intents</dt>
            <dd data-testid="intent-count">{model.emittedIntentCount}</dd>
          </div>
          <div>
            <dt>Canvas keys</dt>
            <dd data-testid="keyboard-count">{model.capturedKeyboardCount}</dd>
          </div>
        </dl>
        {model.phase.kind === "ready" && (
          <section
            class="boot-status"
            role="status"
            aria-live="polite"
            data-testid="boot-status"
          >
            Technical isometric fixture ready
          </section>
        )}
      </header>
      {model.phase.kind === "ready" && (
        <span class="visually-hidden">Foundation ready</span>
      )}

      <section class="game-region" aria-label="Renderer diagnostic">
        <div id="game-host">
          <canvas
            id="game-canvas"
            width="960"
            height="540"
            tabIndex={0}
            aria-label="RARPG Phaser diagnostic canvas"
            aria-describedby="canvas-instructions"
          >
            Renderer diagnostic requires canvas and WebGL2 support.
          </canvas>
          {model.phase.kind !== "ready" && (
            <section
              class={
                model.phase.kind === "error"
                  ? "boot-overlay error"
                  : "boot-overlay"
              }
              role={model.phase.kind === "error" ? "alert" : "status"}
              aria-live={model.phase.kind === "error" ? "assertive" : "polite"}
              data-testid="boot-overlay"
            >
              {model.phase.kind === "loading" && (
                <>
                  <strong>Loading technical renderer</strong>
                  <span>{model.phase.message}</span>
                </>
              )}
              {model.phase.kind === "error" && (
                <>
                  <strong>{model.phase.heading}</strong>
                  <span>{model.phase.detail}</span>
                  <span>
                    Update to a current desktop Chrome, Edge, or Firefox, enable
                    hardware acceleration, update graphics drivers, then reload.
                    Canvas gameplay fallback is not supported.
                  </span>
                  {model.phase.canRetry && (
                    <button
                      type="button"
                      onClick={() =>
                        bindings.intents.emit({
                          type: "shell.renderer-retry-requested",
                        })
                      }
                    >
                      Retry renderer
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </section>

      {showCombatPrototype && <CombatVitals model={combatHud} />}
      {showCombatPrototype && <CombatActionBar model={combatHud} />}
      {showCombatPrototype && (
        <button
          type="button"
          class="inventory-menu-toggle"
          aria-expanded={itemMenuOpen}
          aria-controls="inventory-menu"
          aria-keyshortcuts="I"
          onClick={() => {
            if (itemMenuOpen) {
              closeItemMenu();
            } else {
              setItemMenuOpen(true);
            }
          }}
        >
          Inventory <kbd>I</kbd>
        </button>
      )}
      {showCombatPrototype && itemMenuOpen && (
        <ItemMenu
          model={itemHud}
          onClose={closeItemMenu}
          onCommand={emitItemCommand}
        />
      )}

      {showCombatPrototype && combatHud.paused && (
        <section class="combat-paused-hud" role="status">
          <strong>PAUSED</strong>
          <span>Click the arena to resume</span>
        </section>
      )}

      <section id="shell-controls" class="shell-controls" tabIndex={-1}>
        <p id="canvas-instructions">
          {showCombatPrototype
            ? "Click the arena to play. Use left-click, Q, E, and R for assigned abilities. Press F near a drop to pick up loot. Press I anywhere outside text fields to toggle Inventory; Escape also closes it. Input pauses when interface controls have focus."
            : "Focus the canvas before using keyboard input. Tab away to keep keyboard input in the interface."}
        </p>
        <button
          type="button"
          onClick={() =>
            bindings.intents.emit({ type: "shell.diagnostic-requested" })
          }
        >
          Send diagnostic intent
        </button>
        <output>Last intent: {model.lastIntentType ?? "none"}</output>
      </section>

      {showPersistence &&
        persistenceStatus !== undefined &&
        persistenceActions !== undefined && (
          <section
            class="persistence-fixture"
            aria-labelledby="persistence-title"
          >
            <div>
              <p class="eyebrow">Synthetic state only</p>
              <h2 id="persistence-title">Persistence diagnostics</h2>
            </div>
            <label>
              Fixture counter
              <input
                data-testid="fixture-counter"
                type="number"
                min="0"
                step="1"
                value={counter}
                onInput={(event) => {
                  const next = Number(event.currentTarget.value);
                  setCounter(
                    Number.isSafeInteger(next) && next >= 0 ? next : 0,
                  );
                }}
              />
            </label>
            <div class="persistence-actions">
              <button
                type="button"
                onClick={() => {
                  void persistenceActions
                    .save(fixtureState())
                    .catch(() => undefined);
                }}
              >
                Save fixture
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistenceActions
                    .load()
                    .then((result) => {
                      setCounter(result.state.counter);
                    })
                    .catch(() => undefined);
                }}
              >
                Load fixture
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistenceActions
                    .exportJson()
                    .then(setSerialized)
                    .catch(() => undefined);
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistenceActions
                    .importJson(serialized)
                    .catch(() => undefined);
                }}
              >
                Import JSON
              </button>
            </div>
            <label>
              Validated export or import
              <textarea
                data-testid="persistence-json"
                rows={5}
                value={serialized}
                onInput={(event) => {
                  setSerialized(event.currentTarget.value);
                }}
              />
            </label>
            <p
              class={`persistence-status ${persistenceStatus.kind}`}
              role={persistenceStatus.kind === "error" ? "alert" : "status"}
              data-testid="persistence-status"
              data-status-kind={persistenceStatus.kind}
              data-error-code={
                persistenceStatus.kind === "error"
                  ? persistenceStatus.code
                  : undefined
              }
            >
              {persistenceStatus.message}
            </p>
          </section>
        )}
    </main>
  );
}
