import { contentId, type ContentId } from "./ids";
import { ENEMY_KILL_EXPERIENCE } from "./progression";
import type { SimpleMeleeEnemyConfig } from "./simple-melee-enemy";
import {
  ARENA_FORGE,
  ORE_NODE_CATALOG,
  VEINSHARD_ORE_ID,
  type ForgeDefinition,
  type OreNodeDefinition,
} from "./professions";

export const ZONE_IDS = [
  "zone:ashtrail-expanse",
  "zone:hearthmere",
  "zone:hollowdeep",
  "zone:wakeshore-landing",
] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const ASHTRAIL_EXPANSE_ID = contentId("zone:ashtrail-expanse") as ZoneId;
export const HEARTHMERE_ID = contentId("zone:hearthmere") as ZoneId;
export const HOLLOWDEEP_ID = contentId("zone:hollowdeep") as ZoneId;
export const WAKESHORE_LANDING_ID = contentId(
  "zone:wakeshore-landing",
) as ZoneId;

export const HOLLOWDEEP_BRUISER_ID = "enemy:hollowdeep-bruiser";
export const ASHTRAIL_BRUTE_ID = "enemy:ashtrail-brute";
export const EMBERCLEFT_ID = "enemy:embercleft";
export const WAKESHORE_SCUTTLER_ID = "enemy:wakeshore-scuttler";
export const ELITE_KILL_EXPERIENCE = ENEMY_KILL_EXPERIENCE * 2;
export const BOSS_KILL_EXPERIENCE = ENEMY_KILL_EXPERIENCE * 4;
export const HOLLOWDEEP_CULLING_QUEST_ID = contentId(
  "quest:hollowdeep-culling",
);
export const WICK_PROVISIONS_ID = contentId("station:wick-provisions");
export const ROADWARDEN_ID = contentId("npc:roadwarden");
export const WICK_TRAIL_VEST_OFFER_ID = contentId("vendor:wick-trail-vest");

export type ZoneKind = "town" | "wilderness" | "dungeon";

export interface PortalDefinition {
  readonly id: ContentId;
  readonly kind: "portal";
  readonly displayName: string;
  readonly destinationZoneId: ZoneId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly arrivalX: number;
  readonly arrivalY: number;
}

export interface VendorOfferDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly materialId: ContentId;
  readonly materialQuantity: number;
  readonly outputBaseId: ContentId;
}

export interface VendorDefinition {
  readonly id: ContentId;
  readonly kind: "vendor";
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly offers: readonly VendorOfferDefinition[];
}

export interface QuestGiverDefinition {
  readonly id: ContentId;
  readonly kind: "quest-giver";
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export type QuestStage = "inactive" | "accepted" | "ready" | "completed";

export interface QuestDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly targetEnemyId: string;
  readonly rewardExperience: number;
}

export interface ZoneDefinition {
  readonly id: ZoneId;
  readonly kind: ZoneKind;
  readonly displayName: string;
  readonly summary: string;
  readonly safe: boolean;
  readonly floorColor: number;
  readonly edgeColor: number;
  readonly playerSpawnX: number;
  readonly playerSpawnY: number;
  readonly enemies: readonly SimpleMeleeEnemyConfig[];
  readonly nodes: readonly OreNodeDefinition[];
  readonly forges: readonly ForgeDefinition[];
  readonly portals: readonly PortalDefinition[];
  readonly vendor?: VendorDefinition;
  readonly questGiver?: QuestGiverDefinition;
}

export const ASHTRAIL_ENEMY: SimpleMeleeEnemyConfig = {
  id: "enemy:melee-prototype",
  displayName: "Ashtrail Prototype",
  rank: "normal",
  spawnX: 860,
  spawnY: 400,
  radius: 14,
  maxHealth: 50,
  moveSpeed: 165,
  meleeRange: 54,
  attackDamage: 10,
  attackWindupTicks: 18,
  attackIntervalTicks: 60,
};

export const ASHTRAIL_PACK: readonly SimpleMeleeEnemyConfig[] = [
  {
    id: "enemy:ashtrail-gnasher-1",
    displayName: "Ashtrail Gnasher",
    rank: "normal",
    spawnX: 820,
    spawnY: 390,
    radius: 12,
    maxHealth: 32,
    moveSpeed: 170,
    meleeRange: 50,
    attackDamage: 8,
    attackWindupTicks: 16,
    attackIntervalTicks: 56,
    aggroRadius: 200,
  },
  {
    id: "enemy:ashtrail-gnasher-2",
    displayName: "Ashtrail Gnasher",
    rank: "normal",
    spawnX: 860,
    spawnY: 430,
    radius: 12,
    maxHealth: 32,
    moveSpeed: 170,
    meleeRange: 50,
    attackDamage: 8,
    attackWindupTicks: 16,
    attackIntervalTicks: 56,
    aggroRadius: 200,
  },
  {
    id: "enemy:ashtrail-gnasher-3",
    displayName: "Ashtrail Gnasher",
    rank: "normal",
    spawnX: 900,
    spawnY: 370,
    radius: 12,
    maxHealth: 32,
    moveSpeed: 170,
    meleeRange: 50,
    attackDamage: 8,
    attackWindupTicks: 16,
    attackIntervalTicks: 56,
    aggroRadius: 200,
  },
];

export const ASHTRAIL_BRUTE: SimpleMeleeEnemyConfig = {
  id: ASHTRAIL_BRUTE_ID,
  displayName: "Ashtrail Brute",
  rank: "elite",
  spawnX: 920,
  spawnY: 520,
  radius: 17,
  maxHealth: 110,
  moveSpeed: 150,
  meleeRange: 58,
  attackDamage: 14,
  attackWindupTicks: 22,
  attackIntervalTicks: 68,
  experience: ELITE_KILL_EXPERIENCE,
  aggroRadius: 220,
};

export const HOLLOWDEEP_BRUISER: SimpleMeleeEnemyConfig = {
  id: HOLLOWDEEP_BRUISER_ID,
  displayName: "Hollowdeep Bruiser",
  rank: "elite",
  spawnX: 720,
  spawnY: 400,
  radius: 18,
  maxHealth: 140,
  moveSpeed: 140,
  meleeRange: 58,
  attackDamage: 16,
  attackWindupTicks: 22,
  attackIntervalTicks: 70,
  experience: ELITE_KILL_EXPERIENCE,
  aggroRadius: 280,
};

export const EMBERCLEFT: SimpleMeleeEnemyConfig = {
  id: EMBERCLEFT_ID,
  displayName: "Embercleft",
  rank: "boss",
  spawnX: 400,
  spawnY: 650,
  radius: 22,
  maxHealth: 220,
  moveSpeed: 120,
  meleeRange: 64,
  attackDamage: 20,
  attackWindupTicks: 28,
  attackIntervalTicks: 80,
  experience: BOSS_KILL_EXPERIENCE,
  aggroRadius: 180,
};

/**
 * The one tutorial opponent: deliberately frail, slow to strike, and leashed
 * to a small aggro radius so an idle newcomer is never ambushed. Its death
 * feeds the tutorial `attack` step and the shared deterministic loot path.
 */
export const WAKESHORE_SCUTTLER: SimpleMeleeEnemyConfig = {
  id: WAKESHORE_SCUTTLER_ID,
  displayName: "Wakeshore Scuttler",
  rank: "normal",
  spawnX: 760,
  spawnY: 400,
  radius: 12,
  maxHealth: 18,
  moveSpeed: 110,
  meleeRange: 48,
  attackDamage: 2,
  attackWindupTicks: 26,
  attackIntervalTicks: 96,
  aggroRadius: 150,
};

/**
 * Tutorial-only Veinshard node. It deliberately does NOT join
 * `ORE_NODE_CATALOG`, which Ashtrail Expanse consumes wholesale; the combat
 * arena resolves gather targets from the current zone's node list.
 */
export const WAKESHORE_VEINSHARD_NODE_ID = contentId(
  "node:wakeshore-veinshard",
);
export const WAKESHORE_VEINSHARD_NODE: OreNodeDefinition = {
  id: WAKESHORE_VEINSHARD_NODE_ID,
  kind: "ore-node",
  displayName: "Veinshard Outcrop",
  materialId: VEINSHARD_ORE_ID,
  requiredMiningLevel: 1,
  experience: 8,
  yieldQuantity: 1,
  gatherSeconds: 1.2,
  charges: 4,
  respawnSeconds: 8,
  x: 420,
  y: 620,
  radius: 22,
};

export const HOLLOWDEEP_CULLING_QUEST: QuestDefinition = {
  id: HOLLOWDEEP_CULLING_QUEST_ID,
  displayName: "Hollowdeep Culling",
  summary: "Slay the Hollowdeep Bruiser and return to the Roadwarden.",
  targetEnemyId: HOLLOWDEEP_BRUISER_ID,
  rewardExperience: 40,
};

export const WICK_PROVISIONS: VendorDefinition = {
  id: WICK_PROVISIONS_ID,
  kind: "vendor",
  displayName: "Wick Provisions",
  x: 360,
  y: 400,
  radius: 26,
  offers: [
    {
      id: WICK_TRAIL_VEST_OFFER_ID,
      displayName: "Trailguard Vest",
      summary: "A stock chest traded for Veinshard Ore",
      materialId: VEINSHARD_ORE_ID,
      materialQuantity: 5,
      outputBaseId: contentId("item:trailguard-vest"),
    },
  ],
};

export const ROADWARDEN: QuestGiverDefinition = {
  id: ROADWARDEN_ID,
  kind: "quest-giver",
  displayName: "Roadwarden",
  x: 600,
  y: 400,
  radius: 26,
};

export const HEARTHMERE_FORGE: ForgeDefinition = {
  id: contentId("station:hearthmere-forge"),
  kind: "forge",
  displayName: "Hearthmere Forge",
  x: 840,
  y: 400,
  radius: 26,
};

export const ZONE_CATALOG: readonly ZoneDefinition[] = [
  {
    id: ASHTRAIL_EXPANSE_ID,
    kind: "wilderness",
    displayName: "Ashtrail Expanse",
    summary: "Open ground with ore, a field forge, and the Hollowdeep descent",
    safe: false,
    floorColor: 0x10263a,
    edgeColor: 0x64d8cb,
    playerSpawnX: 600,
    playerSpawnY: 400,
    enemies: [...ASHTRAIL_PACK, ASHTRAIL_BRUTE],
    nodes: ORE_NODE_CATALOG,
    forges: [ARENA_FORGE],
    portals: [
      {
        id: contentId("portal:ashtrail-to-hearthmere"),
        kind: "portal",
        displayName: "Hearthmere Gate",
        destinationZoneId: HEARTHMERE_ID,
        x: 80,
        y: 400,
        radius: 24,
        arrivalX: 1_040,
        arrivalY: 400,
      },
      {
        id: contentId("portal:ashtrail-to-hollowdeep"),
        kind: "portal",
        displayName: "Hollowdeep Descent",
        destinationZoneId: HOLLOWDEEP_ID,
        x: 1_120,
        y: 220,
        radius: 24,
        arrivalX: 160,
        arrivalY: 400,
      },
    ],
  },
  {
    id: HEARTHMERE_ID,
    kind: "town",
    displayName: "Hearthmere",
    summary: "A safe halt with provisions, a forge, and the Roadwarden",
    safe: true,
    floorColor: 0x2a2118,
    edgeColor: 0xe8b86d,
    playerSpawnX: 780,
    playerSpawnY: 400,
    enemies: [],
    nodes: [],
    forges: [HEARTHMERE_FORGE],
    portals: [
      {
        id: contentId("portal:hearthmere-to-ashtrail"),
        kind: "portal",
        displayName: "Ashtrail Gate",
        destinationZoneId: ASHTRAIL_EXPANSE_ID,
        x: 1_120,
        y: 400,
        radius: 24,
        arrivalX: 160,
        arrivalY: 400,
      },
    ],
    vendor: WICK_PROVISIONS,
    questGiver: ROADWARDEN,
  },
  {
    id: HOLLOWDEEP_ID,
    kind: "dungeon",
    displayName: "Hollowdeep",
    summary: "A cut stone hollow watched by the Bruiser and Embercleft",
    safe: false,
    floorColor: 0x1a1424,
    edgeColor: 0x9f7aea,
    playerSpawnX: 160,
    playerSpawnY: 400,
    enemies: [HOLLOWDEEP_BRUISER, EMBERCLEFT],
    nodes: [],
    forges: [],
    portals: [
      {
        id: contentId("portal:hollowdeep-to-ashtrail"),
        kind: "portal",
        displayName: "Ashtrail Ascent",
        destinationZoneId: ASHTRAIL_EXPANSE_ID,
        x: 80,
        y: 400,
        radius: 24,
        arrivalX: 1_040,
        arrivalY: 220,
      },
    ],
  },
  {
    id: WAKESHORE_LANDING_ID,
    kind: "wilderness",
    displayName: "Wakeshore Landing",
    summary: "A quiet shoreline where new arrivals learn the core skills",
    safe: false,
    floorColor: 0x203228,
    edgeColor: 0x8fd6b0,
    playerSpawnX: 220,
    playerSpawnY: 400,
    enemies: [WAKESHORE_SCUTTLER],
    nodes: [WAKESHORE_VEINSHARD_NODE],
    forges: [],
    portals: [
      {
        id: contentId("portal:wakeshore-to-hearthmere"),
        kind: "portal",
        displayName: "Hearthmere Road",
        destinationZoneId: HEARTHMERE_ID,
        x: 1_080,
        y: 400,
        radius: 24,
        arrivalX: 780,
        arrivalY: 400,
      },
    ],
  },
];

export function zoneById(id: ZoneId | ContentId): ZoneDefinition | undefined {
  return ZONE_CATALOG.find((zone) => zone.id === id);
}

export function vendorOfferById(
  id: ContentId,
): VendorOfferDefinition | undefined {
  return WICK_PROVISIONS.offers.find((offer) => offer.id === id);
}

export function isZoneId(value: string): value is ZoneId {
  return (ZONE_IDS as readonly string[]).includes(value);
}

export function zoneEnemies(
  zone: ZoneDefinition,
): readonly SimpleMeleeEnemyConfig[] {
  return zone.enemies;
}
