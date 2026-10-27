// ============================================================================
//  Authoritative simulation. Runs on the host (and in single player).
//  Pure data; no rendering. Produces compact snapshots for clients.
// ============================================================================
import { TICK, MAP, CP_INCOME, FLEET_CAP, SHIELD_REGEN_DELAY, WEAPONS, SHIPS, SHIP_INDEX, ABILITIES, START_FLEETS, waveComposition, shipName } from './defs.js';
import { shipBehavior, commanderThink, formationSlots } from './ai.js';

export const PROJ_KINDS = ['pulse', 'rail', 'torpedo', 'missile', 'flak', 'mortar', 'cannon'];
export const BEAM_KINDS = ['beam', 'beamH', 'repair', 'pd', 'lance'];
const PK = Object.fromEntries(PROJ_KINDS.map((k, i) => [k, i]));
const BK = Object.fromEntries(BEAM_KINDS.map((k, i) => [k, i]));

export const F_DEAD = 1, F_STUN = 2, F_OVER = 4, F_DIRECT = 8, F_WARPIN = 16;

// Seeded RNG so hosts are reproducible-ish
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// --------------------------------------------------------------------------
//  Spatial hash for ships
// --------------------------------------------------------------------------
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  insert(s) { const cx = Math.floor(s.x / this.cell), cy = Math.floor(s.y / this.cell); const k = this.key(cx, cy); let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); } a.push(s); }
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const a = this.map.get(this.key(cx, cy)); if (a) for (const s of a) out.push(s); }
    return out;
  }
}

export class Sim {
  constructor(opts) {
    this.mode = opts.mode || 'coop';
    this.fleetSize = opts.fleetSize || 'medium';
    this.rand = mulberry32(opts.seed || 12345);
    this.t = 0; this.tick = 0; this.nextId = 1;
    this.ships = new Map(); this.projectiles = new Map();
    this.players = new Map();
    this.events = []; this.beams = [];
    this.grid = new Grid(240); this._q = [];
    this.wave = 0; this.nextWaveT = 45; this.maxWaves = 12;
    this.over = null;
    this.scores = [0, 0];
    this.winCheckT = 2;
    this.totalKills = 0;

    for (const p of opts.players) this.addPlayer(p);
    if (this.mode === 'coop') this.addPlayer({ id: 'enemy', name: 'Dominion Armada', team: 1, isAI: true, noFlagship: true });
    this.setupBattlefield();
  }

  // ---------------------------------------------------------------- players
  addPlayer(p) {
    this.players.set(p.id, {
      id: p.id, name: p.name, team: p.team, isAI: !!p.isAI, noFlagship: !!p.noFlagship,
      flagshipId: 0, cp: 120, kills: 0, alive: true, direct: false,
      input: { thrust: 0, turn: 0, ax: 0, ay: 0, fire: false },
      cds: { Q: 0, E: 0, R: 0, F: 0, T: 0 }, over: 0,
      ai: { think: this.rand() * 2, mood: 'build' },
    });
  }

  setupBattlefield() {
    const teams = [[], []];
    for (const p of this.players.values()) if (!p.noFlagship) teams[p.team].push(p);
    for (let t = 0; t < 2; t++) {
      const list = teams[t]; if (!list.length) continue;
      const bx = this.mode === 'coop' ? -MAP * 0.28 : (t === 0 ? -MAP * 0.32 : MAP * 0.32);
      const rot = t === 0 ? 0 : Math.PI;
      list.forEach((p, i) => {
        const by = (i - (list.length - 1) / 2) * 520;
        this.spawnFleet(p, bx, by, rot, START_FLEETS[this.fleetSize]);
      });
    }
  }

  spawnFleet(p, x, y, rot, comp) {
    const flag = this.spawnShip('flagship', p.team, p.id, x, y, rot);
    p.flagshipId = flag.id;
    const list = [];
    for (const [type, n] of Object.entries(comp)) for (let i = 0; i < n; i++) list.push(type);
    list.sort((a, b) => SHIPS[b].size - SHIPS[a].size);
    const slots = formationSlots('wedge', list.map(t => SHIPS[t].size), 1.0);
    list.forEach((type, i) => {
      const sl = slots[i];
      // formation forward = rot; slot fwd/right in formation space
      const px = x + (-sl.f - 180) * Math.cos(rot) - sl.r * Math.sin(rot);
      const py = y + (-sl.f - 180) * Math.sin(rot) + sl.r * Math.cos(rot);
      const s = this.spawnShip(type, p.team, p.id, px, py, rot);
      s.order = { t: 'escort', tid: flag.id }; s.fx = -sl.f - 180; s.fy = sl.r;
    });
  }

  // ------------------------------------------------------------------ ships
  spawnShip(type, team, owner, x, y, rot, extra) {
    const d = SHIPS[type]; const id = this.nextId++;
    const s = {
      id, type, d, team, owner, x, y, rot: rot || 0, vx: 0, vy: 0,
      hp: d.hp, shield: d.shield, shieldCd: 0, maxShield: d.shield,
      cd: d.mounts.map(() => this.rand() * 1.5), beam: d.mounts.map(() => null),
      order: { t: 'idle' }, stance: 'aggressive', formation: 'wedge', fx: 0, fy: 0,
      target: 0, tgtT: this.rand() * 0.5, dest: null, want: 1, face: 0, throttle: 0,
      dead: false, dieT: 0, stun: 0, over: 0, warp: 0.0,
      ai: { phase: 0, t: 0, side: this.rand() < 0.5 ? -1 : 1 },
      hangarT: d.hangar ? d.hangar.interval * 0.5 : 0, hangarN: 0, parent: 0,
      lastHitBy: null, ...extra,
    };
    this.ships.set(id, s);
    return s;
  }

  warpIn(type, team, owner, x, y, rot, extra) {
    const s = this.spawnShip(type, team, owner, x, y, rot, extra);
    s.warp = 1.4; // seconds of warp-in (invulnerable, no fire)
    this.events.push({ e: 'warp', x, y, s: s.d.size });
    return s;
  }

  // ------------------------------------------------------------------ input
  command(pid, c) {
    const p = this.players.get(pid); if (!p) return;
    const own = (id) => { const s = this.ships.get(id); return s && s.owner === pid && !s.dead ? s : null; };
    switch (c.t) {
      case 'order': {
        const ships = (c.ids || []).map(own).filter(Boolean); if (!ships.length) return;
        this.issueOrder(ships, c.o);
        break;
      }
      case 'formation': for (const id of c.ids || []) { const s = own(id); if (s) s.formation = c.f; } break;
      case 'stance': for (const id of c.ids || []) { const s = own(id); if (s) s.stance = c.s; } break;
      case 'ability': this.useAbility(p, c.k, c.x, c.y); break;
      case 'rein': this.reinforce(p, c.type); break;
      case 'direct': { p.direct = !!c.on; const f = this.ships.get(p.flagshipId); if (f && !p.direct) { f.order = { t: 'hold' }; } break; }
      case 'input': p.input = { thrust: clamp(+c.th || 0, -1, 1), turn: clamp(+c.tu || 0, -1, 1), ax: +c.ax || 0, ay: +c.ay || 0, fire: !!c.f }; break;
    }
  }

  issueOrder(ships, o) {
    if (!o) return;
    if (o.t === 'move' || o.t === 'amove') {
      // formation move: compute slots around the destination
      const cx = ships.reduce((a, s) => a + s.x, 0) / ships.length, cy = ships.reduce((a, s) => a + s.y, 0) / ships.length;
      const ang = Math.atan2(o.y - cy, o.x - cx);
      ships.sort((a, b) => b.d.size - a.d.size);
      const slots = formationSlots(ships[0].formation, ships.map(s => s.d.size), 1.0);
      ships.forEach((s, i) => {
        const sl = ships.length > 1 ? slots[i] : { f: 0, r: 0 };
        const dx = o.x + sl.f * Math.cos(ang) - sl.r * Math.sin(ang);
        const dy = o.y + sl.f * Math.sin(ang) + sl.r * Math.cos(ang);
        s.order = { t: o.t, x: dx, y: dy }; s.ai.phase = 0;
      });
    } else if (o.t === 'escort') {
      const tgt = this.ships.get(o.tid); if (!tgt || tgt.dead) return;
      const list = ships.filter(s => s.id !== tgt.id); if (!list.length) return;
      list.sort((a, b) => b.d.size - a.d.size);
      const slots = formationSlots(list[0].formation, list.map(s => s.d.size), 1.0);
      const back = tgt.d.size + 120;
      list.forEach((s, i) => { s.order = { t: 'escort', tid: tgt.id }; s.fx = -slots[i].f - back; s.fy = slots[i].r; });
    } else if (o.t === 'attack') {
      const tgt = this.ships.get(o.tid); if (!tgt || tgt.dead) return;
      for (const s of ships) { s.order = { t: 'attack', tid: tgt.id }; s.target = tgt.id; s.ai.phase = 0; }
    } else if (o.t === 'hold') {
      for (const s of ships) s.order = { t: 'hold', x: s.x, y: s.y };
    } else if (o.t === 'stop') {
      for (const s of ships) s.order = { t: 'idle' };
    }
  }

  reinforce(p, type) {
    const d = SHIPS[type]; if (!d || !d.cost || p.cp < d.cost) return;
    const f = this.ships.get(p.flagshipId); if (!f || f.dead) return;
    let n = 0; for (const s of this.ships.values()) if (s.owner === p.id && !s.dead && s.d.cls !== 'strike') n++;
    if (n >= FLEET_CAP) { if (!p.isAI) this.events.push({ e: 'msg', text: 'FLEET AT MAXIMUM STRENGTH', kind: 'warn', pid: p.id }); return; }
    p.cp -= d.cost;
    const a = this.rand() * Math.PI * 2, r = f.d.size + 200 + this.rand() * 120;
    const s = this.warpIn(type, p.team, p.id, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, f.rot);
    s.order = { t: 'escort', tid: f.id }; s.fx = -220 - this.rand() * 120; s.fy = (this.rand() - 0.5) * 300;
    this.events.push({ e: 'msg', team: p.team, text: `${d.name.toUpperCase()} WARPING IN`, kind: 'good', pid: p.id });
  }

  useAbility(p, k, x, y) {
    const A = ABILITIES[k]; if (!A || p.cds[k] > 0) return;
    const f = this.ships.get(p.flagshipId); if (!f || f.dead || f.stun > 0) return;
    p.cds[k] = A.cd;
    switch (k) {
      case 'Q': f.over = A.dur; f.shield = Math.min(f.maxShield * 1.5, f.shield + f.maxShield * 0.5); this.events.push({ e: 'over', id: f.id }); break;
      case 'E': {
        this.events.push({ e: 'emp', x: f.x, y: f.y, r: A.radius });
        for (const s of this.ships.values()) if (s.team !== f.team && !s.dead && Math.hypot(s.x - f.x, s.y - f.y) < A.radius + s.d.size) { s.stun = Math.max(s.stun, A.stun); s.shield = 0; s.shieldCd = SHIELD_REGEN_DELAY * 2; }
        for (const [id, pr] of this.projectiles) if (pr.team !== f.team && Math.hypot(pr.x - f.x, pr.y - f.y) < A.radius) { this.projectiles.delete(id); this.events.push({ e: 'exp', x: pr.x, y: pr.y, s: 6, k: 0 }); }
        break;
      }
      case 'R': {
        const ang = Math.atan2(y - f.y, x - f.x);
        const x2 = f.x + Math.cos(ang) * A.range, y2 = f.y + Math.sin(ang) * A.range;
        this.beams.push({ k: 'lance', x1: f.x, y1: f.y, x2, y2, t: A.dur, src: f.id });
        f.lance = { ang, t: A.dur };
        // damage everything along the line (enemies), falloff with distance
        for (const s of this.ships.values()) {
          if (s.team === f.team || s.dead) continue;
          const dx = s.x - f.x, dy = s.y - f.y; const along = dx * Math.cos(ang) + dy * Math.sin(ang);
          if (along < 0 || along > A.range) continue;
          const perp = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang));
          if (perp < A.width + s.d.size) { this.damage(s, A.dmg * (1 - along / A.range * 0.4), f, s.x, s.y); this.events.push({ e: 'exp', x: s.x, y: s.y, s: 18, k: 1 }); }
        }
        for (const [id, pr] of this.projectiles) { const dx = pr.x - f.x, dy = pr.y - f.y; const along = dx * Math.cos(ang) + dy * Math.sin(ang); const perp = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)); if (along > 0 && along < A.range && perp < A.width && pr.team !== f.team) this.projectiles.delete(id); }
        break;
      }
      case 'F': {
        for (let i = 0; i < A.count; i++) {
          const a = f.rot + (this.rand() - 0.5) * 2, r = f.d.size + 30 + this.rand() * 60;
          const s = this.warpIn('fighter', f.team, p.id, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, f.rot, { parent: f.id });
          s.warp = 0.4; s.order = { t: 'escort', tid: f.id }; s.fx = -40 - i * 25; s.fy = (i % 2 ? 1 : -1) * (60 + i * 15);
        }
        this.events.push({ e: 'msg', team: p.team, text: 'INTERCEPTOR WING LAUNCHED', kind: 'good', pid: p.id });
        break;
      }
      case 'T': {
        let dx = x - f.x, dy = y - f.y; const dist = Math.hypot(dx, dy) || 1;
        const r = Math.min(dist, A.range); dx = dx / dist * r; dy = dy / dist * r;
        this.events.push({ e: 'jump', x1: f.x, y1: f.y, x2: f.x + dx, y2: f.y + dy, s: f.d.size });
        f.x += dx; f.y += dy; f.vx *= 0.3; f.vy *= 0.3; f.warp = 0.5;
        // shove enemies at the arrival point
        for (const s of this.ships.values()) if (s.team !== f.team && !s.dead) { const ex = s.x - f.x, ey = s.y - f.y, ed = Math.hypot(ex, ey); if (ed < f.d.size + s.d.size + 40) { this.damage(s, 120, f, s.x, s.y); s.vx += ex / ed * 200; s.vy += ey / ed * 200; } }
        break;
      }
    }
  }

  // ----------------------------------------------------------------- damage
  damage(s, amt, src, hx, hy) {
    if (s.dead || s.warp > 0) return;
    if (s.over > 0) amt *= 0.5;
    if (s.shield > 0) {
      const a = Math.min(s.shield, amt); s.shield -= a; amt -= a;
      if (a > 0 && (this.tick & 1)) this.events.push({ e: 'sh', id: s.id, x: hx, y: hy });
    }
    s.shieldCd = SHIELD_REGEN_DELAY;
    if (amt > 0) { s.hp -= amt; if (amt > 20 || this.rand() < 0.3) this.events.push({ e: 'exp', x: hx, y: hy, s: 3 + Math.min(12, amt / 15), k: 0 }); }
    if (src && src.owner) s.lastHitBy = src.owner;
    if (s.hp <= 0) this.kill(s);
  }

  kill(s) {
    if (s.dead) return;
    s.dead = true; s.hp = 0; s.shield = 0;
    s.dieT = s.d.size >= 24 ? 1.0 + s.d.size / 35 : 0;
    const killerP = s.lastHitBy ? this.players.get(s.lastHitBy) : null;
    if (killerP && killerP.team !== s.team) { killerP.kills++; killerP.cp += Math.round(s.d.cost * 0.4) + (s.d.cls === 'strike' ? 4 : 15); }
    if (killerP) this.scores[killerP.team] += s.d.cls === 'strike' ? 1 : Math.round(s.d.cost / 10) + 5;
    this.totalKills++;
    if (s.d.cls !== 'strike') this.events.push({ e: 'kill', n: shipName(s.type, s.id), type: s.type, team: s.team, big: s.d.size >= 40 });
    if (s.type === 'flagship') {
      const p = this.players.get(s.owner); if (p && p.flagshipId === s.id) { p.alive = false; p.direct = false; }
      this.events.push({ e: 'msg', text: `${(p ? p.name : 'ENEMY').toUpperCase()}'S DREADNOUGHT IS GOING DOWN`, kind: 'warn', all: true });
    }
    if (s.dieT === 0) this.finishDeath(s);
  }

  finishDeath(s) {
    this.events.push({ e: 'exp', x: s.x, y: s.y, s: s.d.size, k: s.d.size >= 24 ? 2 : 1, team: s.team });
    this.ships.delete(s.id);
    if (s.d.size >= 40) { // shockwave damage to everything nearby
      const r = s.d.size * 3;
      for (const o of this.ships.values()) if (!o.dead) { const d = Math.hypot(o.x - s.x, o.y - s.y); if (d < r) { this.damage(o, (1 - d / r) * s.d.size * 4, null, o.x, o.y); o.vx += (o.x - s.x) / (d || 1) * 60; o.vy += (o.y - s.y) / (d || 1) * 60; } }
    }
  }

  // ------------------------------------------------------------------- step
  step() {
    const dt = TICK; this.t += dt; this.tick++;
    this.beams = this.beams.filter(b => { b.t -= dt; return b.t > 0 && b.k === 'lance'; });
    this.grid.clear(); for (const s of this.ships.values()) if (!s.dead) this.grid.insert(s);

    // players: cooldowns, cp, commander AI
    for (const p of this.players.values()) {
      for (const k in p.cds) if (p.cds[k] > 0) p.cds[k] -= dt;
      if (p.alive && !p.noFlagship) p.cp += CP_INCOME * dt;
      if (p.isAI) { p.ai.think -= dt; if (p.ai.think <= 0) { p.ai.think = 2 + this.rand(); commanderThink(this, p); } }
    }

    for (const s of this.ships.values()) {
      if (s.dead) { this.updateDying(s, dt); continue; }
      if (s.warp > 0) { s.warp -= dt; if (s.warp > 0.3) continue; }
      if (s.stun > 0) s.stun -= dt;
      if (s.over > 0) s.over -= dt;
      if (s.shieldCd > 0) s.shieldCd -= dt; else if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + s.d.shieldRegen * dt);
      if (s.over <= 0 && s.shield > s.maxShield) s.shield = Math.max(s.maxShield, s.shield - s.maxShield * 0.2 * dt);
      if (s.lance) { s.lance.t -= dt; if (s.lance.t <= 0) s.lance = null; }

      // Targeting cache
      s.tgtT -= dt; if (s.tgtT <= 0) { s.tgtT = 0.35 + this.rand() * 0.2; this.refreshTargets(s); }

      const p = this.players.get(s.owner);
      if (s.type === 'flagship' && p && p.direct && p.alive) this.directControl(s, p, dt);
      else { if (s.stun <= 0) shipBehavior(this, s, dt); else { s.dest = null; s.want = 0; } this.steer(s, dt); }

      if (s.stun <= 0 && s.warp <= 0) this.fireWeapons(s, dt);
      this.updateHangar(s, dt);
    }

    this.separation();
    this.updateProjectiles(dt);
    this.waves(dt);

    this.winCheckT -= dt; if (this.winCheckT <= 0) { this.winCheckT = 1; this.checkWin(); }
  }

  updateDying(s, dt) {
    s.dieT -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.98; s.vy *= 0.98; s.rot += 0.1 * dt;
    if (this.rand() < dt * (4 + s.d.size / 10)) { const a = this.rand() * Math.PI * 2, r = this.rand() * s.d.size * 0.8; this.events.push({ e: 'exp', x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r, s: 6 + this.rand() * s.d.size * 0.35, k: 1 }); }
    if (s.dieT <= 0) this.finishDeath(s);
  }

  refreshTargets(s) {
    const q = this.grid.query(s.x, s.y, s.d.sensor, this._q);
    let bS = null, bL = null, dS = 1e9, dL = 1e9, bA = null, dA = 1e9;
    for (const o of q) {
      if (o.team === s.team || o.dead || o.warp > 0.3) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y); if (d > s.d.sensor) continue;
      const small = o.d.size < 16;
      const score = d - (o.type === 'flagship' ? 150 : 0);
      if (small) { if (score < dS) { dS = score; bS = o; } } else { if (score < dL) { dL = score; bL = o; } }
      if (score < dA) { dA = score; bA = o; }
    }
    s.nearSmall = bS ? bS.id : 0; s.nearLarge = bL ? bL.id : 0; s.nearAny = bA ? bA.id : 0; s.nearDist = dA;
    // most damaged ally in range (for tenders)
    if (s.d.role === 'tender') {
      let best = null, bd = 0;
      for (const o of q) { if (o.team !== s.team || o.dead || o.id === s.id) continue; const miss = (o.d.hp - o.hp) / o.d.hp; const dist = Math.hypot(o.x - s.x, o.y - s.y); const sc = miss * (1 + o.d.size / 30) - dist / 2000; if (miss > 0.05 && sc > bd) { bd = sc; best = o; } }
      s.repairTarget = best ? best.id : 0;
    }
  }

  // --------------------------------------------------------------- movement
  directControl(s, p, dt) {
    const d = s.d, inp = p.input;
    s.rot += inp.turn * d.turn * 1.4 * dt;
    const spd = inp.thrust * d.speed * (inp.thrust < 0 ? 0.5 : 1);
    const k = Math.min(1, d.accel * dt);
    s.vx += (Math.cos(s.rot) * spd - s.vx) * k; s.vy += (Math.sin(s.rot) * spd - s.vy) * k;
    s.x += s.vx * dt; s.y += s.vy * dt; s.throttle = Math.abs(inp.thrust);
    s.dest = null; s.aim = { x: inp.ax, y: inp.ay }; s.fireManual = inp.fire;
    // Aim-target for turrets: nearest enemy to the cursor
    let best = 0, bd = 160;
    for (const o of this.grid.query(inp.ax, inp.ay, 160, this._q)) { if (o.team === s.team || o.dead) continue; const dd = Math.hypot(o.x - inp.ax, o.y - inp.ay) - o.d.size; if (dd < bd) { bd = dd; best = o.id; } }
    s.aimTarget = best;
    this.bound(s);
  }

  steer(s, dt) {
    const d = s.d; let targetSpeed = 0;
    if (s.dest) {
      const dx = s.dest.x - s.x, dy = s.dest.y - s.y, dist = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx); const diff = angDiff(s.rot, want);
      const turn = d.turn * (s.d.cls === 'strike' ? 1 : 0.6 + 0.4 * Math.min(1, Math.hypot(s.vx, s.vy) / d.speed + 0.3));
      s.rot += clamp(diff, -turn * dt, turn * dt);
      const facing = Math.max(d.cls === 'strike' ? 0.4 : 0.05, Math.cos(diff));
      const arrive = Math.min(1, dist / (s.arriveR || 80));
      targetSpeed = d.speed * s.want * facing * arrive;
    } else if (s.face) {
      const diff = angDiff(s.rot, s.face); s.rot += clamp(diff, -d.turn * dt, d.turn * dt);
    }
    const k = Math.min(1, d.accel * dt);
    s.vx += (Math.cos(s.rot) * targetSpeed - s.vx) * k; s.vy += (Math.sin(s.rot) * targetSpeed - s.vy) * k;
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.throttle = Math.min(1, Math.hypot(s.vx, s.vy) / d.speed);
    this.bound(s);
  }

  bound(s) { const L = MAP / 2; if (s.x < -L) { s.x = -L; s.vx = Math.abs(s.vx) * 0.5; } if (s.x > L) { s.x = L; s.vx = -Math.abs(s.vx) * 0.5; } if (s.y < -L) { s.y = -L; s.vy = Math.abs(s.vy) * 0.5; } if (s.y > L) { s.y = L; s.vy = -Math.abs(s.vy) * 0.5; } }

  separation() {
    const q = this._q;
    for (const s of this.ships.values()) {
      if (s.dead || s.d.cls === 'strike') continue;
      this.grid.query(s.x, s.y, s.d.size * 2 + 60, q);
      for (const o of q) {
        if (o === s || o.dead || o.d.cls === 'strike' || o.id < s.id) continue;
        const dx = o.x - s.x, dy = o.y - s.y, dist = Math.hypot(dx, dy) || 0.01, min = (s.d.size + o.d.size) * 0.95;
        if (dist < min) {
          const push = (min - dist) * 0.5, nx = dx / dist, ny = dy / dist;
          const ws = o.d.size / (s.d.size + o.d.size), wo = 1 - ws; // lighter ship moves more
          s.x -= nx * push * ws; s.y -= ny * push * ws; o.x += nx * push * wo; o.y += ny * push * wo;
          if (s.team !== o.team && (s.d.cls === 'capital' || o.d.cls === 'capital') && this.tick % 10 === 0) { this.damage(s, 4, o, s.x + nx * s.d.size, s.y + ny * s.d.size); this.damage(o, 4, s, o.x - nx * o.d.size, o.y - ny * o.d.size); }
        }
      }
    }
  }

  // ---------------------------------------------------------------- weapons
  pickTarget(s, w, mount) {
    const pref = w.prefers;
    // explicit targets first
    const cand = [];
    if (s.aimTarget) cand.push(s.aimTarget);
    if (s.target) cand.push(s.target);
    if (pref === 'small') { cand.push(s.nearSmall, s.nearAny); } else if (pref === 'large') { cand.push(s.nearLarge, s.nearAny); } else { cand.push(s.nearAny, s.nearSmall, s.nearLarge); }
    for (const id of cand) {
      if (!id) continue; const o = this.ships.get(id); if (!o || o.dead || o.team === s.team || o.warp > 0.3) continue;
      const dist = Math.hypot(o.x - s.x, o.y - s.y) - o.d.size;
      if (dist > w.range) continue;
      if (pref === 'small' && o.d.size >= 24 && w.kind === 'flak' && cand.length > 2 && id !== s.target) continue;
      if (mount.arc === 'spinal') { const a = Math.atan2(o.y - s.y, o.x - s.x); if (Math.abs(angDiff(s.rot, a)) > (w.kind === 'pulse' ? 0.3 : 0.12)) continue; }
      return o;
    }
    return null;
  }

  fireWeapons(s, dt) {
    const d = s.d;
    for (let i = 0; i < d.mounts.length; i++) {
      const m = d.mounts[i], w = WEAPONS[m.w];
      // continuing beams
      const b = s.beam[i];
      if (b) {
        b.t -= dt; const o = this.ships.get(b.tid);
        if (!o || o.dead || b.t <= 0 || Math.hypot(o.x - s.x, o.y - s.y) > w.range * 1.25) { s.beam[i] = null; }
        else {
          const ang = Math.atan2(o.y - s.y, o.x - s.x);
          const hx = o.x - Math.cos(ang) * o.d.size * 0.6, hy = o.y - Math.sin(ang) * o.d.size * 0.6;
          if (w.kind === 'repair') { o.hp = Math.min(o.d.hp, o.hp + w.hps * m.n * dt); }
          else this.damage(o, w.dps * m.n * dt, s, hx, hy);
          this.beams.push({ k: m.w === 'repair' ? 'repair' : m.w, x1: s.x, y1: s.y, x2: hx, y2: hy, t: 0, src: s.id });
          continue;
        }
      }
      s.cd[i] -= dt; if (s.cd[i] > 0) continue;
      if (w.kind === 'repair') {
        const o = s.repairTarget ? this.ships.get(s.repairTarget) : null;
        if (o && !o.dead && o.hp < o.d.hp && Math.hypot(o.x - s.x, o.y - s.y) < w.range) { s.beam[i] = { tid: o.id, t: 2.0 }; s.cd[i] = 2.5; }
        else s.cd[i] = 0.3;
        continue;
      }
      if (w.kind === 'pd') { this.firePD(s, i, m, w); continue; }
      if (w.kind === 'cannon' && s.fireManual && s.aim) { // manual heavy cannons (direct control)
        const a = Math.atan2(s.aim.y - s.y, s.aim.x - s.x);
        if (Math.abs(angDiff(s.rot, a)) < 0.35) { for (let j = 0; j < m.n; j++) this.spawnProjectile(s, w, 'cannon', a + (j - (m.n - 1) / 2) * 0.03, j * 0.0, null); s.cd[i] = w.rof; this.events.push({ e: 'muz', x: s.x + Math.cos(s.rot) * d.len * 0.5, y: s.y + Math.sin(s.rot) * d.len * 0.5, s: 10 }); }
        continue;
      }
      if (s.stance === 'passive' && s.order.t !== 'attack') { s.cd[i] = 0.2; continue; }
      const o = this.pickTarget(s, w, m); if (!o) { s.cd[i] = 0.15 + this.rand() * 0.1; continue; }
      s.cd[i] = w.rof / (w.kind === 'beam' ? 1 : Math.max(1, m.n * 0.6));
      const lead = this.leadAngle(s, o, w.speed || 1e9);
      switch (w.kind) {
        case 'beam': s.beam[i] = { tid: o.id, t: w.dur }; break;
        case 'missile': for (let j = 0; j < (w.salvo || 1); j++) this.spawnProjectile(s, w, 'missile', lead + (this.rand() - 0.5) * 1.2, j * 0.05, o.id); break;
        case 'torpedo': this.spawnProjectile(s, w, 'torpedo', lead, 0, o.id); break;
        case 'flak': this.spawnProjectile(s, w, 'flak', lead + (this.rand() - 0.5) * 0.08, 0, o.id, Math.hypot(o.x - s.x, o.y - s.y)); break;
        case 'mortar': this.spawnProjectile(s, w, 'mortar', lead + (this.rand() - 0.5) * 0.04, 0, o.id, Math.hypot(o.x - s.x, o.y - s.y)); break;
        case 'rail': this.spawnProjectile(s, w, 'rail', lead + (this.rand() - 0.5) * 0.02, 0, null); break;
        case 'cannon': this.spawnProjectile(s, w, 'cannon', lead + (this.rand() - 0.5) * 0.02, 0, null); break;
        default: this.spawnProjectile(s, w, 'pulse', lead + (this.rand() - 0.5) * 0.06, 0, null);
      }
    }
  }

  leadAngle(s, o, speed) {
    const dx = o.x - s.x, dy = o.y - s.y, dist = Math.hypot(dx, dy);
    const t = Math.min(2.5, dist / speed);
    return Math.atan2(dy + (o.vy - s.vy * 0.5) * t, dx + (o.vx - s.vx * 0.5) * t);
  }

  firePD(s, i, m, w) {
    // hitscan point defense: shoot incoming missiles/torpedoes first, then strike craft
    let best = null, bd = w.range;
    for (const pr of this.projectiles.values()) { if (pr.team === s.team || !pr.hp) continue; const dd = Math.hypot(pr.x - s.x, pr.y - s.y); if (dd < bd) { bd = dd; best = pr; } }
    if (best) {
      best.hp -= w.dmg * m.n; s.cd[i] = w.rof;
      this.beams.push({ k: 'pd', x1: s.x, y1: s.y, x2: best.x, y2: best.y, t: 0, src: s.id });
      if (best.hp <= 0) { this.projectiles.delete(best.id); this.events.push({ e: 'exp', x: best.x, y: best.y, s: 7, k: 0 }); }
      return;
    }
    const o = s.nearSmall ? this.ships.get(s.nearSmall) : null;
    if (o && !o.dead && Math.hypot(o.x - s.x, o.y - s.y) < w.range && s.stance !== 'passive') {
      this.damage(o, w.dmg * m.n * 0.8, s, o.x, o.y); s.cd[i] = w.rof;
      this.beams.push({ k: 'pd', x1: s.x, y1: s.y, x2: o.x, y2: o.y, t: 0, src: s.id });
      return;
    }
    s.cd[i] = 0.1;
  }

  spawnProjectile(s, w, kind, ang, delay, tid, fuseDist) {
    const id = this.nextId++;
    const off = s.d.size * (kind === 'cannon' ? 0.9 : 0.5);
    const spread = (kind === 'pulse' || kind === 'missile') ? (this.rand() - 0.5) * s.d.size : 0;
    const x = s.x + Math.cos(ang) * off - Math.sin(ang) * spread, y = s.y + Math.sin(ang) * off + Math.cos(ang) * spread;
    const pr = { id, kind, w, x, y, rot: ang, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, team: s.team, src: s, ttl: w.range / w.speed * (kind === 'missile' || kind === 'torpedo' ? 1.8 : 1.05), tid: tid || 0, hp: w.hp || 0, fuse: fuseDist ? fuseDist / w.speed : 0, age: 0 };
    if (kind === 'missile' || kind === 'torpedo') { pr.vx = Math.cos(ang) * w.speed * 0.4 + s.vx; pr.vy = Math.sin(ang) * w.speed * 0.4 + s.vy; }
    this.projectiles.set(id, pr);
    return pr;
  }

  updateProjectiles(dt) {
    const q = this._q;
    for (const [id, pr] of this.projectiles) {
      pr.age += dt; pr.ttl -= dt;
      const w = pr.w;
      if (pr.tid && (pr.kind === 'missile' || pr.kind === 'torpedo')) {
        const o = this.ships.get(pr.tid);
        if (o && !o.dead) {
          const want = Math.atan2(o.y - pr.y, o.x - pr.x); const diff = angDiff(pr.rot, want);
          pr.rot += clamp(diff, -w.turn * dt, w.turn * dt);
        } else pr.tid = 0;
        const sp = Math.min(w.speed, Math.hypot(pr.vx, pr.vy) + w.speed * 1.5 * dt);
        pr.vx = Math.cos(pr.rot) * sp; pr.vy = Math.sin(pr.rot) * sp;
      }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.ttl <= 0) { if (pr.kind === 'flak' || pr.kind === 'mortar') this.detonate(pr); this.projectiles.delete(id); continue; }
      // timed fuse (flak/mortar) – burst at target distance
      if (pr.fuse && pr.age >= pr.fuse) { this.detonate(pr); this.projectiles.delete(id); continue; }
      // collision
      const r = pr.kind === 'cannon' ? 8 : 4;
      this.grid.query(pr.x, pr.y, 80, q);
      let hit = null;
      for (const o of q) { if (o.team === pr.team || o.dead || o.warp > 0.3) continue; const dd = Math.hypot(o.x - pr.x, o.y - pr.y); if (dd < o.d.size * 0.9 + r) { hit = o; break; } }
      if (!hit && pr.kind === 'flak') { for (const o of q) { if (o.team === pr.team || o.dead) continue; if (o.d.size < 16 && Math.hypot(o.x - pr.x, o.y - pr.y) < w.aoe * 0.8) { hit = o; break; } } }
      if (hit) {
        if (w.aoe) this.detonate(pr); else this.damage(hit, w.dmg, pr.src, pr.x, pr.y);
        this.projectiles.delete(id);
      }
    }
  }

  detonate(pr) {
    const w = pr.w, q = this.grid.query(pr.x, pr.y, w.aoe + 60, this._q);
    for (const o of q) { if (o.team === pr.team || o.dead) continue; const dd = Math.hypot(o.x - pr.x, o.y - pr.y) - o.d.size * 0.5; if (dd < w.aoe) this.damage(o, w.dmg * (1 - Math.max(0, dd) / w.aoe * 0.6), pr.src, pr.x, pr.y); }
    this.events.push({ e: 'exp', x: pr.x, y: pr.y, s: pr.kind === 'flak' ? 10 : pr.kind === 'missile' ? 9 : pr.kind === 'cannon' ? 14 : 26, k: pr.kind === 'mortar' ? 3 : 0 });
  }

  updateHangar(s, dt) {
    const h = s.d.hangar; if (!h || s.stun > 0) return;
    s.hangarT -= dt; if (s.hangarT > 0) return;
    let n = 0; for (const o of this.ships.values()) if (o.parent === s.id && !o.dead) n++;
    if (n >= h.max) { s.hangarT = 2; return; }
    s.hangarT = h.interval; s.hangarN++;
    const type = h.alt && s.hangarN % h.altEvery === 0 ? h.alt : h.type;
    const side = s.hangarN % 2 ? 1 : -1;
    const x = s.x - Math.sin(s.rot) * side * s.d.size * 0.6, y = s.y + Math.cos(s.rot) * side * s.d.size * 0.6;
    const c = this.spawnShip(type, s.team, s.owner, x, y, s.rot + side * 0.8, { parent: s.id });
    c.vx = Math.cos(c.rot) * 120; c.vy = Math.sin(c.rot) * 120;
    c.order = { t: 'escort', tid: s.id }; c.fx = -s.d.size - 40 - this.rand() * 60; c.fy = side * (60 + this.rand() * 80); c.stance = s.stance;
  }

  // ------------------------------------------------------------------ waves
  waves(dt) {
    if (this.mode !== 'coop' || this.over) return;
    this.nextWaveT -= dt;
    if (this.nextWaveT > 0) return;
    this.wave++;
    this.nextWaveT = this.wave >= this.maxWaves ? 1e9 : 70 + this.wave * 6;
    let fleets = 0; for (const p of this.players.values()) if (p.team === 0 && !p.noFlagship) fleets++;
    const comp = waveComposition(this.wave, Math.max(1, fleets));
    const enemy = this.players.get('enemy');
    // spawn point on the right half edge, aimed at nearest allied flagship
    const edge = this.rand(); const L = MAP / 2 - 150;
    let sx, sy; if (edge < 0.5) { sx = L; sy = (this.rand() - 0.5) * MAP * 0.8; } else if (edge < 0.75) { sx = this.rand() * L; sy = -L; } else { sx = this.rand() * L; sy = L; }
    let tx = 0, ty = 0, n = 0; for (const p of this.players.values()) if (p.team === 0 && p.alive) { const f = this.ships.get(p.flagshipId); if (f) { tx += f.x; ty += f.y; n++; } }
    if (n) { tx /= n; ty /= n; }
    const rot = Math.atan2(ty - sy, tx - sx);
    const list = []; for (const [type, c] of Object.entries(comp)) for (let i = 0; i < c; i++) list.push(type);
    list.sort((a, b) => SHIPS[b].size - SHIPS[a].size);
    const slots = formationSlots('wedge', list.map(t => SHIPS[t].size), 1.1);
    let boss = null;
    list.forEach((type, i) => {
      const sl = slots[i];
      const px = sx + (-sl.f) * Math.cos(rot) - sl.r * Math.sin(rot), py = sy + (-sl.f) * Math.sin(rot) + sl.r * Math.cos(rot);
      const s = this.warpIn(type, 1, 'enemy', px, py, rot);
      s.hp *= 1 + this.wave * 0.08; s.d = { ...s.d, hp: s.hp };
      s.order = { t: 'amove', x: tx, y: ty };
      if (type === 'flagship') { boss = s; enemy.flagshipId = s.id; enemy.alive = true; enemy.cds = { Q: 5, E: 8, R: 6, F: 3, T: 20 }; }
    });
    if (boss) for (const s of this.ships.values()) if (s.owner === 'enemy' && s !== boss && s.warp > 0 && s.type !== 'flagship') { s.order = { t: 'escort', tid: boss.id }; s.fx = -200 - this.rand() * 300; s.fy = (this.rand() - 0.5) * 500; }
    this.events.push({ e: 'msg', text: `WAVE ${this.wave}${boss ? ' — DREADNOUGHT DETECTED' : ''} INCOMING`, kind: 'warn', all: true });
  }

  checkWin() {
    if (this.over) return;
    const alive = [false, false];
    for (const p of this.players.values()) if (p.alive && !p.noFlagship) alive[p.team] = true;
    if (this.mode === 'pvp') {
      if (!alive[0] && !alive[1]) this.over = { winner: -1 }; else if (!alive[0]) this.over = { winner: 1 }; else if (!alive[1]) this.over = { winner: 0 };
    } else {
      if (!alive[0]) { this.over = { winner: 1 }; return; }
      if (this.wave >= this.maxWaves) { let n = 0; for (const s of this.ships.values()) if (s.team === 1 && !s.dead) n++; if (n === 0) this.over = { winner: 0 }; }
    }
  }

  // --------------------------------------------------------------- snapshot
  snapshot() {
    const ships = [];
    for (const s of this.ships.values()) {
      let fl = 0; if (s.dead) fl |= F_DEAD; if (s.stun > 0) fl |= F_STUN; if (s.over > 0) fl |= F_OVER; if (s.warp > 0) fl |= F_WARPIN;
      const p = s.type === 'flagship' ? this.players.get(s.owner) : null; if (p && p.direct) fl |= F_DIRECT;
      const o = s.order;
      ships.push([s.id, SHIP_INDEX[s.type], s.team, s.owner, Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, Math.round(s.rot * 1000) / 1000,
        Math.round(s.hp), Math.round(s.shield), fl, Math.round(s.throttle * 10) / 10, o.t, o.x !== undefined ? Math.round(o.x) : 0, o.y !== undefined ? Math.round(o.y) : 0, o.tid || 0, s.d.hp, s.maxShield, s.target || 0]);
    }
    const projectiles = [];
    for (const pr of this.projectiles.values()) projectiles.push([pr.id, PK[pr.kind], Math.round(pr.x * 10) / 10, Math.round(pr.y * 10) / 10, Math.round(pr.rot * 100) / 100, pr.team]);
    const beams = this.beams.map(b => [BK[b.k], Math.round(b.x1), Math.round(b.y1), Math.round(b.x2), Math.round(b.y2), b.src]);
    const players = [];
    for (const p of this.players.values()) players.push({ id: p.id, name: p.name, team: p.team, ai: p.isAI, flag: p.flagshipId, cp: Math.floor(p.cp), alive: p.alive, cds: { Q: +p.cds.Q.toFixed(1), E: +p.cds.E.toFixed(1), R: +p.cds.R.toFixed(1), F: +p.cds.F.toFixed(1), T: +p.cds.T.toFixed(1) }, direct: p.direct, kills: p.kills, no: p.noFlagship });
    const snap = { t: this.t, tick: this.tick, ships, projectiles, beams, events: this.events, players, mode: this.mode, wave: this.wave, nextWave: Math.max(0, Math.round(this.nextWaveT)), maxWaves: this.maxWaves, over: this.over, scores: this.scores };
    this.events = [];
    return snap;
  }
}
