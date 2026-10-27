// ============================================================================
//  Networking: host-authoritative P2P via PeerJS (WebRTC). No game server.
// ============================================================================
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode() { let s = ''; for (let i = 0; i < 5; i++) s += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]; return s; }
const peerId = (code) => 'sfc-' + code.toUpperCase() + '-host';

export class Net {
  constructor() {
    this.peer = null; this.conns = new Map(); this.isHost = false; this.hostConn = null;
    this.onMessage = () => {}; this.onJoin = () => {}; this.onLeave = () => {}; this.onError = () => {}; this.onOpen = () => {}; this.onDisconnect = () => {};
    this.ping = 0; this.bytesOut = 0;
  }

  _mkPeer(id) {
    const p = new Peer(id, { debug: 1 });
    p.on('error', (e) => { this.onError(e.type === 'unavailable-id' ? 'Room code already in use — try again.' : e.type === 'peer-unavailable' ? 'Room not found. Check the code and that the host is still in the lobby.' : 'Network error: ' + (e.type || e)); });
    p.on('disconnected', () => { try { p.reconnect(); } catch (e) { /* ignore */ } });
    return p;
  }

  host(code) {
    this.isHost = true; this.code = code;
    const p = this.peer = this._mkPeer(peerId(code));
    p.on('open', () => this.onOpen(code));
    p.on('connection', (c) => {
      c.on('open', () => { this.conns.set(c.peer, c); this.onJoin(c.peer, c.metadata || {}); });
      c.on('data', (d) => { if (d && d.t === 'ping') { c.send({ t: 'pong', ts: d.ts }); return; } this.onMessage(c.peer, d); });
      c.on('close', () => { this.conns.delete(c.peer); this.onLeave(c.peer); });
      c.on('error', () => { this.conns.delete(c.peer); this.onLeave(c.peer); });
    });
  }

  join(code, meta) {
    this.isHost = false; this.code = code.toUpperCase();
    const p = this.peer = this._mkPeer(undefined);
    p.on('open', () => {
      const c = this.hostConn = p.connect(peerId(code), { metadata: meta, reliable: true, serialization: 'json' });
      c.on('open', () => { this.onOpen(code); this._pingTimer = setInterval(() => { try { c.send({ t: 'ping', ts: performance.now() }); } catch (e) { /* ignore */ } }, 2000); });
      c.on('data', (d) => { if (d && d.t === 'pong') { this.ping = Math.round(performance.now() - d.ts); return; } this.onMessage('host', d); });
      c.on('close', () => { clearInterval(this._pingTimer); this.onDisconnect(); });
      c.on('error', (e) => { this.onError('Connection error'); });
    });
  }

  // host → everyone (or one)
  send(to, msg) { const c = this.conns.get(to); if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }
  // client → host
  toHost(msg) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(msg); } catch (e) { /* ignore */ } } }

  close() { clearInterval(this._pingTimer); try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ } this.peer = null; this.conns.clear(); this.hostConn = null; }
}
