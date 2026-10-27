# Star Fleet Command

A 2.5D multiplayer starship command game. You captain a massive dreadnought with its own weapons and abilities **and** command an entire fleet — battlecruisers, cruisers, destroyers, frigates, corvettes, carriers with fighter and bomber wings, siege platforms, repair tenders.

Runs entirely in the browser with no server: static files on GitHub Pages, peer-to-peer multiplayer over WebRTC.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (for example `StarFleetCommand`).
2. Push this folder to it:
   ```
   git init
   git add .
   git commit -m "Star Fleet Command"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/StarFleetCommand.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. After a minute the game is live at `https://YOUR-USERNAME.github.io/StarFleetCommand/`.

No build step, no dependencies to install — `.nojekyll` is included so Pages serves the files as-is. Three.js and PeerJS are vendored under `lib/`.

## Multiplayer

One player clicks **Host a Battle** and gets a 5-letter room code (and an invite link). Others enter the code on the main menu and **Join**. The host's browser runs the authoritative simulation and streams the battle to everyone else over a direct WebRTC connection (signaling via the free public PeerJS server). The host can also play solo.

Modes (chosen by the host in the lobby):

- **Co-op: Armada Assault** — every commander fights on the same side against 12 escalating enemy waves. Every 4th wave brings an enemy dreadnought.
- **PvP: Fleet War** — two teams. Click your name in the lobby to switch sides. Destroy every enemy dreadnought to win.

AI admirals can be added to either mode (allies in co-op, filling both sides in PvP).

Note: WebRTC needs a direct path between players. Most home networks work out of the box; a few restrictive corporate/mobile NATs may fail to connect since no TURN relay is configured.

## Controls

| Action | Input |
|---|---|
| Select ships | Left click / drag box. **Shift** adds to the selection. Double-click selects all of that class. |
| Select flagship | **Tab** |
| Control groups | **Ctrl+1–9** assign, **1–9** recall |
| Move | Right click |
| Attack | Right click an enemy |
| Escort | Right click a friendly ship |
| Attack-move | **A** then click (or **Alt** + right click) |
| Hold position | **S** |
| Escort flagship / Retreat | **G** / **H** |
| Formation / Stance | Buttons in the command panel (wedge, line, column, screen · aggressive, defensive, passive) |
| Direct Control | **C** or the button: **WASD** flies the dreadnought, mouse aims, left click fires the heavy cannons. Fleet orders still work with right click. |
| Flagship abilities | **Q** Shield Overcharge · **E** EMP Nova · **R** Spinal Lance (aims at cursor) · **F** Launch Interceptor Wing · **T** Micro-Jump to cursor |
| Reinforcements | Spend Command Points (earned over time and from kills) in the Reinforcements panel to warp in new ships beside your flagship |
| Camera | Arrow keys / screen edge to pan, mouse wheel to zoom, middle-drag to pan, **Space** to center on flagship, click the minimap to jump |

## Project layout

```
index.html        shell, menu, lobby and HUD markup
css/style.css     UI styling
js/main.js        menu/lobby flow, host & client plumbing, game loop
js/defs.js        ship classes, weapons, abilities, balance numbers
js/sim.js         authoritative simulation (physics, weapons, damage, waves, win conditions)
js/ai.js          formations, per-ship combat behaviour, AI commanders
js/world.js       client-side interpolated state built from snapshots
js/render.js      Three.js scene, camera, ships, projectiles, backgrounds
js/shipmodels.js  procedural 3D hull generator for every ship class
js/fx.js          GPU particles, beams, shockwave rings, debris
js/input.js       RTS selection and orders, hotkeys, Direct Control
js/ui.js          HUD panels, overlay bars, minimap
js/net.js         PeerJS host/join transport
lib/              vendored three.js (+ bloom post-processing) and peerjs
```

Tuning the game is mostly a matter of editing `js/defs.js`: ship stats, weapon numbers, ability cooldowns, wave composition, reinforcement costs and the fleet cap.
