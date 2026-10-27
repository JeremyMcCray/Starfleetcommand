// ============================================================================
//  Renderer: Three.js scene, tilted top-down camera, ships, projectiles, fx
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { TEAM_COLORS, WEAPONS, MAP, SHIPS } from './defs.js';
import { PROJ_KINDS, BEAM_KINDS, F_DEAD, F_STUN, F_OVER, F_WARPIN } from './sim.js';
import { shipGeometry, ENGINES } from './shipmodels.js';
import { Particles, Beams, Rings, Debris, makeGlowTexture, explosion, colorOf } from './fx.js';

const HULL_TINT = [0x8a98ad, 0xa08f80, 0xa08090, 0x88a088];
const PROJ_STYLE = {
  pulse: { color: 0x7fe9ff, s: [16, 2.4, 2.4], mult: 2.5 },
  rail: { color: 0xfff1a8, s: [64, 1.8, 1.8], mult: 3 },
  torpedo: { color: 0xffa040, s: [11, 4, 4], mult: 2.2 },
  missile: { color: 0xffe0a0, s: [8, 2.2, 2.2], mult: 2.2 },
  flak: { color: 0xffc070, s: [7, 2.8, 2.8], mult: 2 },
  mortar: { color: 0xb070ff, s: [10, 8, 8], mult: 2.4 },
  cannon: { color: 0xffffff, s: [30, 5, 5], mult: 2.5 },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x02040a);
    this.camera = new THREE.PerspectiveCamera(48, 1, 10, 12000);
    this.cam = { x: 0, z: 0, zoom: 0.45, tx: 0, tz: 0, tzoom: 0.45, shake: 0 }; // zoom 0..1
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.0, 0.55, 0.62);
    this.composer.addPass(this.bloom);

    const hemi = new THREE.HemisphereLight(0x5a7fb0, 0x1a1020, 0.9); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.6); sun.position.set(600, 900, -400); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x4080ff, 0.6); rim.position.set(-700, 300, 600); this.scene.add(rim);

    this.glowTex = makeGlowTexture(64);
    this.buildBackground();
    this.P = new Particles(this.scene);
    this.beams = new Beams(this.scene);
    this.rings = new Rings(this.scene);
    this.debris = new Debris(this.scene);
    this.views = new Map();
    this.hullMats = TEAM_COLORS.map((c, i) => new THREE.MeshStandardMaterial({ color: HULL_TINT[i], roughness: 0.5, metalness: 0.55, flatShading: true }));
    this.glowMats = TEAM_COLORS.map(c => { const m = new THREE.MeshBasicMaterial({ color: c }); m.color.multiplyScalar(1.6); return m; });
    this.extraGlowMats = new Map();
    this.shieldGeo = new THREE.SphereGeometry(1, 28, 18);
    this.buildProjectiles();
    this.selGeo = new THREE.RingGeometry(0.9, 1, 40); this.selGeo.rotateX(-Math.PI / 2);
    this.selMat = new THREE.MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.hoverMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    this.time = 0;
    this.lances = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._ray = new THREE.Raycaster(); this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector2();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- background
  buildBackground() {
    // star dome (follows camera)
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.acos(Math.random() * 2 - 1); const R = 6000;
      pos[i * 3] = Math.cos(a) * Math.sin(e) * R; pos[i * 3 + 1] = Math.abs(Math.cos(e)) * R * (Math.random() < 0.5 ? 1 : -1); pos[i * 3 + 2] = Math.sin(a) * Math.sin(e) * R;
      const t = Math.random(); const c = new THREE.Color().setHSL(t < 0.3 ? 0.6 : t < 0.6 ? 0.1 : 0.0, t < 0.6 ? 0.5 : 0.0, 0.6 + Math.random() * 0.4);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; sz[i] = 1 + Math.random() * 2.5 * (Math.random() < 0.05 ? 2.5 : 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('sz', new THREE.BufferAttribute(sz, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uTex: { value: this.glowTex } }, vertexShader: `attribute float sz; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = sz; gl_Position = projectionMatrix*mv; }`, fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ float a = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vC*a*1.4, a); }`, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.stars = new THREE.Points(g, m); this.stars.frustumCulled = false; this.scene.add(this.stars);

    // nebula plane far below
    const nebMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
        void main(){
          vec2 p = vUv*6.0;
          float n1 = fbm(p + vec2(uTime*0.004, 0.0));
          float n2 = fbm(p*1.7 + vec2(3.1, -uTime*0.003));
          float d = smoothstep(0.42, 0.78, n1) * 0.9;
          vec3 c1 = vec3(0.06, 0.16, 0.42), c2 = vec3(0.45, 0.12, 0.38), c3 = vec3(0.02, 0.35, 0.45);
          vec3 col = mix(c1, c2, smoothstep(0.3,0.7,n2)) * d + c3 * smoothstep(0.6, 0.9, n1*n2*1.6) * 0.8;
          float edge = smoothstep(0.0, 0.25, vUv.x)*smoothstep(1.0,0.75,vUv.x)*smoothstep(0.0,0.25,vUv.y)*smoothstep(1.0,0.75,vUv.y);
          gl_FragColor = vec4(col*0.55, (d*0.75 + 0.1) * edge);
        }`
    });
    this.nebMat = nebMat;
    const neb = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 3.2, MAP * 3.2), nebMat); neb.rotation.x = -Math.PI / 2; neb.position.y = -1500; this.scene.add(neb);
    // dust layer for parallax
    const dn = 900, dp = new Float32Array(dn * 3), dc = new Float32Array(dn * 3), ds = new Float32Array(dn);
    for (let i = 0; i < dn; i++) { dp[i * 3] = (Math.random() - .5) * MAP * 1.6; dp[i * 3 + 1] = -120 - Math.random() * 500; dp[i * 3 + 2] = (Math.random() - .5) * MAP * 1.6; const k = 0.25 + Math.random() * 0.3; dc[i * 3] = k * 0.6; dc[i * 3 + 1] = k * 0.8; dc[i * 3 + 2] = k; ds[i] = 2 + Math.random() * 3; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('color', new THREE.BufferAttribute(dc, 3)); dg.setAttribute('sz', new THREE.BufferAttribute(ds, 1));
    this.scene.add(new THREE.Points(dg, m.clone()));
    // a distant planet
    const planet = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 32), new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 0.9, emissive: 0x0a1a30, flatShading: false }));
    planet.position.set(MAP * 0.9, -1400, -MAP * 0.7); this.scene.add(planet);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(560, 48, 32), new THREE.MeshBasicMaterial({ color: 0x4f90ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false }));
    atm.position.copy(planet.position); this.scene.add(atm);
    // grid of faint boundary lines
    const L = MAP / 2; const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L, 0, -L), new THREE.Vector3(L, 0, -L), new THREE.Vector3(L, 0, L), new THREE.Vector3(-L, 0, L), new THREE.Vector3(-L, 0, -L)]);
    this.scene.add(new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0x1b3550, transparent: true, opacity: 0.5 })));
  }

  // ------------------------------------------------------------ projectiles
  buildProjectiles() {
    this.proj = {};
    for (const k of PROJ_KINDS) {
      const st = PROJ_STYLE[k];
      const geo = k === 'mortar' ? new THREE.SphereGeometry(st.s[1] * 0.5, 8, 6) : new THREE.BoxGeometry(st.s[0], st.s[1], st.s[2]);
      const mat = new THREE.MeshBasicMaterial({ color: st.color }); mat.color.multiplyScalar(st.mult);
      const im = new THREE.InstancedMesh(geo, mat, 600); im.count = 0; im.frustumCulled = false; this.scene.add(im);
      this.proj[k] = im;
    }
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s3 = new THREE.Vector3(1, 1, 1); this._p3 = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  // ------------------------------------------------------------------ ships
  makeShieldMat(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uHit: { value: 0 }, uHitDir: { value: new THREE.Vector3(1, 0, 0) }, uBase: { value: 0.0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz; vL = normalize(position); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uHit; uniform vec3 uHitDir; uniform float uBase; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vL;
        void main(){ float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
          float dd = dot(vL, uHitDir); float hit = uHit * smoothstep(0.1, 1.0, dd);
          float ripple = 0.5 + 0.5*sin((1.0-dd)*40.0 - uTime*30.0);
          float a = fres*(uBase + uHit*0.35) + hit*(0.55 + 0.35*ripple);
          gl_FragColor = vec4(uColor*(1.2 + hit*1.5), clamp(a, 0.0, 1.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
  }

  createView(s) {
    const g = new THREE.Group(); const d = s.d; const team = s.team % TEAM_COLORS.length;
    const geo = shipGeometry(s.type, d.len);
    const hull = new THREE.Mesh(geo.hull, this.hullMats[team]); g.add(hull);
    const glow = new THREE.Mesh(geo.glow, this.glowMats[team]); g.add(glow);
    for (const eg of geo.extraGlow) { let m = this.extraGlowMats.get(eg.color); if (!m) { m = new THREE.MeshBasicMaterial({ color: eg.color }); m.color.multiplyScalar(1.6); this.extraGlowMats.set(eg.color, m); } g.add(new THREE.Mesh(eg.geo, m)); }
    const engines = [];
    for (const e of ENGINES[s.type]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: team === 0 ? 0x66ccff : TEAM_COLORS[team], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.position.set(e[0] * d.len, e[1] * d.len, e[2] * d.len); sp.userData.k = e[3]; g.add(sp); engines.push(sp);
    }
    const shMat = this.makeShieldMat(TEAM_COLORS[team]);
    const shield = new THREE.Mesh(this.shieldGeo, shMat); shield.scale.set(d.len * 0.62, d.size * 0.9, d.size * 1.25); g.add(shield);
    const sel = new THREE.Mesh(this.selGeo, this.selMat); sel.scale.setScalar(d.size * 1.25); sel.position.y = -d.size * 0.3; sel.visible = false; g.add(sel);
    this.scene.add(g);
    const v = { g, hull, glow, engines, shield, shMat, sel, hit: 0, warpT: s.flags & F_WARPIN ? 1 : 0, bob: Math.random() * 10, stunT: 0 };
    return v;
  }

  // -------------------------------------------------------------- events
  handleEvents(events, world, myTeam) {
    for (const e of events) {
      switch (e.e) {
        case 'exp': {
          explosion(this.P, e.x, e.y, e.s, e.k);
          if (e.k >= 1) this.rings.spawn(e.x, 1, e.y, e.s * 0.3, e.s * (e.k === 2 ? 5 : 2.5), e.k === 2 ? 1.2 : 0.5, e.k === 3 ? 0xb070ff : 0xffb070, e.k === 2 ? 0.9 : 0.5);
          if (e.k === 2) { this.debris.spawn(e.x, 0, e.y, e.s, Math.min(14, Math.floor(e.s / 5))); this.shake(Math.min(1, e.s / 50)); }
          break;
        }
        case 'sh': { const v = this.views.get(e.id); const s = world.ships.get(e.id); if (v && s) { v.hit = 1; const dx = e.x - s.x, dz = e.y - s.y; const ca = Math.cos(s.rot), sa = Math.sin(s.rot); // to local
          const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca; v.shMat.uniforms.uHitDir.value.set(lx, 0.2, lz).normalize(); }
          for (let i = 0; i < 4; i++) { const c = colorOf(TEAM_COLORS[(s ? s.team : 0) % 4]); this.P.spawn(e.x, 2, e.y, (Math.random() - .5) * 40, Math.random() * 10, (Math.random() - .5) * 40, c[0], c[1], c[2], 0.3, 3, 2); }
          break; }
        case 'warp': { this.rings.spawn(e.x, 1, e.y, e.s * 0.2, e.s * 3, 0.9, 0x9fe9ff, 0.8); for (let i = 0; i < 40 + e.s; i++) { const a = Math.random() * Math.PI * 2, r = e.s * 2; this.P.spawn(e.x + Math.cos(a) * r, 0, e.y + Math.sin(a) * r, -Math.cos(a) * r * 1.5, 0, -Math.sin(a) * r * 1.5, 0.6, 0.9, 1, 0.7, 3 + Math.random() * 3, 1); } this.P.spawn(e.x, 2, e.y, 0, 0, 0, 0.8, 0.95, 1, 0.5, e.s * 2.5, 0); break; }
        case 'jump': { this.rings.spawn(e.x1, 1, e.y1, e.s * 0.5, e.s * 2.5, 0.7, 0x9fe9ff, 0.8); this.rings.spawn(e.x2, 1, e.y2, e.s * 0.2, e.s * 3.5, 1.0, 0x9fe9ff, 0.9); const n = 120; for (let i = 0; i < n; i++) { const k = i / n; this.P.spawn(e.x1 + (e.x2 - e.x1) * k, 2 + (Math.random() - .5) * 10, e.y1 + (e.y2 - e.y1) * k, (Math.random() - .5) * 30, 0, (Math.random() - .5) * 30, 0.6, 0.9, 1, 0.5 + k * 0.5, 4 + Math.random() * 6, 2); } this.shake(0.6); break; }
        case 'emp': { this.rings.spawn(e.x, 2, e.y, 20, e.r, 0.9, 0x7fe9ff, 1); this.rings.spawn(e.x, 2, e.y, 10, e.r * 0.8, 1.3, 0xffffff, 0.6); for (let i = 0; i < 300; i++) { const a = Math.random() * Math.PI * 2, v = e.r * (0.8 + Math.random() * 0.6); this.P.spawn(e.x, 3, e.y, Math.cos(a) * v, (Math.random() - .5) * 30, Math.sin(a) * v, 0.5, 0.9, 1, 0.9, 3 + Math.random() * 4, 1.2); } this.shake(0.8); break; }
        case 'muz': { this.P.spawn(e.x, 3, e.y, 0, 0, 0, 1, 0.95, 0.8, 0.12, e.s * 2.5, 0); break; }
        case 'over': { const s = world.ships.get(e.id); if (s) { this.rings.spawn(s.x, 1, s.y, s.d.size * 0.5, s.d.size * 2.2, 0.8, 0x4ff0ff, 0.9); const v = this.views.get(e.id); if (v) v.overFlash = 1; } break; }
      }
    }
  }
  shake(k) { this.cam.shake = Math.min(1.5, this.cam.shake + k * 0.6); }

  // ------------------------------------------------------------- update
  updateCamera(dt) {
    const cam = this.cam;
    cam.x += (cam.tx - cam.x) * Math.min(1, dt * 8); cam.z += (cam.tz - cam.z) * Math.min(1, dt * 8); cam.zoom += (cam.tzoom - cam.zoom) * Math.min(1, dt * 8);
    const dist = 260 + cam.zoom * cam.zoom * 2900, pitch = THREE.MathUtils.lerp(58, 74, cam.zoom) * Math.PI / 180;
    let sx = 0, sz = 0; if (cam.shake > 0) { cam.shake -= dt * 2.2; const k = cam.shake * cam.shake * 6; sx = (Math.random() - .5) * k; sz = (Math.random() - .5) * k; }
    this.camera.position.set(cam.x + sx, Math.sin(pitch) * dist, cam.z + Math.cos(pitch) * dist + sz);
    this.camera.lookAt(cam.x + sx, 0, cam.z + sz);
    this.camera.updateMatrixWorld();
    this.stars.position.copy(this.camera.position);
  }

  update(world, dt, ui) {
    this.time += dt;
    this.nebMat.uniforms.uTime.value = this.time;

    // ships
    const seen = new Set();
    for (const s of world.ships.values()) {
      seen.add(s.id);
      let v = this.views.get(s.id); if (!v) { v = this.createView(s); this.views.set(s.id, v); }
      const g = v.g; g.position.set(s.x, 0, s.y); g.rotation.y = -s.rot;
      // banking from turn rate + subtle bob
      const turn = (s.crot - s.prot); v.bank = (v.bank || 0) + ((Math.abs(turn) < 3 ? -turn * (s.d.cls === 'strike' ? 6 : 2) : 0) - (v.bank || 0)) * Math.min(1, dt * 4);
      g.rotation.x = v.bank; g.position.y = Math.sin(this.time * 0.7 + v.bob) * (s.d.cls === 'strike' ? 1.5 : 0.6);
      const dead = s.flags & F_DEAD;
      if (dead) { g.rotation.z += dt * 0.15; g.position.y -= dt * 6; v.hull.material = this.hullMats[s.team % 4]; }
      // warp-in scale
      if (s.flags & F_WARPIN) { v.warpT = Math.min(1, v.warpT + dt * 0.9); g.scale.set(0.2 + 0.8 * v.warpT, 1, 1); }
      else if (g.scale.x < 1) { g.scale.x = Math.min(1, g.scale.x + dt * 2); }
      // engines
      const thr = dead ? 0 : s.thr;
      for (const sp of v.engines) { const k = sp.userData.k * s.d.len * (0.08 + 0.22 * thr) * (1 + 0.15 * Math.sin(this.time * 20 + v.bob)); sp.scale.set(k * 2.2, k, 1); sp.material.opacity = 0.3 + thr * 0.7; }
      if (thr > 0.3 && !dead && Math.random() < thr * 0.9) for (const sp of v.engines) { const wx = s.x + (sp.position.x * Math.cos(s.rot) - sp.position.z * Math.sin(s.rot)), wz = s.y + (sp.position.x * Math.sin(s.rot) + sp.position.z * Math.cos(s.rot)); const c = s.team === 0 ? [0.4, 0.8, 1] : colorOf(TEAM_COLORS[s.team % 4]); this.P.spawn(wx, sp.position.y, wz, -Math.cos(s.rot) * 40 * thr + (Math.random() - .5) * 8, 0, -Math.sin(s.rot) * 40 * thr + (Math.random() - .5) * 8, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 0.35 + s.d.size * 0.004, 1.5 + s.d.size * 0.05, 1); }
      // shield
      v.hit = Math.max(0, v.hit - dt * 3);
      const shRatio = s.maxSh ? s.sh / s.maxSh : 0;
      v.shMat.uniforms.uHit.value = v.hit * (shRatio > 0 ? 1 : 0.2);
      v.shMat.uniforms.uBase.value = (s.flags & F_OVER ? 0.55 : 0.0) + (ui && ui.selected && ui.selected.has(s.id) ? 0.05 : 0) + (v.overFlash || 0) * 0.5;
      v.shMat.uniforms.uTime.value = this.time;
      if (v.overFlash) v.overFlash = Math.max(0, v.overFlash - dt);
      v.shield.visible = !dead && (v.hit > 0 || (s.flags & F_OVER) || v.overFlash > 0);
      // stun sparks
      if ((s.flags & F_STUN) && Math.random() < 0.4) { const a = Math.random() * Math.PI * 2, r = Math.random() * s.d.size; this.P.spawn(s.x + Math.cos(a) * r, 4, s.y + Math.sin(a) * r, 0, 10, 0, 0.5, 0.9, 1, 0.25, 3, 0); }
      // burning when damaged
      if (!dead && s.hp < s.maxHp * 0.4 && s.d.size >= 12 && Math.random() < dt * 8 * (1 - s.hp / s.maxHp)) { const a = Math.random() * Math.PI * 2, r = Math.random() * s.d.size * 0.6; this.P.spawn(s.x + Math.cos(a) * r, 3, s.y + Math.sin(a) * r, (Math.random() - .5) * 6, 10 + Math.random() * 10, (Math.random() - .5) * 6, 1, 0.5, 0.15, 0.6 + Math.random() * 0.6, 3 + Math.random() * 4, 0.5); }
      // selection ring
      v.sel.visible = !!(ui && ui.selected && ui.selected.has(s.id));
      if (v.sel.visible) v.sel.material = this.selMat;
      if (ui && ui.hover === s.id && !v.sel.visible) { v.sel.visible = true; v.sel.material = this.hoverMat; }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.scene.remove(v.g); v.shMat.dispose(); for (const sp of v.engines) sp.material.dispose(); this.views.delete(id); }

    // projectiles
    const counts = {}; for (const k of PROJ_KINDS) counts[k] = 0;
    for (const p of world.projectiles.values()) {
      const k = PROJ_KINDS[p.kind]; const im = this.proj[k]; const i = counts[k]++; if (i >= 600) continue;
      this._e.set(0, -p.rot, 0); this._q.setFromEuler(this._e); this._p3.set(p.x, 2, p.y);
      im.setMatrixAt(i, this._m4.compose(this._p3, this._q, this._s3));
      if (k === 'torpedo' || k === 'missile' || k === 'mortar') { const st = PROJ_STYLE[k]; const c = colorOf(st.color); this.P.spawn(p.x, 2, p.y, (Math.random() - .5) * 6, 2, (Math.random() - .5) * 6, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, k === 'torpedo' ? 0.9 : 0.5, k === 'torpedo' ? 4 : 2.5, 1); }
    }
    for (const k of PROJ_KINDS) { this.proj[k].count = counts[k]; this.proj[k].instanceMatrix.needsUpdate = true; }

    // beams
    this.beams.begin();
    for (const b of world.beams) {
      const k = BEAM_KINDS[b[0]];
      if (k === 'pd') this.beams.draw(b[1], 2, b[2], b[3], 2, b[4], 0xa0ffb0, 0.6, 0.7, this.time);
      else if (k === 'repair') { this.beams.draw(b[1], 3, b[2], b[3], 3, b[4], 0x5cff9d, 1.5, 0.8, this.time); if (Math.random() < 0.5) this.P.spawn(b[3], 3, b[4], (Math.random() - .5) * 20, 15, (Math.random() - .5) * 20, 0.35, 1, 0.6, 0.5, 3, 1); }
      else if (k === 'lance') { this.beams.draw(b[1], 3, b[2], b[3], 3, b[4], 0x9fd8ff, 7, 1.3, this.time); for (let i = 0; i < 6; i++) { const t = Math.random(); this.P.spawn(b[1] + (b[3] - b[1]) * t, 3, b[2] + (b[4] - b[2]) * t, (Math.random() - .5) * 60, (Math.random()) * 30, (Math.random() - .5) * 60, 0.6, 0.85, 1, 0.5, 5, 1); } }
      else { const w = WEAPONS[k]; this.beams.draw(b[1], 3, b[2], b[3], 3, b[4], w.color, w.width, 1, this.time); if (Math.random() < 0.6) { const c = colorOf(w.color); this.P.spawn(b[3], 3, b[4], (Math.random() - .5) * 50, 10, (Math.random() - .5) * 50, c[0], c[1], c[2], 0.3, 3, 2); } }
    }
    this.beams.end();

    this.P.update(dt); this.rings.update(dt); this.debris.update(dt);
    this.composer.render();
  }

  // ------------------------------------------------------------ picking
  screenToWorld(px, py) {
    this._v2.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this._ray.setFromCamera(this._v2, this.camera);
    const hit = this._ray.ray.intersectPlane(this._plane, this._v);
    return hit ? { x: hit.x, y: hit.z } : null;
  }
  worldToScreen(x, y, h = 0) {
    this._v.set(x, h, y).project(this.camera);
    return { x: (this._v.x + 1) / 2 * window.innerWidth, y: (1 - this._v.y) / 2 * window.innerHeight, behind: this._v.z > 1 };
  }
}
