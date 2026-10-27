// ============================================================================
//  HUD: DOM panels, 2D overlay (health bars, selection box, markers), minimap
// ============================================================================
import { SHIPS, REINFORCEMENTS, ABILITIES, TEAM_COLORS, MAP, shipName } from './defs.js';
import { F_DEAD } from './sim.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.g = game;
    this.overlay = $('overlay'); this.ctx = this.overlay.getContext('2d');
    this.mini = $('minimap'); this.mctx = this.mini.getContext('2d');
    this.markers = []; this.alertsEl = $('alerts'); this.hudT = 0; this.fps = 0; this.frames = 0; this.fpsT = 0;
    this.resize(); window.addEventListener('resize', () => this.resize());
    // command panel buttons
    document.querySelectorAll('#cmdPanel [data-cmd]').forEach(b => b.addEventListener('click', () => this.g.input.cmdButton(b.dataset.cmd)));
    document.querySelectorAll('#cmdPanel [data-form]').forEach(b => b.addEventListener('click', () => { this.g.input.setFormation(b.dataset.form); this.syncToggles(); }));
    document.querySelectorAll('#cmdPanel [data-stance]').forEach(b => b.addEventListener('click', () => { this.g.input.setStance(b.dataset.stance); this.syncToggles(); }));
    document.querySelectorAll('#abilities .ab').forEach(a => a.addEventListener('click', () => { const w = this.g.input.cursorWorld(); const f = this.g.world.flagshipOf(this.g.me.id); this.g.sendCmd({ t: 'ability', k: a.dataset.key, x: w ? w.x : (f ? f.x : 0), y: w ? w.y : (f ? f.y : 0) }); }));
    $('btnDirect').addEventListener('click', () => this.g.input.toggleDirect());
    const rl = $('reinList'); rl.innerHTML = '';
    for (const k of REINFORCEMENTS) { const b = document.createElement('button'); b.dataset.type = k; b.innerHTML = `<span>${SHIPS[k].name}</span><b>${SHIPS[k].cost}</b>`; b.title = `Warp in a ${SHIPS[k].name} near your flagship`; b.addEventListener('click', () => this.g.sendCmd({ t: 'rein', type: k })); rl.appendChild(b); }
    this.mini.addEventListener('mousedown', (e) => { const w = this.miniToWorld(e); if (e.button === 2) { this.g.input.order({ t: e.altKey ? 'amove' : 'move', x: w.x, y: w.y }); } else { this.g.renderer.cam.tx = w.x; this.g.renderer.cam.tz = w.y; } });
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mini.addEventListener('mousemove', (e) => { if (e.buttons & 1) { const w = this.miniToWorld(e); this.g.renderer.cam.tx = w.x; this.g.renderer.cam.tz = w.y; } });
  }
  resize() { this.overlay.width = window.innerWidth; this.overlay.height = window.innerHeight; }
  miniToWorld(e) { const r = this.mini.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width - 0.5) * MAP, y: ((e.clientY - r.top) / r.height - 0.5) * MAP }; }

  alert(text, kind = '') { const d = document.createElement('div'); d.textContent = text; d.className = kind; this.alertsEl.appendChild(d); setTimeout(() => d.remove(), 4000); while (this.alertsEl.children.length > 5) this.alertsEl.firstChild.remove(); }
  marker(x, y, color) { this.markers.push({ x, y, color, t: 0 }); }
  setDirect(on) { $('btnDirect').classList.toggle('on', on); if (on) this.alert('DIRECT CONTROL — WASD to fly, mouse to aim, click to fire', 'good'); }
  refreshSelection() { this.syncToggles(); this.selDirty = true; }
  syncToggles() {
    const inp = this.g.input;
    document.querySelectorAll('#cmdPanel [data-form]').forEach(b => b.classList.toggle('on', b.dataset.form === inp.formation));
    document.querySelectorAll('#cmdPanel [data-stance]').forEach(b => b.classList.toggle('on', b.dataset.stance === inp.stance));
  }

  onEvents(events) {
    const me = this.g.me;
    for (const e of events) {
      if (e.e === 'msg') { if (e.all || e.pid === me.id || (e.team === me.team && !e.pid)) this.alert(e.text, e.kind); }
      else if (e.e === 'kill') { if (e.big || e.type === 'flagship') this.alert(`${e.n} ${e.team === me.team ? 'LOST' : 'DESTROYED'}`, e.team === me.team ? 'warn' : 'good'); }
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const g = this.g, w = g.world, r = g.renderer, inp = g.input, me = g.me;
    this.frames++; this.fpsT += dt; if (this.fpsT >= 1) { this.fps = this.frames; this.frames = 0; this.fpsT = 0; }
    this.drawOverlay(dt);
    this.hudT -= dt; if (this.hudT <= 0 || this.selDirty) { this.hudT = 0.12; this.selDirty = false; this.updateDom(); this.drawMinimap(); }
  }

  drawOverlay(dt) {
    const g = this.g, w = g.world, r = g.renderer, inp = g.input, me = g.me, ctx = this.ctx;
    const W = this.overlay.width, H = this.overlay.height; ctx.clearRect(0, 0, W, H);
    // health bars
    for (const s of w.ships.values()) {
      if (s.flags & F_DEAD) continue;
      const sel = inp.selected.has(s.id), hov = inp.hover === s.id, isFlag = s.type === 'flagship';
      const damaged = s.hp < s.maxHp * 0.999 || s.sh < s.maxSh * 0.999;
      if (!(sel || hov || isFlag || (damaged && s.d.size >= 12))) continue;
      const p = r.worldToScreen(s.x, s.y, 0); if (p.behind || p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) continue;
      const e = r.worldToScreen(s.x + s.d.size, s.y); const rad = Math.hypot(e.x - p.x, e.y - p.y);
      const bw = Math.max(14, Math.min(90, rad * 1.6)), bh = isFlag ? 5 : 3, x = p.x - bw / 2, y = p.y - rad * 0.7 - 10;
      const col = hex(TEAM_COLORS[s.team % 4]);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 1, y - 1, bw + 2, bh * 2 + 3);
      ctx.fillStyle = s.team === me.team ? '#ffb547' : '#ff4d5e'; ctx.fillRect(x, y, bw * Math.max(0, s.hp / s.maxHp), bh);
      ctx.fillStyle = s.team === me.team ? '#4ff0ff' : '#ff9bb0'; ctx.fillRect(x, y + bh + 1, bw * Math.min(1, s.maxSh ? s.sh / s.maxSh : 0), bh);
      if (isFlag || sel || hov) { ctx.font = (isFlag ? 'bold 11px' : '10px') + ' sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; const pl = w.player(s.owner); ctx.fillText(isFlag && pl ? pl.name.toUpperCase() : shipName(s.type, s.id), p.x, y - 4); ctx.shadowBlur = 0; }
    }
    // order markers
    ctx.lineWidth = 1.5;
    for (let i = this.markers.length - 1; i >= 0; i--) { const m = this.markers[i]; m.t += dt; if (m.t > 1) { this.markers.splice(i, 1); continue; } const p = r.worldToScreen(m.x, m.y); const k = 1 - m.t; ctx.strokeStyle = hex(m.color); ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(p.x, p.y, 6 + (1 - k) * 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    // selected units' current destinations
    ctx.strokeStyle = 'rgba(79,240,255,0.35)'; ctx.setLineDash([4, 6]);
    for (const id of inp.selected) { const s = w.ships.get(id); if (!s || !(s.orderT === 'move' || s.orderT === 'amove')) continue; const a = r.worldToScreen(s.x, s.y), b = r.worldToScreen(s.ox, s.oy); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]);
    // drag box
    if (inp.mouse.dragging) { ctx.strokeStyle = '#4ff0ff'; ctx.fillStyle = 'rgba(79,240,255,0.08)'; const x = Math.min(inp.mouse.sx, inp.mouse.x), y = Math.min(inp.mouse.sy, inp.mouse.y); ctx.fillRect(x, y, Math.abs(inp.mouse.x - inp.mouse.sx), Math.abs(inp.mouse.y - inp.mouse.sy)); ctx.strokeRect(x, y, Math.abs(inp.mouse.x - inp.mouse.sx), Math.abs(inp.mouse.y - inp.mouse.sy)); }
    // cursor
    if (inp.direct) { const m = inp.mouse; ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(m.x, m.y, 14, 0, Math.PI * 2); ctx.moveTo(m.x - 22, m.y); ctx.lineTo(m.x - 8, m.y); ctx.moveTo(m.x + 8, m.y); ctx.lineTo(m.x + 22, m.y); ctx.moveTo(m.x, m.y - 22); ctx.lineTo(m.x, m.y - 8); ctx.moveTo(m.x, m.y + 8); ctx.lineTo(m.x, m.y + 22); ctx.stroke(); }
    else if (inp.pendingCmd) { const m = inp.mouse; ctx.strokeStyle = '#ff6a4d'; ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#ff6a4d'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('ATTACK-MOVE', m.x + 14, m.y + 4); }
  }

  updateDom() {
    const g = this.g, w = g.world, me = g.me, inp = g.input;
    const pl = w.player(me.id); if (!pl) return;
    $('cpVal').textContent = pl.cp;
    if (w.mode === 'coop') $('modePill').textContent = w.wave >= w.maxWaves ? `FINAL WAVE ${w.wave}` : `WAVE ${w.wave}/${w.maxWaves} · NEXT ${w.nextWave}s`; else $('modePill').textContent = 'FLEET WAR';
    let a = 0, b = 0; for (const s of w.ships.values()) if (!(s.flags & F_DEAD) && s.d.cls !== 'strike') { if (s.team === me.team) a++; else b++; }
    $('scorePill').textContent = `ALLIED ${a} · HOSTILE ${b}`;
    $('pingPill').textContent = g.net && !g.net.isHost ? `${g.net.ping}ms` : 'HOST'; $('fpsPill').textContent = this.fps + ' fps';
    // flagship
    const f = w.ships.get(pl.flag);
    if (f && !(f.flags & F_DEAD)) { $('flagName').textContent = shipName('flagship', f.id).toUpperCase() + (inp.direct ? ' — DIRECT' : ''); $('flagHull').style.width = (f.hp / f.maxHp * 100) + '%'; $('flagShield').style.width = Math.min(100, f.sh / f.maxSh * 100) + '%'; }
    else { $('flagName').textContent = 'FLAGSHIP LOST'; $('flagHull').style.width = '0%'; $('flagShield').style.width = '0%'; }
    for (const el of document.querySelectorAll('#abilities .ab')) { const k = el.dataset.key, cd = pl.cds[k], max = ABILITIES[k].cd; el.querySelector('.cd').style.height = (cd > 0 ? cd / max * 100 : 0) + '%'; el.classList.toggle('ready', cd <= 0 && !!f); el.classList.toggle('active', k === 'Q' && f && !!(f.flags & 4)); }
    // reinforcements
    for (const btn of document.querySelectorAll('#reinList button')) btn.disabled = !f || pl.cp < SHIPS[btn.dataset.type].cost;
    // selection list
    const counts = new Map(); let shown = 0; const list = $('selList'); list.innerHTML = '';
    for (const id of inp.selected) { const s = w.ships.get(id); if (!s) continue; counts.set(s.type, (counts.get(s.type) || 0) + 1); if (shown < 12) { shown++; const d = document.createElement('div'); d.className = 'u'; d.innerHTML = `<div class="nm">${shipName(s.type, s.id)}</div>${SHIPS[s.type].name}<div class="hp"><div style="width:${s.hp / s.maxHp * 100}%"></div></div><div class="sh"><div style="width:${Math.min(100, s.maxSh ? s.sh / s.maxSh * 100 : 0)}%"></div></div>`; list.appendChild(d); } }
    if (!inp.selected.size) list.innerHTML = '<div class="empty">NO UNITS SELECTED — drag to select, Tab for flagship</div>';
    else if (inp.selected.size > 12) { const d = document.createElement('div'); d.className = 'u'; d.textContent = `+${inp.selected.size - 12} more`; list.appendChild(d); }
    // players
    const ph = $('playersHud'); ph.innerHTML = '';
    for (const p of w.players) { if (p.no) continue; const d = document.createElement('div'); d.textContent = `${p.name}${p.ai ? ' (AI)' : ''} · ${p.kills} kills`; d.style.color = hex(TEAM_COLORS[p.team % 4]); if (!p.alive) d.classList.add('dead'); ph.appendChild(d); }
  }

  drawMinimap() {
    const g = this.g, w = g.world, me = g.me, c = this.mctx, S = this.mini.width, k = S / MAP;
    c.fillStyle = 'rgba(2,6,14,0.9)'; c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(79,240,255,0.25)'; c.strokeRect(0.5, 0.5, S - 1, S - 1);
    for (const s of w.ships.values()) {
      if (s.flags & F_DEAD) continue;
      const x = (s.x / MAP + 0.5) * S, y = (s.y / MAP + 0.5) * S;
      c.fillStyle = hex(TEAM_COLORS[s.team % 4]);
      if (s.type === 'flagship') { c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.stroke(); }
      else { const r = s.d.cls === 'strike' ? 0.8 : s.d.cls === 'capital' ? 2.2 : 1.5; c.fillRect(x - r, y - r, r * 2, r * 2); }
    }
    // camera viewport
    const r = g.renderer; const corners = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([px, py]) => r.screenToWorld(px, py));
    if (corners.every(Boolean)) { c.strokeStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); corners.forEach((p, i) => { const x = (p.x / MAP + 0.5) * S, y = (p.y / MAP + 0.5) * S; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.stroke(); }
  }
}
