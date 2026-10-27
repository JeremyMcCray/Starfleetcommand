// ============================================================================
//  Static definitions: weapons, ship classes, abilities, balance constants
// ============================================================================

export const TICK = 1 / 30;            // simulation step (host)
export const SNAP_RATE = 20;           // snapshots per second sent to clients
export const MAP = 3200;               // playfield half-size is MAP/2
export const CP_INCOME = 1.3;          // command points per second
export const FLEET_CAP = 30;           // max non-strike ships per commander
export const SHIELD_REGEN_DELAY = 4.0; // seconds after last hit before shields regen

export const TEAM_COLORS = [0x4ff0ff, 0xffb547, 0xff4d7a, 0x8dff5c];
export const TEAM_NAMES = ['Azure Coalition', 'Ember Dominion'];

// --------------------------------------------------------------------------
//  Weapons
//   kind: pulse | rail | beam | torpedo | missile | flak | mortar | pd | repair | cannon
//   prefers: 'small' | 'large' | 'any'   (target preference)
// --------------------------------------------------------------------------
export const WEAPONS = {
  pulse:     { kind: 'pulse',   dmg: 7,   rof: 0.28, speed: 950,  range: 330,  prefers: 'any',   color: 0x7fe9ff, size: 1.0 },
  pulseH:    { kind: 'pulse',   dmg: 16,  rof: 0.45, speed: 850,  range: 420,  prefers: 'any',   color: 0x9fffd0, size: 1.6 },
  rail:      { kind: 'rail',    dmg: 55,  rof: 2.4,  speed: 2400, range: 760,  prefers: 'large', color: 0xfff1a8, size: 1.0 },
  railH:     { kind: 'rail',    dmg: 110, rof: 3.4,  speed: 2600, range: 900,  prefers: 'large', color: 0xffd36b, size: 1.5 },
  beam:      { kind: 'beam',    dps: 70,  dur: 1.4,  rof: 4.5,    range: 560,  prefers: 'large', color: 0xff6a4d, width: 3 },
  beamH:     { kind: 'beam',    dps: 130, dur: 1.8,  rof: 6.0,    range: 680,  prefers: 'large', color: 0xff3d6b, width: 5 },
  torpedo:   { kind: 'torpedo', dmg: 240, rof: 7.5,  speed: 190,  range: 850,  prefers: 'large', color: 0xffa040, hp: 12, turn: 1.2, aoe: 45 },
  missile:   { kind: 'missile', dmg: 34,  rof: 3.2,  speed: 480,  range: 700,  prefers: 'any',   color: 0xffe0a0, hp: 4,  turn: 3.5, salvo: 4, aoe: 25 },
  flak:      { kind: 'flak',    dmg: 18,  rof: 0.9,  speed: 760,  range: 380,  prefers: 'small', color: 0xffc070, aoe: 48 },
  mortar:    { kind: 'mortar',  dmg: 170, rof: 5.0,  speed: 330,  range: 1150, prefers: 'large', color: 0xb070ff, aoe: 80 },
  pd:        { kind: 'pd',      dmg: 5,   rof: 0.14, speed: 1500, range: 210,  prefers: 'small', color: 0xa0ffb0, size: 0.6 },
  repair:    { kind: 'repair',  hps: 28,  range: 240, color: 0x5cff9d },
  cannon:    { kind: 'cannon',  dmg: 85,  rof: 0.55, speed: 1500, range: 950,  prefers: 'large', color: 0xffffff, size: 2.2, aoe: 30 },
};

// --------------------------------------------------------------------------
//  Ship classes
//   cls: capital | escort | strike | support
//   role: anticapital | antifighter | balanced | strafer | bomber | carrier | artillery | tender
//   mounts: list of weapon mounts: { w: weaponKey, n: count, arc: 'turret'|'spinal' , off:[fwd,right] }
// --------------------------------------------------------------------------
export const SHIPS = {
  flagship: {
    name: 'Dreadnought', cls: 'capital', role: 'anticapital', size: 62, len: 150,
    hp: 9000, shield: 4500, shieldRegen: 90, speed: 48, accel: 0.55, turn: 0.22,
    range: 700, sensor: 1200, cost: 0,
    mounts: [
      { w: 'railH', n: 4, arc: 'turret' },
      { w: 'beamH', n: 2, arc: 'turret' },
      { w: 'flak', n: 4, arc: 'turret' },
      { w: 'pd', n: 6, arc: 'turret' },
      { w: 'missile', n: 2, arc: 'turret' },
      { w: 'cannon', n: 2, arc: 'spinal' },
    ],
    hangar: { type: 'fighter', max: 6, interval: 10 },
  },
  battlecruiser: {
    name: 'Battlecruiser', cls: 'capital', role: 'anticapital', size: 42, len: 105,
    hp: 4200, shield: 2000, shieldRegen: 45, speed: 58, accel: 0.6, turn: 0.3,
    range: 650, sensor: 1000, cost: 260,
    mounts: [
      { w: 'railH', n: 3, arc: 'turret' },
      { w: 'beam', n: 2, arc: 'turret' },
      { w: 'pd', n: 3, arc: 'turret' },
    ],
  },
  cruiser: {
    name: 'Cruiser', cls: 'capital', role: 'balanced', size: 32, len: 78,
    hp: 2400, shield: 1300, shieldRegen: 35, speed: 72, accel: 0.8, turn: 0.42,
    range: 560, sensor: 950, cost: 160,
    mounts: [
      { w: 'rail', n: 2, arc: 'turret' },
      { w: 'missile', n: 2, arc: 'turret' },
      { w: 'pulseH', n: 2, arc: 'turret' },
      { w: 'pd', n: 2, arc: 'turret' },
    ],
  },
  destroyer: {
    name: 'Destroyer', cls: 'escort', role: 'antifighter', size: 24, len: 58,
    hp: 1300, shield: 700, shieldRegen: 30, speed: 95, accel: 1.1, turn: 0.6,
    range: 340, sensor: 900, cost: 110,
    mounts: [
      { w: 'flak', n: 3, arc: 'turret' },
      { w: 'rail', n: 1, arc: 'turret' },
      { w: 'pd', n: 3, arc: 'turret' },
    ],
  },
  frigate: {
    name: 'Frigate', cls: 'escort', role: 'balanced', size: 18, len: 44,
    hp: 800, shield: 450, shieldRegen: 25, speed: 115, accel: 1.4, turn: 0.8,
    range: 380, sensor: 850, cost: 70,
    mounts: [
      { w: 'pulseH', n: 2, arc: 'turret' },
      { w: 'beam', n: 1, arc: 'turret' },
      { w: 'pd', n: 2, arc: 'turret' },
    ],
  },
  corvette: {
    name: 'Corvette', cls: 'escort', role: 'strafer', size: 12, len: 30,
    hp: 380, shield: 200, shieldRegen: 20, speed: 175, accel: 2.2, turn: 1.6,
    range: 260, sensor: 800, cost: 40,
    mounts: [
      { w: 'pulse', n: 3, arc: 'spinal' },
      { w: 'missile', n: 1, arc: 'turret' },
    ],
  },
  carrier: {
    name: 'Carrier', cls: 'capital', role: 'carrier', size: 40, len: 110,
    hp: 3000, shield: 1500, shieldRegen: 40, speed: 52, accel: 0.55, turn: 0.28,
    range: 400, sensor: 1100, cost: 220,
    mounts: [
      { w: 'flak', n: 2, arc: 'turret' },
      { w: 'pd', n: 5, arc: 'turret' },
    ],
    hangar: { type: 'fighter', max: 8, interval: 7, alt: 'bomber', altEvery: 3 },
  },
  artillery: {
    name: 'Siege Platform', cls: 'capital', role: 'artillery', size: 30, len: 74,
    hp: 1600, shield: 800, shieldRegen: 25, speed: 55, accel: 0.6, turn: 0.35,
    range: 1150, sensor: 1250, cost: 150,
    mounts: [
      { w: 'mortar', n: 2, arc: 'turret' },
      { w: 'pd', n: 2, arc: 'turret' },
    ],
  },
  tender: {
    name: 'Repair Tender', cls: 'support', role: 'tender', size: 20, len: 50,
    hp: 900, shield: 600, shieldRegen: 35, speed: 85, accel: 1.0, turn: 0.6,
    range: 240, sensor: 900, cost: 90,
    mounts: [
      { w: 'repair', n: 2, arc: 'turret' },
      { w: 'pd', n: 2, arc: 'turret' },
    ],
  },
  fighter: {
    name: 'Interceptor', cls: 'strike', role: 'strafer', size: 5, len: 12,
    hp: 70, shield: 30, shieldRegen: 10, speed: 260, accel: 3.0, turn: 3.2,
    range: 220, sensor: 700, cost: 0,
    mounts: [{ w: 'pulse', n: 2, arc: 'spinal' }],
  },
  bomber: {
    name: 'Bomber', cls: 'strike', role: 'bomber', size: 7, len: 16,
    hp: 140, shield: 50, shieldRegen: 10, speed: 190, accel: 2.2, turn: 2.0,
    range: 420, sensor: 800, cost: 0,
    mounts: [{ w: 'torpedo', n: 1, arc: 'spinal' }, { w: 'pulse', n: 1, arc: 'spinal' }],
  },
};

export const SHIP_KEYS = Object.keys(SHIPS);
export const SHIP_INDEX = Object.fromEntries(SHIP_KEYS.map((k, i) => [k, i]));

// Reinforcements the player can warp in (order shown in the HUD)
export const REINFORCEMENTS = ['corvette', 'frigate', 'destroyer', 'tender', 'cruiser', 'artillery', 'carrier', 'battlecruiser'];

// Flagship abilities
export const ABILITIES = {
  Q: { name: 'Shield Overcharge', cd: 30, dur: 7 },
  E: { name: 'EMP Nova',          cd: 40, radius: 380, stun: 3.5 },
  R: { name: 'Spinal Lance',      cd: 24, range: 1500, dmg: 1100, width: 34, dur: 1.1 },
  F: { name: 'Launch Wing',       cd: 32, count: 6 },
  T: { name: 'Micro-Jump',        cd: 45, range: 800 },
};

export const FORMATIONS = ['wedge', 'line', 'column', 'screen'];
export const STANCES = ['aggressive', 'defensive', 'passive'];

// Starting fleets by size option
export const START_FLEETS = {
  small:  { battlecruiser: 0, cruiser: 1, destroyer: 1, frigate: 2, corvette: 3, carrier: 0, tender: 1, artillery: 0 },
  medium: { battlecruiser: 1, cruiser: 2, destroyer: 2, frigate: 3, corvette: 4, carrier: 1, tender: 1, artillery: 1 },
  large:  { battlecruiser: 2, cruiser: 3, destroyer: 3, frigate: 4, corvette: 6, carrier: 1, tender: 2, artillery: 2 },
};

// Co-op wave composition generator
export function waveComposition(n, fleets = 1) {
  const k = 0.6 + 0.5 * fleets; // scale with number of allied fleets
  const c = {
    corvette: Math.min(22, Math.round((3 + 2 * n) * k)),
    frigate: Math.min(14, Math.round((2 + n) * k)),
    destroyer: Math.min(10, Math.round((0.5 + n * 0.7) * k)),
    cruiser: Math.min(8, Math.round(n * 0.5 * k)),
    battlecruiser: Math.min(6, Math.floor(n / 3 * k)),
    carrier: n >= 3 ? Math.min(3, Math.floor(n / 3 * k)) : 0,
    artillery: n >= 2 ? Math.min(5, Math.floor(n / 2.5 * k)) : 0,
    tender: n >= 3 ? Math.min(3, Math.floor(n / 4) + 1) : 0,
  };
  if (n % 4 === 0) c.flagship = 1; // boss wave
  return c;
}

const PREFIX = ['ISV', 'CNV', 'HMS', 'ESS', 'RNS', 'KSV'];
const NAMES = ['Aurelian', 'Vindicator', 'Halcyon', 'Tempest', 'Oberon', 'Meridian', 'Carinae', 'Vesper', 'Solace', 'Kraken', 'Lyra', 'Ironclad', 'Nocturne', 'Requiem', 'Zenith', 'Pallas', 'Hyperion', 'Corvus', 'Argent', 'Mirage', 'Valkyrie', 'Thalassa', 'Eidolon', 'Ravager', 'Seraph', 'Tiamat', 'Orion', 'Nemesis', 'Phalanx', 'Umbra'];
export function shipName(type, id) {
  const d = SHIPS[type];
  if (d.cls === 'strike') return d.name + ' ' + (id % 97);
  return PREFIX[id % PREFIX.length] + ' ' + NAMES[(id * 7) % NAMES.length];
}
