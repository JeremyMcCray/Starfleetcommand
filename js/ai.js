// ============================================================================
//  Fleet AI: formations, per-ship combat behaviour, AI commanders
// ============================================================================
import { ABILITIES, REINFORCEMENTS, SHIPS } from './defs.js';

// Returns [{f, r}] offsets (forward, right) in formation space for each unit (index 0 = leader)
export function formationSlots(type, sizes, scale) {
  const n = sizes.length, out = [];
  const gap = (i) => ((sizes[i] || 20) + (sizes[Math.max(0, i - 1)] || 20)) * 1.7 * scale + 24;
  if (type === 'line') {
    let left = 0, right = 0;
    for (let i = 0; i < n; i++) { if (i === 0) { out.push({ f: 0, r: 0 }); continue; } const g = gap(i); if (i % 2) { right += g; out.push({ f: 0, r: right }); } else { left += g; out.push({ f: 0, r: -left }); } }
  } else if (type === 'column') {
    let f = 0; for (let i = 0; i < n; i++) { if (i) f -= gap(i); out.push({ f, r: 0 }); }
  } else if (type === 'screen') {
    out.push({ f: 0, r: 0 });
    const R = 90 + n * 28 * scale; for (let i = 1; i < n; i++) { const a = -Math.PI * 0.6 + Math.PI * 1.2 * ((i - 1) / Math.max(1, n - 2)); out.push({ f: Math.cos(a) * R, r: Math.sin(a) * R }); }
  } else { // wedge
    let row = 0, f = 0, r = 0;
    for (let i = 0; i < n; i++) {
      if (i === 0) { out.push({ f: 0, r: 0 }); continue; }
      if (i % 2) { row++; f -= gap(i) * 0.8; r += gap(i) * 0.75; out.push({ f, r }); } else out.push({ f, r: -r });
    }
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function ownerFlag(sim, s) { const p = sim.players.get(s.owner); if (!p) return null; const f = sim.ships.get(p.flagshipId); return f && !f.dead ? f : null; }

function acquire(sim, s, r) {
  const d = s.d; let id = 0;
  if (d.role === 'antifighter' || d.cls === 'strike') id = s.nearSmall || s.nearAny;
  else if (d.role === 'anticapital' || d.role === 'bomber' || d.role === 'artillery') id = s.nearLarge || s.nearAny;
  else id = s.nearAny;
  if (!id) return null;
  const o = sim.ships.get(id); if (!o || o.dead) return null;
  if (dist(s, o) > r) return null;
  return o;
}

// --------------------------------------------------------------------------
export function shipBehavior(sim, s, dt) {
  const o = s.order, d = s.d;
  s.face = 0; s.want = 1; s.arriveR = 80; s.dest = null; s.aimTarget = 0; s.fireManual = false;
  let tgt = s.target ? sim.ships.get(s.target) : null; if (!tgt || tgt.dead || tgt.team === s.team) { s.target = 0; tgt = null; }
  if (o.tid) {
    const ot = sim.ships.get(o.tid);
    if (!ot || ot.dead) {
      if (o.t === 'escort') { const f = ownerFlag(sim, s); if (f && f.id !== o.tid) { o.tid = f.id; s.fx = -f.d.size - 150 - sim.rand() * 150; s.fy = (sim.rand() - 0.5) * 400; } else s.order = { t: 'idle' }; }
      else s.order = { t: 'idle' };
    }
  }
  const engageR = s.stance === 'aggressive' ? d.sensor : s.stance === 'defensive' ? Math.max(d.range * 1.1, 420) : 0;

  // Tenders never engage: they chase damaged allies and flee from enemies
  if (d.role === 'tender') return tenderBehavior(sim, s, engageR);
  if (d.role === 'carrier') return carrierBehavior(sim, s);

  switch (s.order.t) {
    case 'attack': { tgt = sim.ships.get(s.order.tid); s.target = tgt.id; combatMove(sim, s, tgt); return; }
    case 'move': { s.dest = { x: o.x, y: o.y }; if (dist(s, o) < 30) s.order = { t: 'hold', x: o.x, y: o.y }; return; }
    case 'amove': {
      if (!tgt && engageR > 0) tgt = acquire(sim, s, engageR);
      if (tgt) { s.target = tgt.id; combatMove(sim, s, tgt); }
      else { s.dest = { x: o.x, y: o.y }; if (dist(s, o) < 30) s.order = { t: 'hold', x: o.x, y: o.y }; }
      return;
    }
    case 'hold': {
      const leash = 420;
      if (!tgt && engageR > 0) tgt = acquire(sim, s, Math.min(engageR, d.range * 1.3));
      if (tgt && dist(s, o) < leash) { s.target = tgt.id; combatMove(sim, s, tgt); return; }
      s.target = tgt ? tgt.id : 0;
      if (dist(s, o) > 25) { s.dest = { x: o.x, y: o.y }; s.arriveR = 60; } else if (tgt) s.face = Math.atan2(tgt.y - s.y, tgt.x - s.x);
      return;
    }
    case 'escort': {
      const e = sim.ships.get(o.tid);
      const slot = { x: e.x + s.fx * Math.cos(e.rot) - s.fy * Math.sin(e.rot) + e.vx * 1.2, y: e.y + s.fx * Math.sin(e.rot) + s.fy * Math.cos(e.rot) + e.vy * 1.2 };
      const leash = 520 + e.d.size * 2;
      if (!tgt && engageR > 0) tgt = acquire(sim, s, engageR * (s.stance === 'defensive' ? 0.6 : 0.85));
      if (!tgt && d.cls === 'strike' && e.target) { const et = sim.ships.get(e.target); if (et && !et.dead) tgt = et; }
      if (tgt && dist(s, e) < leash) { s.target = tgt.id; combatMove(sim, s, tgt); return; }
      s.target = 0; s.dest = slot; s.arriveR = 100;
      if (dist(s, slot) < 35 && Math.hypot(e.vx, e.vy) < 5) { s.dest = null; s.face = e.rot; }
      return;
    }
    default: {
      if (!tgt && engageR > 0) tgt = acquire(sim, s, engageR);
      if (tgt) { s.target = tgt.id; combatMove(sim, s, tgt); }
      else if (d.cls === 'strike' && s.parent) { const p = sim.ships.get(s.parent); if (p && !p.dead) { s.order = { t: 'escort', tid: p.id }; s.fx = -p.d.size - 60; s.fy = (sim.rand() - 0.5) * 200; } }
    }
  }
}

function tenderBehavior(sim, s, engageR) {
  const threat = s.nearAny ? sim.ships.get(s.nearAny) : null;
  if (threat && !threat.dead && dist(s, threat) < 320) { // flee
    const dx = s.x - threat.x, dy = s.y - threat.y, l = Math.hypot(dx, dy) || 1;
    s.dest = { x: s.x + dx / l * 300, y: s.y + dy / l * 300 }; s.arriveR = 10; return;
  }
  const r = s.repairTarget ? sim.ships.get(s.repairTarget) : null;
  if (r && !r.dead && dist(s, r) < 900) {
    const dd = dist(s, r);
    if (dd > r.d.size + 130) { s.dest = { x: r.x + (s.x - r.x) / dd * (r.d.size + 100), y: r.y + (s.y - r.y) / dd * (r.d.size + 100) }; s.arriveR = 60; }
    else s.face = Math.atan2(r.y - s.y, r.x - s.x);
    return;
  }
  const o = s.order;
  if (o.t === 'escort') { const e = sim.ships.get(o.tid); const slot = { x: e.x + s.fx * Math.cos(e.rot) - s.fy * Math.sin(e.rot) + e.vx * 1.2, y: e.y + s.fx * Math.sin(e.rot) + s.fy * Math.cos(e.rot) + e.vy * 1.2 }; s.dest = slot; s.arriveR = 100; if (dist(s, slot) < 35 && Math.hypot(e.vx, e.vy) < 5) { s.dest = null; s.face = e.rot; } }
  else if (o.t === 'move' || o.t === 'amove' || o.t === 'hold') { if (dist(s, o) > 25) { s.dest = { x: o.x, y: o.y }; s.arriveR = 60; } else if (o.t !== 'hold') s.order = { t: 'hold', x: o.x, y: o.y }; }
}

function carrierBehavior(sim, s) {
  const o = s.order;
  const threat = s.nearAny ? sim.ships.get(s.nearAny) : null;
  if (threat && !threat.dead) s.target = threat.id; else s.target = 0;
  if (threat && !threat.dead && dist(s, threat) < 520 && o.t !== 'attack') {
    const dx = s.x - threat.x, dy = s.y - threat.y, l = Math.hypot(dx, dy) || 1;
    s.dest = { x: s.x + dx / l * 400, y: s.y + dy / l * 400 }; s.arriveR = 10; return;
  }
  if (o.t === 'attack') { const t = sim.ships.get(o.tid); s.target = t.id; const dd = dist(s, t); if (dd > 850) { s.dest = { x: t.x, y: t.y }; s.arriveR = 850; } else s.face = Math.atan2(t.y - s.y, t.x - s.x); return; }
  if (o.t === 'escort') { const e = sim.ships.get(o.tid); const slot = { x: e.x + s.fx * Math.cos(e.rot) - s.fy * Math.sin(e.rot) + e.vx * 1.2, y: e.y + s.fx * Math.sin(e.rot) + s.fy * Math.cos(e.rot) + e.vy * 1.2 }; s.dest = slot; s.arriveR = 100; if (dist(s, slot) < 35 && Math.hypot(e.vx, e.vy) < 5) { s.dest = null; s.face = e.rot; } return; }
  if (o.t === 'move' || o.t === 'amove' || o.t === 'hold') { if (dist(s, o) > 25) { s.dest = { x: o.x, y: o.y }; s.arriveR = 60; } else if (o.t !== 'hold') s.order = { t: 'hold', x: o.x, y: o.y }; }
}

// Role-specific engagement movement
function combatMove(sim, s, t) {
  const d = s.d, dd = dist(s, t), a = s.ai;
  const ux = (s.x - t.x) / (dd || 1), uy = (s.y - t.y) / (dd || 1);
  switch (d.role) {
    case 'strafer': {
      a.t -= 1 / 30;
      if (a.phase === 0) { // attack run
        s.dest = { x: t.x + t.vx * 0.3, y: t.y + t.vy * 0.3 }; s.arriveR = 5; s.want = 1;
        if (dd < t.d.size + 40 + d.len * 2) { a.phase = 1; a.side = -a.side; a.t = 1.6 + sim.rand(); const ang = Math.atan2(-uy, -ux) + a.side * 1.1; const R = 220 + t.d.size * 2 + sim.rand() * 120; a.pt = { x: t.x + Math.cos(ang) * R, y: t.y + Math.sin(ang) * R }; }
      } else { s.dest = a.pt; s.arriveR = 5; s.want = 1; if (dist(s, a.pt) < 50 || a.t <= 0) { a.phase = 0; } }
      return;
    }
    case 'bomber': {
      a.t -= 1 / 30;
      if (a.phase === 0) { s.dest = { x: t.x, y: t.y }; s.arriveR = 20; s.want = 0.9; if (dd < t.d.size + 90) { a.phase = 1; a.t = 3 + sim.rand(); a.side = -a.side; const ang = Math.atan2(-uy, -ux) + a.side * 1.4; a.pt = { x: t.x + Math.cos(ang) * 520, y: t.y + Math.sin(ang) * 520 }; } }
      else { s.dest = a.pt; s.arriveR = 5; if (dist(s, a.pt) < 60 || a.t <= 0) a.phase = 0; }
      return;
    }
    case 'artillery': {
      const pr = d.range * 0.82;
      if (dd > pr) { s.dest = { x: t.x + ux * pr * 0.9, y: t.y + uy * pr * 0.9 }; s.arriveR = 60; }
      else if (dd < d.range * 0.45) { s.dest = { x: s.x + ux * 300, y: s.y + uy * 300 }; s.arriveR = 20; }
      else s.face = Math.atan2(t.y - s.y, t.x - s.x);
      return;
    }
    default: { // capitals & escorts: close to preferred range, then orbit to keep guns on target
      const pr = d.range * (d.role === 'antifighter' ? 0.6 : d.cls === 'capital' ? 0.72 : 0.65);
      const tang = a.side * (d.cls === 'capital' ? 0.45 : 0.9);
      if (dd > pr * 1.15) { s.dest = { x: t.x + ux * pr, y: t.y + uy * pr }; s.arriveR = 50; }
      else {
        // orbit point: slightly ahead along the tangent, pulled back to pr
        const px = -uy * tang, py = ux * tang;
        s.dest = { x: t.x + (ux + px) * pr, y: t.y + (uy + py) * pr }; s.arriveR = 30; s.want = d.cls === 'capital' ? 0.6 : 0.8;
        if (dd < pr * 0.5) { s.dest = { x: t.x + ux * pr, y: t.y + uy * pr }; }
      }
      if (sim.rand() < 0.003) a.side = -a.side;
    }
  }
}

// --------------------------------------------------------------------------
//  AI commander: issues fleet-level orders + uses flagship abilities
// --------------------------------------------------------------------------
export function commanderThink(sim, p) {
  const mine = [], enemies = [];
  for (const s of sim.ships.values()) { if (s.dead) continue; if (s.owner === p.id) mine.push(s); else if (s.team !== p.team) enemies.push(s); }
  if (!enemies.length) return;
  const flag = sim.ships.get(p.flagshipId); const flagOk = flag && !flag.dead;
  const nearestTo = (x, y, list, filter) => { let b = null, bd = 1e12; for (const o of list) { if (filter && !filter(o)) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; b = o; } } return { s: b, d: bd }; };
  const ai = p.ai; ai.timer = (ai.timer || 0) + 2.5;

  // ---- abilities
  if (flagOk) {
    const near = enemies.filter(e => Math.hypot(e.x - flag.x, e.y - flag.y) < 1300);
    const capNear = nearestTo(flag.x, flag.y, enemies, e => e.d.cls === 'capital');
    if (p.cds.Q <= 0 && flag.shield < flag.maxShield * 0.35 && near.length) sim.useAbility(p, 'Q');
    if (p.cds.E <= 0 && (near.filter(e => Math.hypot(e.x - flag.x, e.y - flag.y) < ABILITIES.E.radius).length >= 4 || (capNear.s && capNear.d < 320))) sim.useAbility(p, 'E');
    if (p.cds.R <= 0 && capNear.s && capNear.d < 1200) { const t = capNear.s; const lead = Math.min(1.0, capNear.d / 1500); sim.useAbility(p, 'R', t.x + t.vx * lead, t.y + t.vy * lead); }
    if (p.cds.F <= 0 && near.length) sim.useAbility(p, 'F');
    if (p.cds.T <= 0 && flag.hp < flag.d.hp * 0.3 && capNear.s && capNear.d < 600) { const ux = flag.x - capNear.s.x, uy = flag.y - capNear.s.y, l = Math.hypot(ux, uy) || 1; sim.useAbility(p, 'T', flag.x + ux / l * 750, flag.y + uy / l * 750); }
    // reinforcements
    if (!p.noFlagship && sim.rand() < 0.5) { const pick = REINFORCEMENTS[Math.floor(sim.rand() * REINFORCEMENTS.length)]; if (p.cp >= SHIPS[pick].cost + 40) sim.reinforce(p, pick); }
  }

  // ---- wave controller (co-op enemy): keep everyone pushing at the players
  if (p.noFlagship || (sim.mode === 'coop' && p.team === 1)) {
    const targets = enemies.filter(e => e.type === 'flagship'); const pool = targets.length ? targets : enemies;
    for (const s of mine) {
      if (s.d.cls === 'strike') continue;
      if (s.order.t === 'idle' || s.order.t === 'hold' || (s.order.t === 'escort' && !flagOk)) { const n = nearestTo(s.x, s.y, pool).s; if (n) s.order = { t: 'amove', x: n.x, y: n.y }; }
    }
    if (flagOk && (flag.order.t === 'idle' || flag.order.t === 'hold' || (flag.order.t === 'amove' && Math.hypot(flag.order.x - flag.x, flag.order.y - flag.y) < 200))) { const n = nearestTo(flag.x, flag.y, pool).s; if (n) flag.order = { t: 'amove', x: n.x, y: n.y }; }
    return;
  }

  // ---- PvP / allied admiral logic
  if (!flagOk) { // no flagship: everything attacks
    for (const s of mine) if (s.order.t !== 'attack' && s.order.t !== 'amove') { const n = nearestTo(s.x, s.y, enemies).s; if (n) s.order = { t: 'amove', x: n.x, y: n.y }; }
    return;
  }
  const threat = nearestTo(flag.x, flag.y, enemies);
  const myStr = mine.reduce((a, s) => a + s.d.cost + (s.type === 'flagship' ? 500 : 0), 0);
  const enStr = enemies.reduce((a, s) => a + s.d.cost + (s.type === 'flagship' ? 500 : 0), 0);
  if (!ai.home) ai.home = { x: flag.x, y: flag.y };

  if (threat.d < 1000) {
    // defend: everyone engages the threat; flagship holds and fights
    for (const s of mine) if (s.d.cls !== 'strike' && s.type !== 'flagship' && s.order.t !== 'attack') s.order = { t: 'amove', x: threat.s.x, y: threat.s.y };
    if (flag.order.t !== 'attack') flag.order = { t: 'attack', tid: threat.s.id };
    ai.mood = 'defend'; return;
  }
  if (flag.hp < flag.d.hp * 0.35 && ai.mood !== 'retreat') { ai.mood = 'retreat'; ai.timer = 0; flag.order = { t: 'move', x: ai.home.x, y: ai.home.y }; for (const s of mine) if (s.type !== 'flagship') { s.order = { t: 'escort', tid: flag.id }; s.fx = -flag.d.size - 150 - sim.rand() * 200; s.fy = (sim.rand() - 0.5) * 500; } return; }
  if (ai.mood === 'retreat' && ai.timer > 40) ai.mood = 'build';
  if (ai.mood === 'retreat') return;

  if (ai.mood !== 'attack' && ai.timer > 30 && myStr > enStr * 0.75) {
    ai.mood = 'attack'; ai.timer = 0;
    const obj = nearestTo(flag.x, flag.y, enemies, e => e.type === 'flagship').s || nearestTo(flag.x, flag.y, enemies).s;
    flag.order = { t: 'amove', x: obj.x, y: obj.y };
    let i = 0;
    for (const s of mine) { if (s.type === 'flagship' || s.d.cls === 'strike') continue; i++; if (s.d.role === 'tender' || s.d.role === 'carrier' || i % 3 === 0) { s.order = { t: 'escort', tid: flag.id }; } else s.order = { t: 'amove', x: obj.x, y: obj.y }; }
    return;
  }
  if (ai.mood === 'attack') {
    const obj = nearestTo(flag.x, flag.y, enemies, e => e.type === 'flagship').s || nearestTo(flag.x, flag.y, enemies).s;
    if (flag.order.t === 'hold' || flag.order.t === 'idle') flag.order = { t: 'amove', x: obj.x, y: obj.y };
    for (const s of mine) if (s.d.cls !== 'strike' && (s.order.t === 'hold' || s.order.t === 'idle')) s.order = { t: 'amove', x: obj.x, y: obj.y };
    if (ai.timer > 90) { ai.mood = 'build'; ai.timer = 0; }
    return;
  }
  // build/idle: gather around the flagship
  for (const s of mine) if (s.d.cls !== 'strike' && s.type !== 'flagship' && (s.order.t === 'idle' || s.order.t === 'hold')) { s.order = { t: 'escort', tid: flag.id }; s.fx = -flag.d.size - 150 - sim.rand() * 250; s.fy = (sim.rand() - 0.5) * 600; }
  if (flag.order.t === 'idle') flag.order = { t: 'hold', x: flag.x, y: flag.y };
}
