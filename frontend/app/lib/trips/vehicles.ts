/**
 * Launch vehicles for planned trips. Numbers are rounded public figures (manufacturer user guides, NASA and
 * press kits) and only approximate: each stage's thrust follows from its propellant, burn time and Isp, so the
 * rocket equation stays self-consistent. Losses to gravity, drag and steering are not modelled from first
 * principles: each vehicle's are calibrated so that it lifts exactly its published LEO payload (see launch.ts).
 */
export type PropellantKind = "RP-1 / LOX" | "LH2 / LOX" | "CH4 / LOX" | "Solid";

export type Stage = {
  name: string;
  engines: string;
  propellant: PropellantKind;
  propKg: number;
  dryKg: number;
  ispSl: number;
  ispVac: number;
  burnS: number;
  /** For drawing. */
  lengthM: number;
  diameterM: number;
  color: string;
};

export type Vehicle = {
  id: string;
  name: string;
  maker: string;
  /** Side boosters, all alike, burning from liftoff. */
  boosters?: Stage & { count: number };
  /** The first (core) stage, lit at liftoff. */
  core: Stage;
  /** Upper stage: finishes the climb to the parking orbit, then relights for the departure burn. */
  upper: Stage;
  /** How hard the core runs while the boosters burn (Falcon Heavy throttles its core down to save propellant). */
  coreThrottleWithBoosters?: number;
  fairingKg: number;
  /** Seconds after liftoff. */
  fairingSepS: number;
  fairing: { lengthM: number; diameterM: number; color: string };
  /** Published payload to a ~200 km low Earth orbit, kg, used to calibrate losses. */
  leoKg: number;
  /** Where the published LEO figure is for: the site's latitude sets how much Earth's spin helps. */
  leoReferenceSite: string;
  /** Pads it flies from (ids in launchSites.ts). */
  sites: string[];
  note?: string;
};

const WHITE = "#e9ecef";

export const VEHICLES: Vehicle[] = [
  {
    id: "falcon-9",
    name: "Falcon 9 (expendable)",
    maker: "SpaceX",
    core: { name: "First stage", engines: "9 × Merlin 1D", propellant: "RP-1 / LOX", propKg: 411_000, dryKg: 22_200, ispSl: 283, ispVac: 312, burnS: 162, lengthM: 41.2, diameterM: 3.66, color: WHITE },
    upper: { name: "Second stage", engines: "1 × Merlin 1D Vacuum", propellant: "RP-1 / LOX", propKg: 107_500, dryKg: 4_000, ispSl: 348, ispVac: 348, burnS: 397, lengthM: 13.8, diameterM: 3.66, color: WHITE },
    fairingKg: 1_900,
    fairingSepS: 195,
    fairing: { lengthM: 13.1, diameterM: 5.2, color: WHITE },
    leoKg: 22_800,
    leoReferenceSite: "ccsfs-slc-40",
    sites: ["ccsfs-slc-40", "ksc-lc-39a", "vsfb-slc-4e"],
    note: "Expendable: no propellant held back to land the first stage. Used for DART and Hera.",
  },
  {
    id: "falcon-heavy",
    name: "Falcon Heavy (expendable)",
    maker: "SpaceX",
    boosters: { count: 2, name: "Side booster", engines: "9 × Merlin 1D", propellant: "RP-1 / LOX", propKg: 411_000, dryKg: 22_200, ispSl: 283, ispVac: 312, burnS: 154, lengthM: 41.2, diameterM: 3.66, color: WHITE },
    core: { name: "Centre core", engines: "9 × Merlin 1D", propellant: "RP-1 / LOX", propKg: 411_000, dryKg: 26_000, ispSl: 283, ispVac: 312, burnS: 162, lengthM: 41.2, diameterM: 3.66, color: WHITE },
    upper: { name: "Second stage", engines: "1 × Merlin 1D Vacuum", propellant: "RP-1 / LOX", propKg: 107_500, dryKg: 4_000, ispSl: 348, ispVac: 348, burnS: 397, lengthM: 13.8, diameterM: 3.66, color: WHITE },
    coreThrottleWithBoosters: 0.55,
    fairingKg: 1_900,
    fairingSepS: 230,
    fairing: { lengthM: 13.1, diameterM: 5.2, color: WHITE },
    leoKg: 63_800,
    leoReferenceSite: "ksc-lc-39a",
    sites: ["ksc-lc-39a"],
    note: "Expendable: all three cores are used up. Launched Psyche and Europa Clipper.",
  },
  {
    id: "atlas-v-551",
    name: "Atlas V 551",
    maker: "United Launch Alliance",
    boosters: { count: 5, name: "Solid booster", engines: "AJ-60A", propellant: "Solid", propKg: 42_600, dryKg: 4_100, ispSl: 255, ispVac: 279, burnS: 94, lengthM: 20, diameterM: 1.6, color: WHITE },
    core: { name: "Common Core Booster", engines: "1 × RD-180", propellant: "RP-1 / LOX", propKg: 284_100, dryKg: 21_100, ispSl: 311, ispVac: 338, burnS: 253, lengthM: 32.5, diameterM: 3.81, color: "#c8793a" },
    upper: { name: "Centaur III", engines: "1 × RL10C-1", propellant: "LH2 / LOX", propKg: 20_800, dryKg: 2_300, ispSl: 449, ispVac: 449, burnS: 842, lengthM: 12.7, diameterM: 3.05, color: "#d9d4c7" },
    fairingKg: 3_500,
    fairingSepS: 210,
    fairing: { lengthM: 20.7, diameterM: 5.4, color: WHITE },
    leoKg: 18_850,
    leoReferenceSite: "ccsfs-slc-41",
    sites: ["ccsfs-slc-41", "vsfb-slc-3e"],
    note: "Launched New Horizons (with an extra Star 48B kick stage) and Juno.",
  },
  {
    id: "vulcan-vc6",
    name: "Vulcan Centaur VC6",
    maker: "United Launch Alliance",
    boosters: { count: 6, name: "Solid booster", engines: "GEM 63XL", propellant: "Solid", propKg: 47_000, dryKg: 6_000, ispSl: 252, ispVac: 280, burnS: 90, lengthM: 21.9, diameterM: 1.6, color: WHITE },
    core: { name: "Vulcan booster", engines: "2 × BE-4", propellant: "CH4 / LOX", propKg: 425_000, dryKg: 35_000, ispSl: 310, ispVac: 340, burnS: 264, lengthM: 33.3, diameterM: 5.4, color: "#d27c34" },
    upper: { name: "Centaur V", engines: "2 × RL10C-X", propellant: "LH2 / LOX", propKg: 54_000, dryKg: 5_800, ispSl: 453, ispVac: 453, burnS: 1_134, lengthM: 11.7, diameterM: 5.4, color: "#d9d4c7" },
    fairingKg: 4_000,
    fairingSepS: 220,
    fairing: { lengthM: 15.5, diameterM: 5.4, color: WHITE },
    leoKg: 27_200,
    leoReferenceSite: "ccsfs-slc-41",
    sites: ["ccsfs-slc-41", "vsfb-slc-3e"],
  },
  {
    id: "sls-block-1",
    name: "SLS Block 1",
    maker: "NASA / Boeing / Northrop Grumman",
    boosters: { count: 2, name: "Solid rocket booster", engines: "5-segment SRB", propellant: "Solid", propKg: 631_000, dryKg: 98_000, ispSl: 242, ispVac: 269, burnS: 126, lengthM: 54, diameterM: 3.71, color: WHITE },
    core: { name: "Core stage", engines: "4 × RS-25", propellant: "LH2 / LOX", propKg: 987_000, dryKg: 85_300, ispSl: 366, ispVac: 452, burnS: 480, lengthM: 65, diameterM: 8.4, color: "#e07b2c" },
    upper: { name: "ICPS", engines: "1 × RL10B-2", propellant: "LH2 / LOX", propKg: 27_200, dryKg: 3_500, ispSl: 465, ispVac: 465, burnS: 1_125, lengthM: 13.7, diameterM: 5.1, color: WHITE },
    fairingKg: 0,
    fairingSepS: 0,
    fairing: { lengthM: 12, diameterM: 5.1, color: WHITE },
    leoKg: 95_000,
    leoReferenceSite: "ksc-lc-39b",
    sites: ["ksc-lc-39b"],
    note: "Flies Orion without a fairing; here the payload rides on top of the ICPS. Planned to launch Europa Clipper before it moved to Falcon Heavy.",
  },
  {
    id: "ariane-64",
    name: "Ariane 64",
    maker: "ArianeGroup / ESA",
    boosters: { count: 4, name: "P120C booster", engines: "P120C", propellant: "Solid", propKg: 142_000, dryKg: 11_000, ispSl: 255, ispVac: 279, burnS: 130, lengthM: 13.5, diameterM: 3.4, color: WHITE },
    core: { name: "Core stage (LLPM)", engines: "1 × Vulcain 2.1", propellant: "LH2 / LOX", propKg: 149_000, dryKg: 14_000, ispSl: 318, ispVac: 431, burnS: 468, lengthM: 30, diameterM: 5.4, color: WHITE },
    upper: { name: "Upper stage (ULPM)", engines: "1 × Vinci", propellant: "LH2 / LOX", propKg: 31_000, dryKg: 4_500, ispSl: 457, ispVac: 457, burnS: 775, lengthM: 11.6, diameterM: 5.4, color: WHITE },
    fairingKg: 2_600,
    fairingSepS: 215,
    fairing: { lengthM: 20, diameterM: 5.4, color: WHITE },
    leoKg: 21_650,
    leoReferenceSite: "csg-ela-4",
    sites: ["csg-ela-4"],
  },
  {
    id: "long-march-5",
    name: "Long March 5",
    maker: "CALT (China)",
    boosters: { count: 4, name: "Booster", engines: "2 × YF-100", propellant: "RP-1 / LOX", propKg: 142_000, dryKg: 12_000, ispSl: 300, ispVac: 335, burnS: 173, lengthM: 27.6, diameterM: 3.35, color: WHITE },
    core: { name: "Core stage", engines: "2 × YF-77", propellant: "LH2 / LOX", propKg: 158_000, dryKg: 21_600, ispSl: 310, ispVac: 430, burnS: 480, lengthM: 33.2, diameterM: 5, color: WHITE },
    upper: { name: "Second stage", engines: "2 × YF-75D", propellant: "LH2 / LOX", propKg: 29_000, dryKg: 3_400, ispSl: 442, ispVac: 442, burnS: 710, lengthM: 11.5, diameterM: 5, color: WHITE },
    fairingKg: 2_600,
    fairingSepS: 270,
    fairing: { lengthM: 12.3, diameterM: 5.2, color: WHITE },
    leoKg: 25_000,
    leoReferenceSite: "wenchang-lc-101",
    sites: ["wenchang-lc-101"],
    note: "Launched China's Tianwen-1 to Mars in 2020.",
  },
  {
    id: "h3-24",
    name: "H3-24",
    maker: "MHI / JAXA (Japan)",
    boosters: { count: 4, name: "SRB-3 booster", engines: "SRB-3", propellant: "Solid", propKg: 66_800, dryKg: 9_700, ispSl: 255, ispVac: 283, burnS: 105, lengthM: 14.6, diameterM: 2.5, color: WHITE },
    core: { name: "First stage", engines: "2 × LE-9", propellant: "LH2 / LOX", propKg: 222_000, dryKg: 20_000, ispSl: 330, ispVac: 425, burnS: 300, lengthM: 37.2, diameterM: 5.2, color: "#f1f1ee" },
    upper: { name: "Second stage", engines: "1 × LE-5B-3", propellant: "LH2 / LOX", propKg: 23_000, dryKg: 3_000, ispSl: 448, ispVac: 448, burnS: 740, lengthM: 11.8, diameterM: 5.2, color: WHITE },
    fairingKg: 1_800,
    fairingSepS: 230,
    fairing: { lengthM: 16.4, diameterM: 5.2, color: WHITE },
    leoKg: 16_500,
    leoReferenceSite: "tanegashima-yla",
    sites: ["tanegashima-yla"],
    note: "JAXA publishes geostationary-transfer figures for H3, not low orbit; the 16.5 t to low orbit here is an estimate (H-IIB, its predecessor, lifted 16.5 t HTV cargo ships to the space station). Launches MMX to Mars's moon Phobos.",
  },
];

export const VEHICLE_BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));

export const G0 = 9.80665;

/** Propellant flow (kg/s) and thrust (kN, vacuum) of a stage, from its propellant, burn time and Isp. */
export function stageFlow(s: Stage) {
  const mdot = s.propKg / s.burnS;
  return { mdot, thrustVacKn: (mdot * s.ispVac * G0) / 1000, thrustSlKn: (mdot * s.ispSl * G0) / 1000 };
}

export function wetKg(s: Stage) {
  return s.propKg + s.dryKg;
}

/** Liftoff mass without payload. */
export function grossKg(v: Vehicle) {
  return (v.boosters ? wetKg(v.boosters) * v.boosters.count : 0) + wetKg(v.core) + wetKg(v.upper) + v.fairingKg;
}
