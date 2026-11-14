// DUSTLINE YARD boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. Owns the camera, the shooting ray, grenade physics, the plant /
// defuse flow and the round wiring; the modules own their own state.
// ?shot=start|play|buy|plant with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, BUY_SECONDS, ROUND_SECONDS, PLANT_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
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
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const player = createPlayer(map.colliders);
const weapons = createWeapons(camera);
const effects = createEffects(scene);
const audio = createAudio();
const body = player.state;

let now = 0;
let elapsed = 0;
let started = false;
let frozen = false;
let trauma = 0;
let accumulator = 0;
let lastTime = performance.now();
let bombMesh = null;
let bombLight = null;

const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const dir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const tmpV = new THREE.Vector3();

const hud = createHud();
const rounds = createRounds({
  onRoundStart(round) {
    resetPositions();
    weapons.refillAmmo();
    hideBomb();
    hud.setScore(rounds.state.wins, rounds.state.losses, round);
    hud.banner('ROUND ' + round + ' — BUY PHASE', 2000);
    if (!shot) hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, buyGrenade, 300);
  },
  onLiveStart() {
    hud.banner('PLANT THE SPIKE AT A OR B — OR ELIMINATE THE JACKALS', 2600);
    hud.showBuy(false);
  },
  onRoundEnd(won, reason, wins, losses) {
    hud.setScore(wins, losses, rounds.state.round);
    hud.banner((won ? 'ROUND WON — ' : 'ROUND LOST — ') + reason, 3400);
    if (won) audio.win(); else audio.lose();
    if (body.alive === false) {
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('dead');
    }
  },
  onMatchEnd(winner, wins, losses) {
    hud.setScore(wins, losses, rounds.state.round);
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay(winner === 'Vanguard' ? 'matchWin' : 'matchLose');
  },
  onPlanted(site) {
    showBomb(rounds.state.bombPos.x, rounds.state.bombPos.z);
    hud.banner('SPIKE PLANTED AT SITE ' + site + ' — DEFEND IT', 3000);
    audio.plantDone();
  },
  onBombExploded() {
    effects.explosion(tmpV.set(rounds.state.bombPos.x, 1, rounds.state.bombPos.z));
    audio.explosion();
    trauma = 1;
    hideBomb();
  },
});

const bots = createBots(scene, map, {
  rng,
  now: () => now,
  playerState: () => body,
  playerSpeed: () => player.groundSpeed(),
  damagePlayer(dmg, bot) {
    if (!body.alive) return;
    if (rounds.state.phase !== 'live' && rounds.state.phase !== 'planted') return;
    body.hp -= dmg;
    hud.damageFlash();
    audio.hurt();
    trauma = Math.min(1, trauma + 0.25);
    if (body.hp <= 0) {
      body.hp = 0;
      body.alive = false;
      rounds.state.deaths += 1;
      hud.killFeed(bot.name + ' eliminated you');
      rounds.endRound(false, 'You were eliminated.');
    }
  },
  damageBot(target, dmg, fromBot) {
    if (!target.alive) return;
    target.hp -= dmg;
    if (target.hp <= 0) {
      target.hp = 0;
      bots.kill(target);
      hud.killFeed((fromBot ? fromBot.name : 'Vanguard') + ' eliminated ' + target.name);
    }
  },
  tracer(from, to) {
    effects.tracer(tmpV.copy(from), to);
  },
  botShot(bot) {
    const d = Math.hypot(bot.pos.x - body.position.x, bot.pos.z - body.position.z);
    if (d < 32) audio.distantShot();
  },
  bombState() {
    const s = rounds.state;
    if (!s.bombPos) return { planted: false, x: 0, z: 0 };
    return { planted: s.phase === 'planted', x: s.bombPos.x, z: s.bombPos.z };
  },
  defuser() {
    let best = null;
    let bestD = Infinity;
    for (const b of bots.bots) {
      if (b.team !== 'enemy' || !b.alive) continue;
      const d = Math.hypot(b.pos.x - rounds.state.bombPos.x, b.pos.z - rounds.state.bombPos.z);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  },
  defuseTick(progress) {
    hud.setPlant(progress / 4, 'JACKAL DEFUSING THE SPIKE');
  },
  bombDefused(bot) {
    hud.killFeed(bot.name + ' defused the spike');
    rounds.defused();
  },
});

const input = createInput(renderer.domElement, onLockChange);

function resetPositions() {
  player.reset(map.spawns.player[0], map.spawns.player[1]);
  bots.reset(now);
  effects.hideAll();
  trauma = 0;
}

function showBomb(x, z) {
  if (!bombMesh) {
    bombMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.35),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.4, metalness: 0.3 }),
    );
    bombLight = new THREE.PointLight(new THREE.Color(PALETTE.enemy), 0, 5);
    scene.add(bombMesh, bombLight);
  }
  bombMesh.position.set(x, 0.15, z);
  bombMesh.visible = true;
  bombLight.position.set(x, 1, z);
  bombLight.visible = true;
}

function hideBomb() {
  if (bombMesh) { bombMesh.visible = false; bombLight.visible = false; }
  hud.setPlant(0, '');
}

function buyWeapon(id) {
  if (rounds.state.phase !== 'buy') return;
  if (!rounds.buyWeapon(id)) return;
  weapons.buy(id);
  audio.buy();
  hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, buyGrenade, 300);
  hud.setMoney(rounds.state.money);
}

function buyGrenade() {
  if (rounds.state.phase !== 'buy') return;
  if (!rounds.buyGrenade()) return;
  weapons.state.grenades += 1;
  audio.buy();
  hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, buyGrenade, 300);
  hud.setMoney(rounds.state.money);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(false);
    rounds.state.buyOpen = false;
  } else if (started && rounds.state.phase !== 'match' && !rounds.state.buyOpen) {
    hud.showOverlay(rounds.state.phase === 'ended' && !body.alive ? 'dead' : 'paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  if (rounds.state.phase === 'match') {
    rounds.resetMatch();
    hud.hideOverlay();
  }
  input.requestLock();
});
hud.onBuyClose(() => {
  rounds.state.buyOpen = false;
  hud.showBuy(false);
  input.requestLock();
});

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  const shake = trauma * trauma * 0.03;
  camera.rotation.set(
    body.pitch + (rng() - 0.5) * shake,
    body.yaw + (rng() - 0.5) * shake,
    (rng() - 0.5) * shake * 0.5,
    'YXZ',
  );
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function shoot(spread) {
  if (!weapons.ready()) return false;
  if (!weapons.canFire()) {
    audio.dry();
    return false;
  }
  weapons.takeRound();
  const def = weapons.def();
  camera.getWorldDirection(dir);
  weapons.muzzleWorld(muzzle);
  let hitSomething = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    tmpV.copy(dir);
    tmpV.x += (rng() * 2 - 1) * spread;
    tmpV.y += (rng() * 2 - 1) * spread;
    tmpV.z += (rng() * 2 - 1) * spread;
    tmpV.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, tmpV);
    // Two raycasts, no allocation: the nearer of the wall hit and the bot hit wins.
    const wallHit = raycaster.intersectObjects(map.shootables, false)[0];
    const botHit = raycaster.intersectObjects(bots.hitMeshes(), false)[0];
    const hit = !wallHit ? botHit : !botHit ? wallHit : wallHit.distance < botHit.distance ? wallHit : botHit;
    if (!hit) {
      hitPoint.copy(camera.position).addScaledVector(tmpV, def.range);
      effects.tracer(muzzle, hitPoint);
      continue;
    }
    hitPoint.copy(hit.point);
    effects.tracer(muzzle, hitPoint);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const isHead = hit.object.userData.part === 'head';
      let dmg = def.damage * (isHead ? def.headMult : 1);
      if (hit.distance > 25) dmg *= 0.75;
      bot.hp -= dmg;
      hitSomething = true;
      hud.hitMarker(bot.hp <= 0, bot.hp <= 0 ? 4000 : 90);
      if (bot.hp <= 0) {
        bot.hp = 0;
        bots.kill(bot);
        rounds.onKill(true);
        hud.killFeed('You eliminated ' + bot.name + (isHead ? ' — HEADSHOT' : ''));
        audio.kill();
        if (bots.aliveCount('enemy') === 0 && rounds.state.phase !== 'ended' && rounds.state.phase !== 'match') {
          rounds.endRound(true, 'All Jackals eliminated.');
        }
      } else {
        audio.hit();
        bot.lastSeen.copy(body.position);
        bot.lastSeenAt = now;
      }
      effects.spark(hitPoint, 2);
    } else {
      effects.spark(hitPoint, 3);
    }
  }
  bots.hearShot(body.position, 'player');
  audio.shot(def.id);
  player.recoil(def.kick * 0.8, (rng() * 2 - 1) * def.kick * 0.3);
  trauma = Math.min(1, trauma + def.kick * 6);
  return hitSomething;
}

function throwGrenade() {
  if (weapons.state.grenades <= 0) return;
  weapons.state.grenades -= 1;
  camera.getWorldDirection(dir);
  const from = tmpV.copy(camera.position);
  effects.throwGrenade(from, dir);
  audio.tick();
}

function explodeGrenade(g) {
  effects.explosion(g.pos);
  audio.explosion();
  const pd = Math.hypot(g.pos.x - body.position.x, g.pos.z - body.position.z);
  if (pd < 6 && body.alive) {
    body.hp -= Math.round(45 * (1 - pd / 7));
    hud.damageFlash();
    if (body.hp <= 0) {
      body.hp = 0;
      body.alive = false;
      rounds.endRound(false, 'Caught by your own grenade.');
    }
  }
  if (pd < 12) trauma = Math.min(1, trauma + 0.5);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(g.pos.x - bot.pos.x, g.pos.z - bot.pos.z);
    if (d > 7) continue;
    const dmg = Math.round(100 * (1 - d / 8));
    bot.hp -= dmg;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bots.kill(bot);
      if (bot.team === 'enemy') {
        rounds.onKill(true);
        hud.killFeed('Your grenade eliminated ' + bot.name);
        audio.kill();
        if (bots.aliveCount('enemy') === 0 && rounds.state.phase !== 'ended' && rounds.state.phase !== 'match') {
          rounds.endRound(true, 'All Jackals eliminated.');
        }
      } else {
        hud.killFeed('Your grenade eliminated ' + bot.name);
      }
    }
  }
}

function grenadeStep(dt) {
  for (const g of effects.grenades) {
    if (!g.active) continue;
    g.fuse -= dt;
    g.vel.y -= 12 * dt;
    const r = 0.11;
    const nx = g.pos.x + g.vel.x * dt;
    let blocked = false;
    for (const c of map.colliders) {
      if (nx > c.min.x - r && nx < c.max.x + r && g.pos.y > c.min.y - r && g.pos.y < c.max.y + r && g.pos.z > c.min.z - r && g.pos.z < c.max.z + r) { blocked = true; break; }
    }
    if (blocked) g.vel.x *= -0.45; else g.pos.x = nx;
    const nz = g.pos.z + g.vel.z * dt;
    blocked = false;
    for (const c of map.colliders) {
      if (g.pos.x > c.min.x - r && g.pos.x < c.max.x + r && g.pos.y > c.min.y - r && g.pos.y < c.max.y + r && nz > c.min.z - r && nz < c.max.z + r) { blocked = true; break; }
    }
    if (blocked) g.vel.z *= -0.45; else g.pos.z = nz;
    const ny = g.pos.y + g.vel.y * dt;
    if (ny < r) { g.pos.y = r; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    else {
      blocked = false;
      for (const c of map.colliders) {
        if (g.pos.x > c.min.x - r && g.pos.x < c.max.x + r && ny > c.min.y - r && ny < c.max.y + r && g.pos.z > c.min.z - r && g.pos.z < c.max.z + r) { blocked = true; break; }
      }
      if (blocked) { g.vel.y *= -0.45; } else g.pos.y = ny;
    }
    g.mesh.position.copy(g.pos);
    if (g.fuse <= 0) {
      g.active = false;
      g.mesh.visible = false;
      explodeGrenade(g);
    }
  }
}

function nearestSite() {
  const dA = Math.hypot(body.position.x - map.siteA.x, body.position.z - map.siteA.z);
  const dB = Math.hypot(body.position.x - map.siteB.x, body.position.z - map.siteB.z);
  if (dA < 2.6) return { site: 'A', dist: dA };
  if (dB < 2.6) return { site: 'B', dist: dB };
  return null;
}

function step(dt) {
  now += dt;
  elapsed += dt;
  trauma = Math.max(0, trauma - dt * 1.6);
  rounds.tick(dt);
  const phase = rounds.state.phase;

  if (started && body.alive && (phase === 'live' || phase === 'planted' || phase === 'buy')) {
    player.step(dt, input.state.keys);
  }

  // Weapon keys.
  if (started && body.alive) {
    for (let i = 0; i < 4; i += 1) {
      if (input.pressed('Digit' + (i + 1))) weapons.switchTo(['p9', 'vk47', 'sc12', 'ls7'][i]);
    }
    if (input.pressed('KeyR')) { if (weapons.reload()) audio.reload(); }
    if (input.pressed('KeyG')) throwGrenade();
    if (input.pressed('KeyB') && phase === 'buy') {
      rounds.state.buyOpen = true;
      hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, buyGrenade, 300);
      hud.showBuy(true);
      input.releaseLock();
    }
  }

  // Planting: hold E inside a site during the live phase.
  const site = nearestSite();
  if (started && body.alive && phase === 'live' && site && input.state.keys.has('KeyE')) {
    rounds.state.planting = true;
    rounds.state.plantProgress += dt / PLANT_SECONDS;
    if (Math.floor(rounds.state.plantProgress * 10) !== Math.floor((rounds.state.plantProgress - dt / PLANT_SECONDS) * 10)) audio.beep();
    hud.setPlant(rounds.state.plantProgress, 'PLANTING THE SPIKE — SITE ' + site.site);
    if (rounds.state.plantProgress >= 1) {
      rounds.plantAt(site.site, map['site' + site.site].x, map['site' + site.site].z);
    }
  } else {
    if (rounds.state.plantProgress > 0 && phase === 'live') {
      rounds.state.plantProgress = Math.max(0, rounds.state.plantProgress - dt * 0.5);
      hud.setPlant(rounds.state.plantProgress, 'PLANTING THE SPIKE');
    } else if (phase !== 'planted') hud.setPlant(0, '');
    rounds.state.planting = false;
  }

  // Firing.
  if (started && body.alive && input.state.firing && weapons.ready()
    && (phase === 'live' || phase === 'planted' || phase === 'buy')) {
    if (weapons.canFire()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
    else if (weapons.def().auto) audio.dry();
  }

  weapons.step(dt);
  bots.stepAll(dt, now);
  grenadeStep(dt);
  effects.step(dt);

  // Bomb blink.
  if (bombLight && bombLight.visible) {
    bombLight.intensity = (Math.sin(now * 6) > 0 ? 6 : 1.5);
  }

  // Hint line.
  if (!started) hud.setHint('');
  else if (phase === 'buy') hud.setHint('BUY PHASE — press B for the buy menu · 1-4 switch weapon');
  else if (phase === 'live' && site) hud.setHint('HOLD E — PLANT THE SPIKE AT SITE ' + site.site);
  else if (phase === 'live') hud.setHint('Plant the spike at A or B — or eliminate the Jackals');
  else if (phase === 'planted') hud.setHint('SPIKE ARMED — defend site ' + rounds.state.bombSite);
  else hud.setHint('');

  // HUD numbers.
  const def = weapons.def();
  const am = weapons.ammo[weapons.state.current];
  hud.setHealth(body.hp);
  hud.setAmmo(am.mag, am.reserve, def.name, weapons.state.grenades);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.phaseLeft, phase);
  hud.setScore(rounds.state.wins, rounds.state.losses, rounds.state.round);
  hud.setAlive((body.alive ? 1 : 0) + bots.aliveCount('ally'), bots.aliveCount('enemy'));
  hud.setCrosshair(6 + weapons.spread(player.groundSpeed()) * 320);
  input.clearPressed();
}

function frame(time) {
  requestAnimationFrame(frame);
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (!frozen) {
    const look = input.takeLook();
    if (started && body.alive) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  started = true;
  hud.hideOverlay();
  rounds.startRound();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    player.reset(map.spawns.player[0], map.spawns.player[1]);
    settle(20);
    aimAt(tmpV.set(0, 1.5, -10));
    hud.showOverlay('start');
  } else if (name === 'play') {
    rounds.state.phase = 'live';
    rounds.state.phaseLeft = ROUND_SECONDS;
    hud.banner('PLANT THE SPIKE AT A OR B — OR ELIMINATE THE JACKALS', 2600);
    player.reset(0, 9);
    const enemy = bots.bots[0];
    enemy.pos.set(0, 0, -4);
    enemy.yaw = 0;
    enemy.group.position.copy(enemy.pos);
    enemy.group.rotation.y = enemy.yaw;
    const ally = bots.bots[4];
    ally.pos.set(-4.5, 0, 7);
    ally.group.position.copy(ally.pos);
    settle(10);
    aimAt(tmpV.set(enemy.pos.x, 1.55, enemy.pos.z));
    shoot(0);
    settle(6);
    aimAt(tmpV.set(enemy.pos.x, 1.55, enemy.pos.z));
  } else if (name === 'buy') {
    player.reset(map.spawns.player[0], map.spawns.player[1]);
    settle(20);
    aimAt(tmpV.set(0, 1.5, -10));
    hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, buyGrenade, 300);
    hud.showBuy(true);
  } else if (name === 'plant') {
    rounds.state.phase = 'live';
    rounds.state.phaseLeft = ROUND_SECONDS;
    hud.banner('SITE A — HOLD E TO PLANT THE SPIKE', 2600);
    player.reset(-10.5, -6.5);
    settle(10);
    aimAt(tmpV.set(map.siteA.x, 0.9, map.siteA.z));
    rounds.state.plantProgress = 0.62;
    hud.setPlant(0.62, 'PLANTING THE SPIKE — SITE A');
  }
  hud.setHealth(body.hp);
  const def = weapons.def();
  const am = weapons.ammo[weapons.state.current];
  hud.setAmmo(am.mag, am.reserve, def.name, weapons.state.grenades);
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
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setAmmo(12, 48, 'P9 Sidearm', 0);
hud.setMoney(800);
hud.setTimer(BUY_SECONDS, 'buy');
hud.setScore(0, 0, 1);
hud.setAlive(3, 4);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
