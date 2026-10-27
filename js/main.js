// ============================================================================
//  Main: menu, lobby, host/client plumbing, game loop
// ============================================================================
import { TICK, TEAM_NAMES } from './defs.js';
import { Sim } from './sim.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Net, makeRoomCode } from './net.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const AI_NAMES = ['Admiral Vex', 'Admiral Korrin', 'Admiral Sato', 'Admiral Ilyra'];

class Game {
  constructor() {
    this.state = 'menu';
    this.me = { id: 'p0', name: 'Admiral', team: 0 };
    this.net = null; this.sim = null; this.world = new World();
    this.renderer = new Renderer($('gl'));
    this.input = new Input(this); this.ui = new UI(this);
    this.lobby = { players: [], settings: { mode: 'coop', ai: 2, fleet: 'medium' } };
    this.world.onEvents((ev) => { this.renderer.handleEvents(ev, this.world, this.me.team); this.ui.onEvents(ev); });
    this.bindMenu();
    this.last = performance.now(); this.acc = 0; this.netTick = 0;
    requestAnimationFrame((t) => this.frame(t));
    this.hiddenLast = 0;
    setInterval(() => { if (document.hidden && this.state === 'game' && this.sim) { const now = performance.now(); const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now; this.hostStep(dt); } }, 50);
    const saved = localStorage.getItem('sfc_name'); if (saved) $('nameInput').value = saved;
    const url = new URL(location.href); const rc = url.searchParams.get('room'); if (rc) $('roomInput').value = rc.toUpperCase();
  }

  // ------------------------------------------------------------------ menu
  bindMenu() {
    $('btnHost').addEventListener('click', () => this.host());
    $('btnJoin').addEventListener('click', () => this.join());
    $('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    $('btnLeave').addEventListener('click', () => this.leave());
    $('btnStart').addEventListener('click', () => this.start());
    $('btnBackMenu').addEventListener('click', () => this.leave());
    for (const id of ['modeSelect', 'aiSelect', 'fleetSelect']) $(id).addEventListener('change', () => { if (this.net && this.net.isHost) { this.lobby.settings = { mode: $('modeSelect').value, ai: +$('aiSelect').value, fleet: $('fleetSelect').value }; this.syncLobby(); } });
  }
  myName() { const n = ($('nameInput').value || '').trim() || 'Admiral'; localStorage.setItem('sfc_name', n); return n.slice(0, 16); }
  status(id, msg) { $(id).textContent = msg; }

  host() {
    this.me = { id: 'p0', name: this.myName(), team: 0 };
    this.status('menuStatus', 'Opening room…');
    const code = makeRoomCode();
    const net = this.net = new Net();
    net.onOpen = () => { this.status('menuStatus', ''); this.lobby.players = [{ id: 'p0', name: this.me.name, team: 0, host: true }]; this.showLobby(code); this.syncLobby(); };
    net.onError = (m) => { this.status('menuStatus', m); this.status('lobbyStatus', m); };
    net.onJoin = (pid, meta) => {
      if (this.state === 'game') { net.send(pid, { t: 'busy' }); return; }
      const team = this.lobby.settings.mode === 'pvp' ? (this.lobby.players.filter(p => p.team === 0).length > this.lobby.players.filter(p => p.team === 1).length ? 1 : 0) : 0;
      this.lobby.players.push({ id: pid, name: (meta.name || 'Admiral').slice(0, 16), team });
      net.send(pid, { t: 'welcome', pid, code });
      this.ui.alert(`${meta.name || 'A commander'} joined`, 'good'); this.syncLobby();
    };
    net.onLeave = (pid) => { this.lobby.players = this.lobby.players.filter(p => p.id !== pid); this.syncLobby(); if (this.state === 'game') this.ui.alert('A commander disconnected — their fleet is now AI-controlled', 'warn'); if (this.sim) { const p = this.sim.players.get(pid); if (p) { p.isAI = true; p.direct = false; } } };
    net.onMessage = (pid, m) => {
      if (m.t === 'cmd' && this.sim) this.sim.command(pid, m.c);
      else if (m.t === 'team' && this.state === 'lobby') { const p = this.lobby.players.find(p => p.id === pid); if (p) { p.team = m.team ? 1 : 0; this.syncLobby(); } }
    };
    net.host(code);
  }

  join() {
    const code = ($('roomInput').value || '').trim().toUpperCase(); if (code.length < 4) { this.status('menuStatus', 'Enter the room code from the host.'); return; }
    this.me = { id: '', name: this.myName(), team: 0 };
    this.status('menuStatus', 'Connecting to host…');
    const net = this.net = new Net();
    net.onError = (m) => { this.status('menuStatus', m); this.status('lobbyStatus', m); };
    net.onOpen = () => this.status('menuStatus', 'Connected. Waiting for lobby…');
    net.onDisconnect = () => { if (this.state !== 'menu') { this.ui.alert('Lost connection to host', 'warn'); this.status('lobbyStatus', 'Lost connection to host.'); setTimeout(() => this.leave(), 1500); } };
    net.onMessage = (_, m) => {
      switch (m.t) {
        case 'welcome': this.me.id = m.pid; this.showLobby(m.code); break;
        case 'lobby': this.lobby = m.lobby; this.renderLobby(); { const me = this.lobby.players.find(p => p.id === this.me.id); if (me) this.me.team = me.team; } break;
        case 'start': this.beginGame(m); break;
        case 'snap': if (this.state === 'game') this.world.push(m.s); break;
        case 'busy': this.status('menuStatus', 'That battle has already started.'); net.close(); break;
      }
    };
    net.join(code, { name: this.me.name });
  }

  leave() {
    if (this.net) this.net.close(); this.net = null; this.sim = null;
    this.state = 'menu'; this.world = new World(); this.world.onEvents((ev) => { this.renderer.handleEvents(ev, this.world, this.me.team); this.ui.onEvents(ev); });
    this.input.selected.clear(); this.input.direct = false; this.ui.setDirect(false);
    for (const v of this.renderer.views.values()) this.renderer.scene.remove(v.g); this.renderer.views.clear();
    show('menu', true); show('lobby', false); show('hud', false); show('gameover', false);
    this.status('menuStatus', '');
  }

  // ----------------------------------------------------------------- lobby
  showLobby(code) {
    this.state = 'lobby'; show('menu', false); show('lobby', true); $('roomCode').textContent = code;
    $('lobbyOptions').querySelectorAll('select').forEach(s => s.disabled = !this.net.isHost);
    $('btnStart').classList.toggle('hidden', !this.net.isHost);
    this.status('lobbyStatus', this.net.isHost ? 'You are the host. Start whenever you are ready — you can also play solo.' : 'Waiting for the host to launch…');
    const link = new URL(location.href); link.searchParams.set('room', code); $('teamHint').innerHTML = `Invite link: <span style="color:var(--amber);user-select:text">${link.href}</span><br>Click your name to switch team (PvP).`;
    this.renderLobby();
  }
  syncLobby() { if (!this.net || !this.net.isHost) return; this.renderLobby(); this.net.broadcast({ t: 'lobby', lobby: this.lobby }); }
  renderLobby() {
    const ul = $('playerList'); ul.innerHTML = '';
    const pvp = this.lobby.settings.mode === 'pvp';
    $('modeSelect').value = this.lobby.settings.mode; $('aiSelect').value = this.lobby.settings.ai; $('fleetSelect').value = this.lobby.settings.fleet;
    for (const p of this.lobby.players) {
      const li = document.createElement('li'); li.className = p.team === 1 ? 't1' : '';
      li.innerHTML = `<span>${p.name}${p.host ? ' ★' : ''}${p.id === this.me.id ? ' (you)' : ''}</span><span class="team">${pvp ? TEAM_NAMES[p.team] : 'ALLIED'}</span>`;
      if (p.id === this.me.id && pvp) li.addEventListener('click', () => { const t = p.team ? 0 : 1; if (this.net.isHost) { p.team = t; this.me.team = t; this.syncLobby(); } else this.net.toHost({ t: 'team', team: t }); });
      ul.appendChild(li);
    }
  }

  // ----------------------------------------------------------------- start
  start() {
    if (!this.net || !this.net.isHost) return;
    const st = this.lobby.settings; const players = this.lobby.players.map(p => ({ id: p.id, name: p.name, team: st.mode === 'pvp' ? p.team : 0 }));
    // AI admirals: in PvP fill both sides (balance), in co-op they are allies
    let t0 = players.filter(p => p.team === 0).length, t1 = players.filter(p => p.team === 1).length;
    for (let i = 0; i < st.ai; i++) { let team = 0; if (st.mode === 'pvp') { team = t1 <= t0 ? 1 : 0; if (team) t1++; else t0++; } players.push({ id: 'ai' + i, name: AI_NAMES[i % AI_NAMES.length], team, isAI: true }); }
    if (st.mode === 'pvp' && !players.some(p => p.team === 1)) players.push({ id: 'aiX', name: 'Admiral Draal', team: 1, isAI: true });
    const seed = Math.floor(Math.random() * 1e9);
    const msg = { t: 'start', players, mode: st.mode, fleet: st.fleet, seed };
    this.net.broadcast(msg);
    this.sim = new Sim({ mode: st.mode, fleetSize: st.fleet, seed, players });
    this.beginGame(msg);
  }
  beginGame(m) {
    const me = m.players.find(p => p.id === this.me.id); if (me) this.me.team = me.team;
    this.world = new World(); this.world.delay = this.net && this.net.isHost ? 0.06 : 0.12;
    this.world.onEvents((ev) => { this.renderer.handleEvents(ev, this.world, this.me.team); this.ui.onEvents(ev); });
    this.state = 'game'; show('lobby', false); show('hud', true); show('gameover', false);
    this.input.selected.clear(); this.input.direct = false; this.ui.setDirect(false);
    this.acc = 0; this.netTick = 0; this.overShown = false;
    this.ui.alert(m.mode === 'coop' ? 'ARMADA ASSAULT — hold the line. First wave inbound.' : `FLEET WAR — destroy the enemy dreadnoughts. You fight for the ${TEAM_NAMES[this.me.team]}.`, 'good');
    this.needCenter = true;
  }

  sendCmd(c) {
    if (this.state !== 'game') return;
    if (this.net && this.net.isHost) { if (this.sim) this.sim.command(this.me.id, c); }
    else if (this.net) this.net.toHost({ t: 'cmd', c });
  }

  // ------------------------------------------------------------------ loop
  frame(t) {
    requestAnimationFrame((t2) => this.frame(t2));
    let dt = (t - this.last) / 1000; this.last = t; if (dt > 0.1) dt = 0.1;
    if (this.state === 'game') {
      if (this.sim) this.hostStep(dt);
      this.world.update(dt);
      if (this.needCenter) { const f = this.world.flagshipOf(this.me.id); if (f) { this.renderer.cam.x = this.renderer.cam.tx = f.x; this.renderer.cam.z = this.renderer.cam.tz = f.y; this.needCenter = false; } }
      this.renderer.updateCamera(dt);
      this.input.update(dt);
      this.ui.update(dt);
      if (this.world.over && !this.overShown) this.showGameOver();
    } else this.renderer.updateCamera(dt);
    this.renderer.update(this.world, dt, this.input);
  }

  // Host simulation stepping (fixed timestep). Also driven by a timer while the tab is hidden,
  // so remote players keep playing if the host alt-tabs.
  hostStep(dt) {
    this.acc += dt; let steps = 0;
    while (this.acc >= TICK && steps < 6) {
      this.sim.step(); this.acc -= TICK; steps++;
      const snap = this.sim.snapshot();
      this.world.push(snap);
      this.netTick++;
      if (this.net && this.net.conns.size) { this.pendingEvents = (this.pendingEvents || []).concat(snap.events); if (this.netTick % 2 === 0) { this.net.broadcast({ t: 'snap', s: { ...snap, events: this.pendingEvents } }); this.pendingEvents = []; } }
    }
    if (steps === 6) this.acc = 0;
  }

  showGameOver() {
    this.overShown = true; const o = this.world.over; const won = o.winner === this.me.team;
    $('goTitle').textContent = o.winner === -1 ? 'MUTUAL ANNIHILATION' : won ? 'VICTORY' : 'DEFEAT';
    $('goTitle').style.color = won ? '#5cff9d' : '#ff4d5e';
    const me = this.world.player(this.me.id);
    $('goText').textContent = this.world.mode === 'coop' ? (won ? `The armada is broken. All ${this.world.maxWaves} waves repelled.` : `The line fell on wave ${this.world.wave}.`) + ` You scored ${me ? me.kills : 0} kills.` : `${TEAM_NAMES[o.winner] || 'Nobody'} controls the sector. You scored ${me ? me.kills : 0} kills.`;
    setTimeout(() => show('gameover', true), 2500);
  }
}

window.game = new Game();
