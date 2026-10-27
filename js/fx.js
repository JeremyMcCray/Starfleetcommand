// ============================================================================
//  Visual effects: GPU particle system, beams, shockwave rings, debris
// ============================================================================
import * as THREE from 'three';

export function makeGlowTexture(size = 64, inner = 0.0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(size / 2, size / 2, inner * size / 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- particles
export class Particles {
  constructor(scene, max = 14000) {
    this.max = max; this.head = 0; this.dirty = false;
    const geo = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.meta = new Float32Array(max * 4); // birth, life, size, drag
    for (let i = 0; i < max; i++) this.meta[i * 4] = -1e9;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('vel', new THREE.BufferAttribute(this.vel, 3));
    geo.setAttribute('col', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('meta', new THREE.BufferAttribute(this.meta, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTex: { value: makeGlowTexture(64) }, uScale: { value: 4.5 } },
      vertexShader: `
        attribute vec3 vel; attribute vec3 col; attribute vec4 meta;
        uniform float uTime; uniform float uScale;
        varying vec3 vCol; varying float vA;
        void main() {
          float age = uTime - meta.x; float t = age / meta.y;
          vCol = col;
          if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          float k = 1.0 - exp(-meta.w * age); float move = meta.w > 0.0 ? k / meta.w : age;
          vec3 p = position + vel * move;
          vA = (1.0 - t) * (1.0 - t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = meta.z * (1.0 + t * 1.2);
          gl_PointSize = size * uScale * 300.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec3 vCol; varying float vA;
        void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vCol * t.a * vA, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    this.time = 0;
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, life, size, drag = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.meta[i * 4] = this.time; this.meta[i * 4 + 1] = life; this.meta[i * 4 + 2] = size; this.meta[i * 4 + 3] = drag;
    this.dirty = true;
  }
  update(dt) {
    this.time += dt; this.mat.uniforms.uTime.value = this.time;
    if (this.dirty) { for (const k of ['position', 'vel', 'col', 'meta']) this.geo.attributes[k].needsUpdate = true; this.dirty = false; }
  }
}

const tmpC = new THREE.Color();
export function colorOf(hex) { tmpC.setHex(hex); return [tmpC.r, tmpC.g, tmpC.b]; }

// ---------------------------------------------------------------- beams
export class Beams {
  constructor(scene, n = 80) {
    this.pool = []; this.active = 0;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); geo.rotateX(Math.PI / 2); // along Z
    for (let i = 0; i < n; i++) {
      const outer = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.visible = core.visible = false; scene.add(outer); scene.add(core);
      this.pool.push({ outer, core });
    }
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }
  begin() { this.active = 0; }
  draw(x1, y1, z1, x2, y2, z2, color, width, intensity = 1, t = 0) {
    if (this.active >= this.pool.length) return;
    const b = this.pool[this.active++];
    const a = this._a.set(x1, y1, z1), c = this._b.set(x2, y2, z2);
    const len = a.distanceTo(c); if (len < 1) { return; }
    const pulse = 1 + 0.25 * Math.sin(t * 40);
    for (const [m, w, op] of [[b.outer, width * 2.2 * pulse, 0.3 * intensity], [b.core, width * 0.6, 0.95 * intensity]]) {
      m.visible = true; m.position.copy(a).add(c).multiplyScalar(0.5); m.lookAt(c); m.scale.set(w, w, len);
      m.material.color.setHex(color); m.material.opacity = op;
    }
    b.core.material.color.lerp(tmpC.setHex(0xffffff), 0.6);
  }
  end() { for (let i = this.active; i < this.pool.length; i++) { const b = this.pool[i]; if (!b.outer.visible) break; b.outer.visible = b.core.visible = false; } }
}

// ---------------------------------------------------------------- rings
export class Rings {
  constructor(scene, n = 40) {
    this.items = []; this.scene = scene;
    const geo = new THREE.RingGeometry(0.85, 1, 48); geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); this.items.push({ m, t: 0, life: 0, r0: 0, r1: 0 }); }
  }
  spawn(x, y, z, r0, r1, life, color, opacity = 1) {
    let it = this.items.find(i => !i.m.visible) || this.items[0];
    it.m.visible = true; it.m.position.set(x, y, z); it.t = 0; it.life = life; it.r0 = r0; it.r1 = r1; it.op = opacity; it.m.material.color.setHex(color);
  }
  update(dt) {
    for (const it of this.items) { if (!it.m.visible) continue; it.t += dt; const k = it.t / it.life; if (k >= 1) { it.m.visible = false; continue; } const e = 1 - Math.pow(1 - k, 3); const r = it.r0 + (it.r1 - it.r0) * e; it.m.scale.set(r, r, r); it.m.material.opacity = (1 - k) * it.op; }
  }
}

// ---------------------------------------------------------------- debris
export class Debris {
  constructor(scene, n = 60) {
    this.items = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x55606c, roughness: 0.7, metalness: 0.5, flatShading: true });
    for (let i = 0; i < n; i++) { const g = new THREE.BoxGeometry(1, 1, 1); const m = new THREE.Mesh(g, mat); m.visible = false; scene.add(m); this.items.push({ m, v: new THREE.Vector3(), av: new THREE.Vector3(), t: 0, life: 0 }); }
  }
  spawn(x, y, z, size, count) {
    for (let i = 0; i < count; i++) {
      const it = this.items.find(d => !d.m.visible); if (!it) return;
      it.m.visible = true; it.m.position.set(x + (Math.random() - .5) * size, y + (Math.random() - .5) * size * .3, z + (Math.random() - .5) * size);
      it.m.scale.set(2 + Math.random() * size * 0.14, 1 + Math.random() * size * 0.05, 2 + Math.random() * size * 0.1);
      it.v.set((Math.random() - .5) * 120, (Math.random() - .3) * 40, (Math.random() - .5) * 120); it.av.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      it.t = 0; it.life = 3 + Math.random() * 3;
    }
  }
  update(dt) {
    for (const it of this.items) { if (!it.m.visible) continue; it.t += dt; if (it.t > it.life) { it.m.visible = false; continue; } it.m.position.addScaledVector(it.v, dt); it.v.multiplyScalar(1 - dt * 0.6); it.m.rotation.x += it.av.x * dt; it.m.rotation.y += it.av.y * dt; it.m.rotation.z += it.av.z * dt; const k = 1 - it.t / it.life; it.m.scale.multiplyScalar(k < 0.2 ? 1 - dt * 2 : 1); }
  }
}

// --------------------------------------------------------- explosion recipes
export function explosion(P, x, z, size, kind, teamColor) {
  const n = Math.min(400, Math.floor(size * (kind === 2 ? 9 : 4)) + 6);
  const sp = size * (kind === 2 ? 6 : 10);
  // flash
  P.spawn(x, 2, z, 0, 0, 0, 1.0, 0.95, 0.8, 0.25 + size * 0.004, size * 3 + 10, 0);
  if (kind === 2) P.spawn(x, 3, z, 0, 0, 0, 1.0, 0.7, 0.4, 0.8, size * 6, 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 0.8, v = Math.random() * sp + sp * 0.2;
    const hot = Math.random();
    const r = 1.0, g = 0.35 + hot * 0.55, b = hot * 0.25;
    P.spawn(x, 1 + Math.random() * 3, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v * 0.5, Math.sin(a) * Math.cos(e) * v, r, g, b, 0.4 + Math.random() * (kind === 2 ? 2.2 : 0.9), 2 + Math.random() * (kind === 2 ? 6 : 3), 1.8);
  }
  if (kind === 2 || kind === 3) { // lingering embers / smoke-ish glow
    for (let i = 0; i < n / 2; i++) { const a = Math.random() * Math.PI * 2, v = Math.random() * sp * 0.35; P.spawn(x, 1, z, Math.cos(a) * v, Math.random() * 15, Math.sin(a) * v, kind === 3 ? 0.6 : 0.9, kind === 3 ? 0.4 : 0.35, kind === 3 ? 1.0 : 0.15, 1.5 + Math.random() * 2.5, 6 + Math.random() * 10, 1.2); }
  }
}
