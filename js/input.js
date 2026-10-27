// ============================================================================
//  Input: RTS selection + orders, camera, hotkeys, Direct Control mode
// ============================================================================
import { MAP } from './defs.js';

export class Input {
  constructor(game) {
    this.g = game;
    this.keys = new Set(); this.mouse = { x: 0, y: 0, down: false, button: -1, sx: 0, sy: 0, dragging: false, inWindow: true };
    this.selected = new Set(); this.groups = {}; this.hover = 0;
    this.pendingCmd = null; // 'attackmove'
    this.direct = false; this.lastInputSend = 0; this.midDrag = null;
    this.formation = 'wedge'; this.stance = 'aggressive';
    const c = document.getElementById('overlay'); this.canvas = document.getElementById('gl');
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('mousedown', (e) => this.mouseDown(e));
    window.addEventListener('mousemove', (e) => this.mouseMove(e));
    window.addEventListener('mouseup', (e) => this.mouseUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => { const cam = this.g.renderer.cam; cam.tzoom = Math.max(0.05, Math.min(1, cam.tzoom + Math.sign(e.deltaY) * 0.07)); e.preventDefault(); }, { passive: false });
    document.addEventListener('mouseleave', () => { this.mouse.inWindow = false; }); document.addEventListener('mouseenter', () => { this.mouse.inWindow = true; });
  }

  get active() { return this.g.state === 'game'; }
  myShip(id) { const s = this.g.world.ships.get(id); return s && s.owner === this.g.me.id && !(s.flags & 1) ? s : null; }
  flagship() { return this.g.world.flagshipOf(this.g.me.id); }

  // ------------------------------------------------------------- keyboard
  keyDown(e) {
    if (!this.active) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.keys.add(e.code);
    const code = e.code; const w = this.cursorWorld();
    if (code === 'Tab') { e.preventDefault(); const f = this.flagship(); if (f) { this.selected.clear(); this.selected.add(f.id); this.g.ui.refreshSelection(); } return; }
    if (code === 'KeyC') { this.toggleDirect(); return; }
    if (code === 'Space') { const f = this.flagship(); if (f) { this.g.renderer.cam.tx = f.x; this.g.renderer.cam.tz = f.y; } return; }
    if (code === 'Escape') { if (this.pendingCmd) this.pendingCmd = null; else { this.selected.clear(); this.g.ui.refreshSelection(); } return; }
    if (/^Digit[1-9]$/.test(code)) {
      const n = code[5];
      if (e.ctrlKey || e.metaKey) { this.groups[n] = new Set(this.selected); this.g.ui.alert(`Group ${n} assigned`, 'good'); e.preventDefault(); }
      else if (this.groups[n]) { const ids = [...this.groups[n]].filter(id => this.myShip(id)); this.groups[n] = new Set(ids); if (e.shiftKey) ids.forEach(id => this.selected.add(id)); else this.selected = new Set(ids); this.g.ui.refreshSelection(); }
      return;
    }
    if (/^Key[QERFT]$/.test(code)) { this.g.sendCmd({ t: 'ability', k: code[3], x: w ? w.x : 0, y: w ? w.y : 0 }); return; }
    if (this.direct) return; // WASD reserved for flight
    switch (code) {
      case 'KeyA': if (this.selected.size) this.pendingCmd = 'attackmove'; break;
      case 'KeyS': this.order({ t: 'hold' }); break;
      case 'KeyG': { const f = this.flagship(); if (f) this.order({ t: 'escort', tid: f.id }); break; }
      case 'KeyH': { const f = this.flagship(); if (f) this.order({ t: 'move', x: f.x - Math.cos(f.rot) * 200, y: f.y - Math.sin(f.rot) * 200 }); break; }
    }
  }

  toggleDirect() {
    const f = this.flagship(); if (!f) { this.g.ui.alert('No flagship to control', 'warn'); return; }
    this.direct = !this.direct; this.pendingCmd = null;
    this.g.sendCmd({ t: 'direct', on: this.direct });
    this.g.ui.setDirect(this.direct);
    if (this.direct) { this.g.renderer.cam.tx = f.x; this.g.renderer.cam.tz = f.y; }
  }

  order(o) {
    const ids = [...this.selected].filter(id => this.myShip(id)); if (!ids.length) return;
    this.g.sendCmd({ t: 'order', ids, o });
    if (o.t === 'move' || o.t === 'amove') this.g.ui.marker(o.x, o.y, o.t === 'amove' ? 0xff6a4d : 0x4ff0ff);
  }
  setFormation(f) { this.formation = f; const ids = [...this.selected]; if (ids.length) this.g.sendCmd({ t: 'formation', ids, f }); }
  setStance(s) { this.stance = s; const ids = [...this.selected]; if (ids.length) this.g.sendCmd({ t: 'stance', ids, s }); }
  cmdButton(cmd) {
    const f = this.flagship();
    if (cmd === 'attackmove') { if (this.selected.size) this.pendingCmd = 'attackmove'; }
    else if (cmd === 'hold') this.order({ t: 'hold' });
    else if (cmd === 'escort' && f) this.order({ t: 'escort', tid: f.id });
    else if (cmd === 'retreat' && f) this.order({ t: 'move', x: f.x - Math.cos(f.rot) * 200, y: f.y - Math.sin(f.rot) * 200 });
  }

  // ---------------------------------------------------------------- mouse
  cursorWorld() { return this.g.renderer.screenToWorld(this.mouse.x, this.mouse.y); }
  mouseDown(e) {
    if (!this.active) return;
    this.mouse.down = true; this.mouse.button = e.button; this.mouse.sx = e.clientX; this.mouse.sy = e.clientY; this.mouse.dragging = false;
    if (e.button === 1) { this.midDrag = { x: e.clientX, y: e.clientY, cx: this.g.renderer.cam.tx, cz: this.g.renderer.cam.tz }; e.preventDefault(); }
    if (e.button === 0 && this.pendingCmd === 'attackmove') { const w = this.cursorWorld(); if (w) this.order({ t: 'amove', x: w.x, y: w.y }); this.pendingCmd = null; this.mouse.down = false; return; }
    if (e.button === 0 && this.direct) { this.fire = true; }
  }
  mouseMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inWindow = true;
    if (this.mouse.down && this.mouse.button === 0 && !this.direct && Math.hypot(e.clientX - this.mouse.sx, e.clientY - this.mouse.sy) > 6) this.mouse.dragging = true;
    if (this.midDrag) { const r = this.g.renderer; const a = r.screenToWorld(this.midDrag.x, this.midDrag.y), b = r.screenToWorld(e.clientX, e.clientY); if (a && b) { r.cam.tx = this.midDrag.cx - (b.x - a.x); r.cam.tz = this.midDrag.cz - (b.y - a.y); } }
  }
  mouseUp(e) {
    if (e.button === 1) this.midDrag = null;
    if (e.button === 0) this.fire = false;
    if (!this.active || !this.mouse.down) return;
    this.mouse.down = false;
    const w = this.cursorWorld();
    if (e.button === 0 && !this.direct) {
      if (this.mouse.dragging) this.boxSelect(this.mouse.sx, this.mouse.sy, e.clientX, e.clientY, e.shiftKey);
      else this.clickSelect(e.shiftKey, e.detail >= 2);
      this.mouse.dragging = false;
    } else if (e.button === 2 && w) {
      const hov = this.hover ? this.g.world.ships.get(this.hover) : null;
      if (hov && hov.team !== this.g.me.team) this.order({ t: 'attack', tid: hov.id });
      else if (hov && hov.team === this.g.me.team && !this.selected.has(hov.id)) this.order({ t: 'escort', tid: hov.id });
      else this.order({ t: e.altKey ? 'amove' : 'move', x: w.x, y: w.y });
      this.pendingCmd = null;
    }
  }
  clickSelect(shift, dbl) {
    const id = this.hover; const s = id ? this.myShip(id) : null;
    if (!shift) this.selected.clear();
    if (s) {
      if (dbl) { for (const o of this.g.world.ships.values()) if (o.owner === this.g.me.id && o.type === s.type && !(o.flags & 1)) this.selected.add(o.id); }
      else if (shift && this.selected.has(s.id)) this.selected.delete(s.id); else this.selected.add(s.id);
    }
    this.g.ui.refreshSelection();
  }
  boxSelect(x1, y1, x2, y2, shift) {
    const r = this.g.renderer; const minx = Math.min(x1, x2), maxx = Math.max(x1, x2), miny = Math.min(y1, y2), maxy = Math.max(y1, y2);
    if (!shift) this.selected.clear();
    for (const s of this.g.world.ships.values()) {
      if (s.owner !== this.g.me.id || (s.flags & 1)) continue;
      const p = r.worldToScreen(s.x, s.y); if (p.behind) continue;
      if (p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy) this.selected.add(s.id);
    }
    this.g.ui.refreshSelection();
  }

  // --------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const r = this.g.renderer, cam = r.cam, world = this.g.world;
    // prune selection
    for (const id of this.selected) if (!this.myShip(id)) this.selected.delete(id);
    // hover
    let best = 0, bd = 18;
    for (const s of world.ships.values()) {
      if (s.flags & 1) continue; const p = r.worldToScreen(s.x, s.y); if (p.behind) continue;
      const e = r.worldToScreen(s.x + s.d.size, s.y); const rad = Math.max(10, Math.hypot(e.x - p.x, e.y - p.y));
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y) - rad; if (d < bd) { bd = d; best = s.id; }
    }
    this.hover = best;
    // camera
    const f = this.flagship();
    if (this.direct && f) { cam.tx += (f.x - cam.tx) * Math.min(1, dt * 3); cam.tz += (f.y - cam.tz) * Math.min(1, dt * 3); }
    else {
      const speed = (600 + cam.zoom * 2200) * dt; let dx = 0, dz = 0;
      const k = this.keys; if (k.has('ArrowLeft') || (!this.direct && k.has('KeyA') && !this.pendingCmd && this.selected.size === 0)) dx -= 1; if (k.has('ArrowRight') || (!this.direct && k.has('KeyD'))) dx += 1; if (k.has('ArrowUp') || (!this.direct && k.has('KeyW'))) dz -= 1; if (k.has('ArrowDown') || (!this.direct && k.has('KeyS') && this.selected.size === 0)) dz += 1;
      const m = 14; if (this.mouse.inWindow && !this.mouse.down && document.hasFocus()) { if (this.mouse.x < m) dx -= 1; if (this.mouse.x > window.innerWidth - m) dx += 1; if (this.mouse.y < m) dz -= 1; if (this.mouse.y > window.innerHeight - m) dz += 1; }
      cam.tx += dx * speed; cam.tz += dz * speed;
    }
    const L = MAP / 2 + 200; cam.tx = Math.max(-L, Math.min(L, cam.tx)); cam.tz = Math.max(-L, Math.min(L, cam.tz));
    // direct control input stream
    if (this.direct) {
      if (!f) { this.direct = false; this.g.ui.setDirect(false); this.g.sendCmd({ t: 'direct', on: false }); return; }
      const now = performance.now();
      if (now - this.lastInputSend > 50) {
        this.lastInputSend = now; const k = this.keys; const w = this.cursorWorld();
        const th = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), tu = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        this.g.sendCmd({ t: 'input', th, tu, ax: w ? w.x : f.x, ay: w ? w.y : f.y, f: !!this.fire });
      }
    }
  }
}
