// ============================================================================
//  Client-side world: receives snapshots and exposes interpolated entities.
//  Used identically by the host (feeding its own sim) and by remote clients.
// ============================================================================
import { SHIP_KEYS, SHIPS } from './defs.js';
import { angDiff } from './sim.js';

export class World {
  constructor() {
    this.ships = new Map(); this.projectiles = new Map();
    this.beams = []; this.players = []; this.playerMap = new Map();
    this.mode = 'coop'; this.wave = 0; this.nextWave = 0; this.maxWaves = 0; this.over = null; this.scores = [0, 0];
    this.lastT = 0; this.prevT = 0; this.renderT = 0; this.delay = 0.1; this.hasData = false;
    this.listeners = [];
    this.alpha = 0;
  }
  onEvents(fn) { this.listeners.push(fn); }

  push(snap) {
    const seenS = new Set(), seenP = new Set();
    this.prevT = this.lastT; this.lastT = snap.t;
    if (!this.hasData) { this.renderT = snap.t - this.delay; this.hasData = true; }
    for (const a of snap.ships) {
      const id = a[0]; seenS.add(id);
      let s = this.ships.get(id);
      if (!s) {
        const type = SHIP_KEYS[a[1]];
        s = { id, type, d: SHIPS[type], team: a[2], owner: a[3], x: a[4], y: a[5], rot: a[6], px: a[4], py: a[5], prot: a[6], cx: a[4], cy: a[5], crot: a[6], hp: a[7], sh: a[8], flags: a[9], thr: a[10], orderT: a[11], ox: a[12], oy: a[13], otid: a[14], maxHp: a[15], maxSh: a[16], target: a[17], born: snap.t };
        this.ships.set(id, s);
      } else {
        s.px = s.cx; s.py = s.cy; s.prot = s.crot;
        s.cx = a[4]; s.cy = a[5]; s.crot = a[6];
        s.hp = a[7]; s.sh = a[8]; s.flags = a[9]; s.thr = a[10]; s.orderT = a[11]; s.ox = a[12]; s.oy = a[13]; s.otid = a[14]; s.maxHp = a[15]; s.maxSh = a[16]; s.target = a[17];
        // big teleport (micro-jump): don't interpolate
        if (Math.hypot(s.cx - s.px, s.cy - s.py) > 300) { s.px = s.cx; s.py = s.cy; }
      }
    }
    for (const id of this.ships.keys()) if (!seenS.has(id)) this.ships.delete(id);
    for (const a of snap.projectiles) {
      const id = a[0]; seenP.add(id);
      let p = this.projectiles.get(id);
      if (!p) { p = { id, kind: a[1], x: a[2], y: a[3], rot: a[4], team: a[5], px: a[2], py: a[3], cx: a[2], cy: a[3], born: snap.t }; this.projectiles.set(id, p); }
      else { p.px = p.cx; p.py = p.cy; p.cx = a[2]; p.cy = a[3]; p.rot = a[4]; }
    }
    for (const id of this.projectiles.keys()) if (!seenP.has(id)) this.projectiles.delete(id);
    this.beams = snap.beams;
    this.players = snap.players; this.playerMap = new Map(snap.players.map(p => [p.id, p]));
    this.mode = snap.mode; this.wave = snap.wave; this.nextWave = snap.nextWave; this.maxWaves = snap.maxWaves; this.over = snap.over; this.scores = snap.scores;
    if (snap.events && snap.events.length) for (const fn of this.listeners) fn(snap.events);
  }

  // advance render clock and interpolate
  update(dt) {
    if (!this.hasData) return;
    const target = this.lastT - this.delay;
    this.renderT += dt;
    const err = target - this.renderT;
    if (Math.abs(err) > 0.5) this.renderT = target; else this.renderT += err * 0.08;
    const span = Math.max(1e-3, this.lastT - this.prevT);
    let a = (this.renderT - this.prevT) / span; if (a < 0) a = 0; if (a > 1.25) a = 1.25;
    this.alpha = a;
    for (const s of this.ships.values()) {
      s.x = s.px + (s.cx - s.px) * a; s.y = s.py + (s.cy - s.py) * a;
      s.rot = s.prot + angDiff(s.prot, s.crot) * a;
    }
    for (const p of this.projectiles.values()) { p.x = p.px + (p.cx - p.px) * a; p.y = p.py + (p.cy - p.py) * a; }
  }

  player(id) { return this.playerMap.get(id); }
  flagshipOf(pid) { const p = this.playerMap.get(pid); return p ? this.ships.get(p.flag) : null; }
}
