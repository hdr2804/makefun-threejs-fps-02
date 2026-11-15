// DUSTLINE YARD — boot and wiring. This file builds the renderer, creates
// every module once, connects them (bots hear through the hearing bus, the
// plan layer writes their directives, the simulation resolves the rest),
// owns the camera and the render loop, and stages the deterministic
// screenshot scenes. The game itself lives in the modules: sim.js runs the
// fixed-step simulation, teamplan.js runs the squads, ballistics.js prices
// every shot. ?shot=action|planted|buy|scope with &seed=N sets up a
// real game state for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState } from './state.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapons } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createHearing } from './hearing.js';
import { createBots } from './bots.js';
import { createTeamPlan } from './teamplan.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './fx.js';
import { createSim, FIXED_STEP } from './sim.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 34, 88);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const map = createMap(scene);
const player = createPlayer(map.colliders);
const weapons = createWeapons(camera);
const fx = createEffects(scene);
const audio = createAudio();
const hearing = createHearing();
const hud = createHud();
const body = player.state;
const throwOrigin = new THREE.Vector3();
let sim = null;

const grenades = createGrenades(scene, map.colliders, {
  fragAt: (pos, thrower) => sim.fragAt(pos, thrower),
  flashAt: (pos) => sim.flashAt(pos),
  smokeAt: (pos) => sim.smokeAt(pos),
});

const bots = createBots(scene, map, {
  rng,
  now: () => state.now,
  playerState: () => body,
  playerSpeed: () => player.groundSpeed(),
  damagePlayer: (dmg, bot) => sim.damagePlayer(dmg, bot),
  damageBot: (target, dmg, fromBot) => sim.damageBot(target, dmg, fromBot),
  tracer: (from, to) => fx.tracer(from, to),
  botShot: (bot) => {
    const d = Math.hypot(bot.pos.x - body.position.x, bot.pos.z - body.position.z);
    if (d < 32) audio.distantShot();
    hearing.publish('shot', bot.pos.x, bot.pos.z, bot.team, 26, state.now);
  },
  bombState: () => {
    const s = sim.rounds.state;
    if (!s.bombPos) return { planted: false, x: 0, z: 0 };
    return { planted: s.phase === 'planted', x: s.bombPos.x, z: s.bombPos.z };
  },
  defuser: () => {
    let best = null;
    let bestD = Infinity;
    for (const b of bots.bots) {
      if (b.team !== 'enemy' || !b.alive) continue;
      const d = Math.hypot(b.pos.x - sim.rounds.state.bombPos.x, b.pos.z - sim.rounds.state.bombPos.z);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  },
  defuseTick: (progress) => hud.setPlant(progress / 4, 'JACKAL DEFUSING THE SPIKE'),
  bombDefused: (bot) => {
    hud.killFeed(bot.name + ' defused the spike');
    sim.rounds.defused();
  },
  losBlocked: (a, b) => sim.losBlocked(a, b),
  contact: (bot, tx, tz) => teamplan.onContact(bot, tx, tz),
  // The HUD feed is the Vanguard net: Jackal callouts stay on their own net.
  callout: (bot, text) => { if (bot.team === 'ally') hud.radio(bot.name, text); },
  throwUtility: (bot, type, tx, tz) => {
    throwOrigin.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    grenades.throwAt(throwOrigin, tx, tz, type, bot.team, bot);
  },
});
hearing.subscribe((e) => bots.hearEvent(e));

const teamplan = createTeamPlan({
  map,
  bots,
  radio: (name, text, team) => { if (team === 'ally') hud.radio(name, text); },
  now: () => state.now,
});

const input = createInput(renderer.domElement, onLockChange);

sim = createSim({
  scene, camera, state, map, player, input, weapons, bots, hud, audio, fx,
  grenades, hearing, teamplan, rng, staging: !!shot,
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    state.started = true;
    hud.hideOverlay();
    hud.showBuy(false);
    sim.rounds.state.buyOpen = false;
  } else if (state.started && sim.rounds.state.phase !== 'match' && !sim.rounds.state.buyOpen) {
    hud.showOverlay(sim.rounds.state.phase === 'ended' && !body.alive ? 'dead' : 'paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  if (sim.rounds.state.phase === 'match') {
    grenades.reset();
    sim.rounds.resetMatch();
    hud.hideOverlay();
  }
  input.requestLock();
});
hud.onBuyClose(() => {
  sim.rounds.state.buyOpen = false;
  hud.showBuy(false);
  input.requestLock();
});

let fovNow = 74;
function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  const shake = state.trauma * state.trauma * 0.03;
  camera.rotation.set(
    body.pitch + (rng() - 0.5) * shake,
    body.yaw + (rng() - 0.5) * shake,
    (rng() - 0.5) * shake * 0.5,
    'YXZ',
  );
  // Aiming narrows the field of view; the LS-7's scope narrows it to a tunnel.
  const scoped = weapons.state.current === 'ls7' && weapons.state.adsBlend > 0.65;
  const targetFov = weapons.state.adsBlend > 0.05
    ? (weapons.state.current === 'ls7' ? 74 - 44 * weapons.state.adsBlend : 74 - 20 * weapons.state.adsBlend)
    : 74;
  if (Math.abs(targetFov - fovNow) > 0.05) {
    fovNow += (targetFov - fovNow) * 0.45;
    camera.fov = fovNow;
    camera.updateProjectionMatrix();
  }
  hud.setScope(scoped && state.started);
}

const aimTmp = new THREE.Vector3();
function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

let lastTime = performance.now();
function frame(time) {
  requestAnimationFrame(frame);
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (!state.frozen) {
    const look = input.takeLook();
    sim.frame(dt, look);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) sim.stepOnce();
}

function placeBot(bot, x, z, faceX, faceZ) {
  bot.pos.set(x, 0, z);
  bot.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
  bot.group.position.copy(bot.pos);
  bot.group.rotation.set(0, bot.yaw, 0);
}

const fxFrom = new THREE.Vector3();
const fxTo = new THREE.Vector3();

function stageAction(rounds) {
  // THE COVER: an Execute A in motion. Sable leads, Wren's flash is in the
  // air over the choke, the player has just dropped Rook mid-cross.
  rounds.state.phase = 'live';
  rounds.state.phaseLeft = 67;
  rounds.state.wins = 2;
  rounds.state.losses = 1;
  rounds.state.round = 4;
  rounds.state.money = 1150;
  weapons.buy('vk47');
  weapons.switchTo('vk47');
  weapons.state.cooldown = 0;
  grenades.counts.frag = 1;
  grenades.counts.flash = 1;
  player.reset(-7.5, 0.5);
  const rook = bots.bots[0];
  placeBot(rook, -13.5, -6.8, body.position.x, body.position.z);
  const vex = bots.bots[1];
  placeBot(vex, -17.5, -10.5, body.position.x, body.position.z);
  placeBot(bots.bots[5], -11.6, -0.8, rook.pos.x, rook.pos.z);
  placeBot(bots.bots[6], -9.8, -0.5, rook.pos.x, rook.pos.z);
  placeBot(bots.bots[7], -5.5, 1.8, rook.pos.x, rook.pos.z);
  placeBot(bots.bots[8], 14.0, 9.0, map.siteB.x, map.siteB.z);
  teamplan.liveStart();
  settle(6);
  // Wren (support) flashes the A choke, exactly as her directive orders.
  throwOrigin.set(bots.bots[6].pos.x, 1.45, bots.bots[6].pos.z);
  grenades.throwAt(throwOrigin, -11.5, -7.6, 'flash', 'ally', bots.bots[6]);
  hud.radio('Wren', 'Flashing A!');
  aimAt(aimTmp.set(rook.pos.x, 1.25, rook.pos.z));
  sim.shootNow(0);
  settle(8);
  aimAt(aimTmp.set(rook.pos.x, 1.62, rook.pos.z));
  sim.shootNow(0);
  // Sable's tracer and an impact beside the player sell the exchange.
  fx.tracer(fxFrom.set(-11.6, 1.35, -0.8), fxTo.set(rook.pos.x + 0.5, 1.1, rook.pos.z));
  fx.spark(fxTo, 3);
  hud.hitMarker(true, 4000);
  body.hp = 76;
  settle(3);
  aimAt(aimTmp.set(vex.pos.x, 1.4, vex.pos.z));
}

function stagePlanted(rounds) {
  // THE DEFENCE: post-plant at A. The retake smokes the cross, Mara is on
  // the defuse, the player covers the ring from the east angle.
  rounds.state.phase = 'planted';
  rounds.state.phaseLeft = 18;
  rounds.state.bombSite = 'A';
  rounds.state.bombPos = { x: map.siteA.x, z: map.siteA.z };
  rounds.state.wins = 3;
  rounds.state.losses = 2;
  rounds.state.round = 6;
  rounds.state.money = 1750;
  weapons.buy('vk47');
  weapons.switchTo('vk47');
  grenades.counts.frag = 1;
  weapons.ammo.vk47.mag = 18;
  player.reset(-11.4, -3.2);
  sim.showBomb(map.siteA.x, map.siteA.z);
  const mara = bots.bots[2];
  placeBot(mara, map.siteA.x + 1.1, map.siteA.z + 0.9, map.siteA.x, map.siteA.z);
  placeBot(bots.bots[1], -11.8, -9.8, map.siteA.x, map.siteA.z);
  placeBot(bots.bots[4], -19.2, -8.6, body.position.x, body.position.z);
  placeBot(bots.bots[5], -19.9, -8.2, -12.5, -8.0);
  placeBot(bots.bots[7], -10.6, -2.4, -19.2, -8.6);
  bots.kill(bots.bots[3]);
  teamplan.onPlant('A');
  // Vex (retake support) smokes the A cross, exactly as her directive orders.
  throwOrigin.set(bots.bots[1].pos.x, 1.45, bots.bots[1].pos.z);
  grenades.throwAt(throwOrigin, -13.8, -8.2, 'smoke', 'enemy', bots.bots[1]);
  // Let the retake's smoke bloom and the defuse begin, then re-seat Mara:
  // the fight around her is real, and the capture wants her on the spike.
  settle(95);
  placeBot(mara, map.siteA.x + 1.1, map.siteA.z + 0.9, map.siteA.x, map.siteA.z);
  mara.alive = true;
  mara.hp = 100;
  mara.group.rotation.set(0, mara.yaw, 0);
  fx.tracer(fxFrom.set(-10.6, 1.35, -2.4), fxTo.set(-19.2 + 0.8, 1.2, -8.6));
  fx.spark(fxTo, 2);
  hud.banner('SPIKE PLANTED AT SITE A — DEFEND IT', 3000);
  hud.killFeed('Pax eliminated Kite');
  hud.setPlant(0.55, 'JACKAL DEFUSING THE SPIKE');
  body.hp = 64;
  aimAt(aimTmp.set(mara.pos.x, 1.3, mara.pos.z));
}

function stageBuy(rounds) {
  // THE BUY: round 4, a healthy bank, the carbine owned, full utility held.
  rounds.state.wins = 2;
  rounds.state.losses = 1;
  rounds.state.round = 4;
  weapons.buy('vk47');
  grenades.counts.frag = 1;
  grenades.counts.flash = 1;
  rounds.state.money = 1500;
  player.reset(map.spawns.player[0], map.spawns.player[1]);
  settle(20);
  aimAt(aimTmp.set(0, 1.5, -10));
  sim.buildBuyMenu();
  hud.showBuy(true);
}

function stageScope(rounds) {
  // THE SCOPE: down the LS-7's glass at Havoc holding the north lane.
  rounds.state.phase = 'live';
  rounds.state.phaseLeft = 84;
  rounds.state.wins = 1;
  rounds.state.losses = 1;
  rounds.state.round = 3;
  rounds.state.money = 900;
  weapons.buy('ls7');
  weapons.switchTo('ls7');
  weapons.ammo.ls7.mag = 4;
  grenades.counts.frag = 1;
  player.reset(2.5, 11.5);
  const havoc = bots.bots[4];
  placeBot(havoc, -0.5, -8.0, body.position.x, body.position.z);
  placeBot(bots.bots[1], 6.5, -3.5, body.position.x, body.position.z);
  placeBot(bots.bots[8], -1.8, 13.8, -1.5, -13.5);
  bots.kill(bots.bots[0]);
  settle(6);
  weapons.setAds(true);
  weapons.state.adsBlend = 1;
  weapons.step(0);
  aimAt(aimTmp.set(havoc.pos.x, 1.55, havoc.pos.z));
  camera.fov = 30;
  fovNow = 30;
  camera.updateProjectionMatrix();
  hud.setScope(true);
  hud.killFeed('Pax eliminated Rook');
}

function runShot(name) {
  state.started = true;
  hud.hideOverlay();
  sim.rounds.startRound();
  // Clear the round-start banner directly; each staging sets its own (or none).
  document.getElementById('banner').classList.add('hidden');
  body.pitch = 0;
  body.yaw = 0;
  const rounds = sim.rounds;
  if (name === 'planted') stagePlanted(rounds);
  else if (name === 'buy') stageBuy(rounds);
  else if (name === 'scope') stageScope(rounds);
  else stageAction(rounds);
  hud.setHealth(body.hp);
  const def = weapons.def();
  const am = weapons.ammo[weapons.state.current];
  hud.setAmmo(am.mag, am.reserve, def.name, grenades.counts);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.phaseLeft, rounds.state.phase);
  hud.setScore(rounds.state.wins, rounds.state.losses, rounds.state.round);
  hud.setAlive((body.alive ? 1 : 0) + bots.aliveCount('ally'), bots.aliveCount('enemy'));
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      state.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// The staging/test handle: the screenshot harness and the smoke test read
// the live state through here instead of reaching into closures.
window.__dustline = { state, rounds: sim.rounds.state, bots: bots.bots, sim, input, player, weapons, grenades, fx };

syncCamera();
hud.setHealth(100);
hud.setAmmo(12, 48, 'P9 Sidearm', grenades.counts);
hud.setMoney(800);
hud.setTimer(10, 'buy');
hud.setScore(0, 0, 1);
hud.setAlive(5, 5);
sim.rounds.startRound();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
