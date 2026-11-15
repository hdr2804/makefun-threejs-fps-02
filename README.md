# DUSTLINE YARD — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built original from the ground up for make.fun's `threejs-fps-02`
bounty. No map, name, art or sound is copied from any commercial game.

## The game

Two 5-player teams fight over an industrial yard at golden hour. **Vanguard**
(you + 4 ally bots) attacks; the **Jackals** (5 bots) defend two bomb sites —
**A, the silo yard**, and **B, the depot** — joined by three lanes: west, mid
through the container arch, and east. The yard is dressed like a real work
site: cylindrical silos, corrugated containers, barrel clusters, sandbag
lines, floodlight poles, hazard-striped site pads and lit pixel-letter site
signs, under a low sun with a skyline on the horizon.

- **Rounds**: first to 5 round wins (max 9). A round is won by eliminating
  the enemy team or by planting the spike and letting it detonate; it is
  lost if you are eliminated, the timer expires, or the Jackals defuse.
- **Objective**: hold **E** inside a site ring to plant the spike (3 s).
  Once planted the 35 s fuse runs and the nearest Jackal walks in to defuse
  (4 s channel) — defend it.
- **Economy**: kills +$200, round win +$600, round loss +$300, plant +$300.
  Spend it in the buy menu (**B**, during the 10 s buy phase) on weapons
  and frag grenades.
- **Arsenal**: P9 Sidearm (free), VK-47 Carbine ($900, full-auto), SC-12
  Scattergun ($700, 8 pellets), LS-7 Longshot ($1500, high-damage DMR with
  a working scope), Frag Grenade ($300, **G**).
- **Gunplay**: headshots deal 2.5x, spread and recoil punish firing on the
  move, and **right-click aims down sights** — spread more than halves, the
  view narrows, and the LS-7 raises its scope reticle. Movement has
  acceleration and friction, crouch (**Ctrl**/**C**) and jump (**Space**)
  work, and every wall and crate collides.
- **Bots**: Jackals patrol the waypoint graph, hold their sites, chase the
  last place they saw or heard a shot, strafe while firing in bursts, and
  converge to defuse a planted spike. Allies push the lanes with you.
- **HUD**: health, ammo, weapon, grenades, money, round timer, round score,
  alive counts, kill feed, hitmarker, plant/defuse progress, damage vignette.
- **Sound**: all synthesised with WebAudio — shots, reloads, hits,
  explosions, plant beeps, round jingles. No audio files, no network.

## Play it

Serve `game/` with any static server and open `game/index.html` in desktop
Chrome:

```sh
node serve.ts   # serves game/ at http://localhost:8080
```

Click **Deploy**, then play. Screenshots: open with
`?shot=action|planted|buy|scope` for the four staged captures (the cover is
the mid-lane firefight; the others are the spike defence, the buy menu and
the LS-7 scope).

## Layout

- `main.ts` — the make.fun entrypoint: copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json` with `vendor/makefun-threejs.ts`,
  after checking the screenshot count and that the dossier rebuilds byte
  for byte.
- `game/index.html` — the page and HUD (including the scope overlay).
- `game/src/` — one module per job: `main.js` (loop, shooting, grenades,
  ADS, shot staging), `map.js` (the yard, its props and waypoint graph),
  `player.js` (movement/collision), `bots.js` (5v5 AI), `weapons.js`
  (arsenal, view models, muzzle flash, ADS), `rounds.js` (rounds + money),
  `hud.js` (DOM HUD), `audio.js` (synth), `effects.js` (tracers, sparks,
  dust, blasts), `palette.js` (the golden-hour look), `input.js`
  (keyboard/mouse/pointer lock).
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit.
- `screenshots/` — 4 real renders of this game in headless Chrome.

## License

MIT — see `LICENSE`.
