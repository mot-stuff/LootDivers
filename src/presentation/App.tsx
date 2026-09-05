import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_SUMMARIES,
  FOUNDATION_ID,
  INVENTORY_SLOT_COUNT,
  PASSIVE_CATALOG,
  experienceToNextLevel,
  slotAcceptsKind,
} from "../core";
import type {
  FixtureSaveState,
  PersistenceStatus,
  SaveLoadResult,
} from "../persistence";
import type {
  CharacterHudReadModel,
  CombatHudReadModel,
  MinimapHudMarkerReadModel,
  MinimapHudReadModel,
  EquipmentItemHudReadModel,
  InventoryHudReadModel,
  ItemEquipmentSlot,
  ItemEquipmentSlotKind,
  ItemHudReadModel,
  ItemUiCommand,
  ProfessionUiCommand,
  ProgressionUiCommand,
  WorldUiCommand,
  ShellBindings,
  ShellReadModel,
} from "./shell-contracts";
import {
  CHARACTER_HUD_EVENT,
  ITEM_COMMAND_EVENT,
  ITEM_HUD_EVENT,
  PROFESSION_COMMAND_EVENT,
  PROGRESSION_COMMAND_EVENT,
  WORLD_COMMAND_EVENT,
} from "./shell-contracts";

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

const EMPTY_MINIMAP: MinimapHudReadModel = {
  width: 1_200,
  height: 800,
  floorColor: "#10263a",
  edgeColor: "#64d8cb",
  walkable: { x: 18, y: 18, width: 1_164, height: 764 },
  markers: [],
};

const MINIMAP_VIEW_PAD = 36;

const MINIMAP_MARKER_CLASS: Readonly<
  Record<MinimapHudMarkerReadModel["kind"], string>
> = {
  player: "player",
  enemy: "enemy",
  portal: "portal",
  node: "node",
  forge: "forge",
  vendor: "vendor",
  quest: "quest",
};

const EMPTY_ITEM_HUD: InventoryHudReadModel = {
  revision: 0,
  inventorySlots: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => ({
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
  flaskSlots: [
    { slot: "flask-1", label: "Flask 1", item: null },
    { slot: "flask-2", label: "Flask 2", item: null },
    { slot: "flask-3", label: "Flask 3", item: null },
    { slot: "flask-4", label: "Flask 4", item: null },
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

const EMPTY_CHARACTER_HUD: CharacterHudReadModel = {
  revision: 0,
  level: 1,
  experienceCurrent: 0,
  experienceToNextLevel: experienceToNextLevel(1),
  unspentAttributePoints: 2,
  unspentPassivePoints: 1,
  attributes: ATTRIBUTE_IDS.map((id) => ({
    id,
    label: ATTRIBUTE_LABELS[id],
    summary: ATTRIBUTE_SUMMARIES[id],
    allocated: 0,
  })),
  passives: PASSIVE_CATALOG.map((passive) => ({
    id: passive.id,
    displayName: passive.displayName,
    summary: passive.summary,
    rank: 0,
    maximumRank: passive.maximumRank,
  })),
  maximumHealth: 100,
  maximumMana: 100,
  outgoingAbilityDamagePercent: 100,
  moveSpeedPercent: 100,
  abilityChoices: [],
  loadout: EMPTY_ITEM_HUD.loadout,
  professions: [
    {
      id: "mining",
      label: "Mining",
      level: 1,
      experienceCurrent: 0,
      experienceToNextLevel: 20,
    },
    {
      id: "smithing",
      label: "Smithing",
      level: 1,
      experienceCurrent: 0,
      experienceToNextLevel: 20,
    },
  ],
  forgeOpen: false,
  recipes: [],
  vendorOpen: false,
  vendorOffers: [],
  quest: {
    id: "quest:hollowdeep-culling",
    displayName: "Hollowdeep Culling",
    summary: "Slay the Hollowdeep Bruiser and return to the Roadwarden.",
    stage: "inactive",
  },
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

interface CharacterMenuProps {
  readonly model: CharacterHudReadModel;
  readonly onClose: () => void;
  readonly onProgressionCommand: (command: ProgressionUiCommand) => void;
  readonly onItemCommand: (command: ItemUiCommand) => void;
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
  flask: "Flask",
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
          ? `${itemSlotLabel(item.slotKind)} · ${item.typeLabel} · Requires level ${item.requiredLevel}${item.origin === "crafted" ? " · Crafted" : ""}`
          : `${item.typeLabel} · Stack ${item.quantity}`}
      </p>
      {item.kind === "material" && <p>{item.summary}</p>}
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
  const inventorySlots = Array.from(
    { length: INVENTORY_SLOT_COUNT },
    (_, index) => {
      return (
        model.inventorySlots.find((slot) => slot.index === index) ?? {
          index,
          item: null,
        }
      );
    },
  );
  const selectedInventoryIndex =
    selection?.kind === "inventory" ? selection.index : null;
  const stoneChoices = model.abilityChoices.filter(
    ({ selectableFromStone }) => selectableFromStone,
  );

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
          <p class="eyebrow">Equipment</p>
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
          <div class="inventory-grid-scroll">
            <ol
              class="inventory-grid"
              aria-label={`${INVENTORY_SLOT_COUNT} inventory slots`}
            >
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
                    {(slot.item?.kind === "ability-stone" ||
                      slot.item?.kind === "material") &&
                      slot.item.quantity > 1 && (
                        <small>×{slot.item.quantity}</small>
                      )}
                  </button>
                </li>
              ))}
            </ol>
          </div>
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
            <ol
              class="paper-doll-flasks"
              aria-label="Flask slots"
              data-testid="inventory-flask-slots"
            >
              {model.flaskSlots.map((slot, index) => (
                <li key={slot.slot}>
                  <button
                    type="button"
                    class={`equipment-slot paper-doll-flask${
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
                    <kbd>{index + 1}</kbd>
                    <strong>{slot.label}</strong>
                    <span>{slot.item?.displayName ?? "Empty"}</span>
                  </button>
                </li>
              ))}
            </ol>
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

function CharacterMenu({
  model,
  onClose,
  onProgressionCommand,
  onItemCommand,
}: CharacterMenuProps) {
  const ownedAbilities = model.abilityChoices.filter(
    (ability) => ability.owned,
  );

  return (
    <section
      id="character-menu"
      class="item-menu character-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="character-title"
      data-testid="character-menu"
      tabIndex={-1}
    >
      <header>
        <div>
          <p class="eyebrow">Phase 4 progression</p>
          <h2 id="character-title">Character</h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div class="character-menu-layout">
        <section
          class="character-summary"
          aria-labelledby="character-level-title"
        >
          <h3 id="character-level-title">Training</h3>
          <p>
            Level {model.level} · {model.experienceCurrent} /{" "}
            {model.experienceToNextLevel} XP
          </p>
          <dl class="character-derived-stats">
            <div>
              <dt>Health</dt>
              <dd>{model.maximumHealth}</dd>
            </div>
            <div>
              <dt>Mana</dt>
              <dd>{model.maximumMana}</dd>
            </div>
            <div>
              <dt>Ability damage</dt>
              <dd>{model.outgoingAbilityDamagePercent}%</dd>
            </div>
            <div>
              <dt>Move speed</dt>
              <dd>{model.moveSpeedPercent}%</dd>
            </div>
          </dl>
          <button
            type="button"
            class="respec-button"
            onClick={() => onProgressionCommand({ type: "progression.respec" })}
          >
            Restore Training
          </button>
          <h3 id="character-quest-title">Roadwarden</h3>
          <p data-testid="character-quest">
            {model.quest.displayName} · {model.quest.stage}
          </p>
          <p>{model.quest.summary}</p>
          <h3 id="character-professions-title">Professions</h3>
          <dl
            class="character-derived-stats"
            aria-labelledby="character-professions-title"
          >
            {model.professions.map((profession) => (
              <div key={profession.id}>
                <dt>
                  {profession.label} {profession.level}
                </dt>
                <dd>
                  {profession.experienceCurrent} /{" "}
                  {profession.experienceToNextLevel} XP
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="character-attributes-title">
          <h3 id="character-attributes-title">
            Attributes · {model.unspentAttributePoints} unspent
          </h3>
          <ul class="character-attribute-list">
            {model.attributes.map((attribute) => (
              <li key={attribute.id}>
                <div>
                  <strong>{attribute.label}</strong>
                  <span>{attribute.allocated}</span>
                  <p>{attribute.summary}</p>
                </div>
                <div class="character-spend-buttons">
                  <button
                    type="button"
                    aria-label={`Reduce ${attribute.label}`}
                    disabled={attribute.allocated < 1}
                    onClick={() =>
                      onProgressionCommand({
                        type: "progression.deallocate-attribute",
                        attribute: attribute.id,
                      })
                    }
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label={`Increase ${attribute.label}`}
                    disabled={model.unspentAttributePoints < 1}
                    onClick={() =>
                      onProgressionCommand({
                        type: "progression.allocate-attribute",
                        attribute: attribute.id,
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="character-passives-title">
          <h3 id="character-passives-title">
            Masteries · {model.unspentPassivePoints} unspent
          </h3>
          <ul class="character-passive-list">
            {model.passives.map((passive) => (
              <li key={passive.id}>
                <div>
                  <strong>{passive.displayName}</strong>
                  <span>
                    {passive.rank} / {passive.maximumRank}
                  </span>
                  <p>{passive.summary}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Train ${passive.displayName}`}
                  disabled={
                    model.unspentPassivePoints < 1 ||
                    passive.rank >= passive.maximumRank
                  }
                  onClick={() =>
                    onProgressionCommand({
                      type: "progression.allocate-passive",
                      passiveId: passive.id,
                    })
                  }
                >
                  Train
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="character-loadout-title">
          <h3 id="character-loadout-title">Combat loadout</h3>
          <ol class="character-loadout-list">
            {model.loadout.map((slot) => (
              <li key={slot.slot}>
                <div>
                  <kbd>{slot.keyLabel}</kbd>
                  <strong>{slot.displayName}</strong>
                  {slot.borrowedDefault && <span>Borrowed default</span>}
                </div>
                <div class="character-loadout-choices">
                  {ownedAbilities.map((ability) => (
                    <button
                      type="button"
                      key={`${slot.slot}:${ability.id}`}
                      disabled={slot.abilityId === ability.id}
                      onClick={() =>
                        onItemCommand({
                          type: "item.assign-ability",
                          loadoutSlot: slot.slot,
                          abilityId: ability.id,
                        })
                      }
                    >
                      {ability.displayName}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
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
    model.experienceToNextLevel > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (model.experienceCurrent / model.experienceToNextLevel) * 100,
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
          aria-label="Experience"
          aria-valuemin={0}
          aria-valuemax={model.experienceToNextLevel}
          aria-valuenow={model.experienceCurrent}
          aria-valuetext={`Level ${model.level}, ${model.experienceCurrent} of ${model.experienceToNextLevel} experience`}
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

function CombatActionBar({
  model,
  flasks,
}: CombatVitalsProps & {
  readonly flasks: InventoryHudReadModel["flaskSlots"];
}) {
  return (
    <section
      class="combat-action-hud"
      aria-label="Combat abilities"
      data-testid="combat-action-hud"
    >
      <ol
        class="combat-flask-list"
        aria-label="Flask slots"
        data-testid="combat-flask-slots"
      >
        {flasks.map((slot, index) => (
          <li
            key={slot.slot}
            class="combat-flask-slot"
            data-rarity={slot.item?.rarity}
            aria-label={
              slot.item === null
                ? `Flask slot ${index + 1}, empty`
                : `Flask slot ${index + 1}, ${slot.item.displayName}`
            }
          >
            <kbd>{index + 1}</kbd>
            <span>{slot.item?.displayName ?? ""}</span>
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
      {model.gatheringLabel !== null && (
        <div class="combat-gathering" data-testid="combat-gathering">
          Gathering {model.gatheringLabel}
        </div>
      )}
      <div class="combat-zone" data-testid="combat-zone">
        {model.zoneName}
        {model.questLabel !== null && ` · ${model.questLabel}`}
      </div>
    </section>
  );
}

function CombatMinimap({ model }: { readonly model: MinimapHudReadModel }) {
  const viewWidth = model.width + MINIMAP_VIEW_PAD * 2;
  const viewHeight = model.height + MINIMAP_VIEW_PAD * 2;
  return (
    <section
      class="combat-minimap"
      data-testid="combat-minimap"
      aria-label="Minimap"
    >
      <p class="combat-minimap-label">Map</p>
      <svg
        class="combat-minimap-canvas"
        viewBox={`${-MINIMAP_VIEW_PAD} ${-MINIMAP_VIEW_PAD} ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label="Zone map"
      >
        <rect
          class="combat-minimap-void"
          x={-MINIMAP_VIEW_PAD}
          y={-MINIMAP_VIEW_PAD}
          width={viewWidth}
          height={viewHeight}
        />
        <rect
          class="combat-minimap-floor"
          x={model.walkable.x}
          y={model.walkable.y}
          width={model.walkable.width}
          height={model.walkable.height}
          fill={model.floorColor}
        />
        <rect
          class="combat-minimap-bounds"
          data-testid="combat-minimap-bounds"
          x={model.walkable.x}
          y={model.walkable.y}
          width={model.walkable.width}
          height={model.walkable.height}
          fill="none"
          stroke={model.edgeColor}
        />
        {model.markers.map((marker) => (
          <circle
            key={marker.id}
            class={`combat-minimap-marker combat-minimap-marker-${MINIMAP_MARKER_CLASS[marker.kind]}${
              marker.rank !== undefined
                ? ` combat-minimap-marker-${marker.rank}`
                : ""
            }`}
            data-kind={marker.kind}
            data-rank={marker.rank}
            cx={marker.x}
            cy={marker.y}
            r={
              marker.kind === "player"
                ? 18
                : marker.rank === "boss"
                  ? 20
                  : marker.rank === "elite"
                    ? 16
                    : marker.kind === "enemy"
                      ? 12
                      : 10
            }
          />
        ))}
      </svg>
    </section>
  );
}

function VendorMenu({
  model,
  onClose,
  onCommand,
}: {
  readonly model: CharacterHudReadModel;
  readonly onClose: () => void;
  readonly onCommand: (command: WorldUiCommand) => void;
}) {
  return (
    <section
      id="vendor-menu"
      class="item-menu craft-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-title"
      data-testid="vendor-menu"
      tabIndex={-1}
    >
      <header>
        <div>
          <p class="eyebrow">Phase 6 town</p>
          <h2 id="vendor-title">Wick Provisions</h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div class="character-menu-layout">
        <section>
          <ul class="character-passive-list">
            {model.vendorOffers.map((offer) => (
              <li key={offer.id}>
                <div>
                  <strong>{offer.displayName}</strong>
                  <p>{offer.summary}</p>
                  <p>
                    {offer.materialName} {offer.owned}/{offer.required}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!offer.canBuy}
                  onClick={() =>
                    onCommand({
                      type: "world.vendor-buy",
                      offerId: offer.id,
                    })
                  }
                >
                  Trade
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function CraftMenu({
  model,
  onClose,
  onCommand,
}: {
  readonly model: CharacterHudReadModel;
  readonly onClose: () => void;
  readonly onCommand: (command: ProfessionUiCommand) => void;
}) {
  return (
    <section
      id="craft-menu"
      class="item-menu craft-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="craft-title"
      data-testid="craft-menu"
      tabIndex={-1}
    >
      <header>
        <div>
          <p class="eyebrow">Phase 5 professions</p>
          <h2 id="craft-title">Tempering Forge</h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div class="character-menu-layout">
        <section>
          <h3>
            Smithing{" "}
            {model.professions.find((p) => p.id === "smithing")?.level ?? 1}
          </h3>
          <ul class="character-passive-list">
            {model.recipes.map((recipe) => (
              <li key={recipe.id}>
                <div>
                  <strong>{recipe.displayName}</strong>
                  <p>{recipe.summary}</p>
                  <p>
                    {recipe.ingredients
                      .map(
                        (ingredient) =>
                          `${ingredient.displayName} ${ingredient.owned}/${ingredient.required}`,
                      )
                      .join(" · ")}
                  </p>
                  {recipe.blockedReason !== null && (
                    <p>{recipe.blockedReason}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!recipe.canCraft}
                  onClick={() =>
                    onCommand({
                      type: "profession.craft",
                      recipeId: recipe.id,
                    })
                  }
                >
                  Forge
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
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
  const [characterHud, setCharacterHud] =
    useState<CharacterHudReadModel>(EMPTY_CHARACTER_HUD);
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
  const [combatHud, setCombatHud] = useState<CombatHudReadModel>({
    paused: true,
    playerHealth: 100,
    playerMaxHealth: 100,
    playerDead: false,
    manaCurrent: 100,
    manaMaximum: 100,
    level: 1,
    experienceCurrent: 0,
    experienceToNextLevel: experienceToNextLevel(1),
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
    gatheringLabel: null,
    gatheringProgress: 0,
    zoneName: "Hearthmere",
    questLabel: null,
    tutorial: null,
    minimap: EMPTY_MINIMAP,
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
    const updateCharacter = (event: CustomEvent<CharacterHudReadModel>) => {
      setCharacterHud(event.detail);
    };
    window.addEventListener(CHARACTER_HUD_EVENT, updateCharacter);
    return () =>
      window.removeEventListener(CHARACTER_HUD_EVENT, updateCharacter);
  }, [showCombatPrototype]);
  // The menu key handler is a window-level capture listener, so it reads
  // menu state through a ref updated every render. Reading captured
  // closure state instead would race: a keypress landing between a menu
  // state change and the next effect re-registration would see stale
  // values and, for example, leave the menu open on Escape.
  const menuKeyStateRef = useRef({
    itemMenuOpen,
    characterMenuOpen,
    forgeOpen: characterHud.forgeOpen,
    vendorOpen: characterHud.vendorOpen,
  });
  menuKeyStateRef.current = {
    itemMenuOpen,
    characterMenuOpen,
    forgeOpen: characterHud.forgeOpen,
    vendorOpen: characterHud.vendorOpen,
  };
  useEffect(() => {
    if (!showCombatPrototype) return;
    const isTextEntryTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable);
    const handleMenuKey = (event: KeyboardEvent) => {
      const menus = menuKeyStateRef.current;
      if (event.code === "Escape") {
        if (menus.itemMenuOpen || menus.characterMenuOpen) {
          event.preventDefault();
          closeMenus();
        } else if (menus.forgeOpen) {
          event.preventDefault();
          emitProfessionCommand({ type: "profession.close-forge" });
        } else if (menus.vendorOpen) {
          event.preventDefault();
          emitWorldCommand({ type: "world.close-vendor" });
        }
        return;
      }
      if (
        (event.code !== "KeyI" && event.code !== "KeyC") ||
        event.repeat ||
        event.isComposing
      ) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (isTextEntryTarget(event.target)) return;
      event.preventDefault();
      if (event.code === "KeyI") {
        if (menuKeyStateRef.current.itemMenuOpen) closeMenus();
        else openInventoryMenu();
        return;
      }
      if (menuKeyStateRef.current.characterMenuOpen) closeMenus();
      else openCharacterMenu();
    };
    // Capture phase: the canvas keyboard-capture adapter stops propagation of
    // canvas-focused keydowns before the bubble phase reaches window.
    window.addEventListener("keydown", handleMenuKey, true);
    return () => window.removeEventListener("keydown", handleMenuKey, true);
  }, [showCombatPrototype]);
  useLayoutEffect(() => {
    if (itemMenuOpen) {
      document.querySelector<HTMLElement>("#inventory-menu")?.focus();
    } else if (characterMenuOpen) {
      document.querySelector<HTMLElement>("#character-menu")?.focus();
    } else if (characterHud.forgeOpen) {
      document.querySelector<HTMLElement>("#craft-menu")?.focus();
    } else if (characterHud.vendorOpen) {
      document.querySelector<HTMLElement>("#vendor-menu")?.focus();
    }
  }, [
    characterHud.forgeOpen,
    characterHud.vendorOpen,
    characterMenuOpen,
    itemMenuOpen,
  ]);

  function closeMenus(): void {
    setItemMenuOpen(false);
    setCharacterMenuOpen(false);
    document
      .querySelector<HTMLCanvasElement>("#game-canvas")
      ?.focus({ preventScroll: true });
  }

  function openInventoryMenu(): void {
    setCharacterMenuOpen(false);
    setItemMenuOpen(true);
  }

  function openCharacterMenu(): void {
    setItemMenuOpen(false);
    setCharacterMenuOpen(true);
  }

  function emitItemCommand(command: ItemUiCommand): void {
    window.dispatchEvent(
      new CustomEvent<ItemUiCommand>(ITEM_COMMAND_EVENT, { detail: command }),
    );
  }

  function emitProgressionCommand(command: ProgressionUiCommand): void {
    window.dispatchEvent(
      new CustomEvent<ProgressionUiCommand>(PROGRESSION_COMMAND_EVENT, {
        detail: command,
      }),
    );
  }

  function emitProfessionCommand(command: ProfessionUiCommand): void {
    window.dispatchEvent(
      new CustomEvent<ProfessionUiCommand>(PROFESSION_COMMAND_EVENT, {
        detail: command,
      }),
    );
  }

  function emitWorldCommand(command: WorldUiCommand): void {
    window.dispatchEvent(
      new CustomEvent<WorldUiCommand>(WORLD_COMMAND_EVENT, {
        detail: command,
      }),
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
              ? "RARPG Phase 6 vertical slice"
              : "RARPG technical foundation"}
          </p>
          <h1>
            {showCombatPrototype
              ? "Hearthmere world session"
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

      {showCombatPrototype && (
        <CombatActionBar model={combatHud} flasks={itemHud.flaskSlots} />
      )}
      {showCombatPrototype && <CombatMinimap model={combatHud.minimap} />}
      {showCombatPrototype && combatHud.tutorial !== null && (
        <section
          class="combat-tutorial"
          data-testid="combat-tutorial"
          aria-label="Tutorial"
          aria-live="polite"
          data-step-id={combatHud.tutorial.stepId}
        >
          <p class="combat-tutorial-heading">
            Tutorial · Step {combatHud.tutorial.stepsCompleted + 1} of{" "}
            {combatHud.tutorial.totalSteps}
          </p>
          <p
            class="combat-tutorial-prompt"
            data-testid="combat-tutorial-prompt"
          >
            {combatHud.tutorial.prompt}
          </p>
        </section>
      )}
      {showCombatPrototype && (
        <div class="combat-vitals-stack" data-testid="combat-vitals-stack">
          <div class="combat-menu-toggles">
            <button
              type="button"
              class="inventory-menu-toggle"
              aria-expanded={itemMenuOpen}
              aria-controls="inventory-menu"
              aria-keyshortcuts="I"
              onClick={() => {
                if (itemMenuOpen) closeMenus();
                else openInventoryMenu();
              }}
            >
              Inventory <kbd>I</kbd>
            </button>
            <button
              type="button"
              class="character-menu-toggle"
              aria-expanded={characterMenuOpen}
              aria-controls="character-menu"
              aria-keyshortcuts="C"
              onClick={() => {
                if (characterMenuOpen) closeMenus();
                else openCharacterMenu();
              }}
            >
              Character <kbd>C</kbd>
            </button>
          </div>
          <CombatVitals model={combatHud} />
        </div>
      )}
      {showCombatPrototype && itemMenuOpen && (
        <ItemMenu
          model={itemHud}
          onClose={closeMenus}
          onCommand={emitItemCommand}
        />
      )}
      {showCombatPrototype && characterMenuOpen && (
        <CharacterMenu
          model={characterHud}
          onClose={closeMenus}
          onProgressionCommand={emitProgressionCommand}
          onItemCommand={emitItemCommand}
        />
      )}
      {showCombatPrototype && characterHud.forgeOpen && (
        <CraftMenu
          model={characterHud}
          onClose={() =>
            emitProfessionCommand({ type: "profession.close-forge" })
          }
          onCommand={emitProfessionCommand}
        />
      )}
      {showCombatPrototype && characterHud.vendorOpen && (
        <VendorMenu
          model={characterHud}
          onClose={() => emitWorldCommand({ type: "world.close-vendor" })}
          onCommand={emitWorldCommand}
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
            ? "Click the arena to play. Use left-click, Q, E, and R for assigned abilities. Press F to pick up loot, gather, open the forge or vendor, talk to the Roadwarden, or take a gate. Gates connect Hearthmere, Ashtrail Expanse, and Hollowdeep. Press I to toggle Inventory and C to toggle Character; Escape closes the open menu."
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
