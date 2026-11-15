// The bots: two teams of simple soldiers. Enemy "Jackals" defend the sites,
// ally "Vanguards" attack with the player. A bot perceives with a field of
// view and a line-of-sight ray that smoke cuts, walks the map's waypoint
// graph, strafes and fires in bursts, converges on a planted bomb to defuse
// it, and can be blinded by a flashbang. Where a bot goes is not decided
// here: teamplan.js writes each bot a directive (go, hold an angle, follow,
// trade) and this module executes it. Hit detection is per body part —
// invisible proxy boxes for head, torso, arms and legs ride in each soldier's
// group, and ballistics.js prices which part a ray found.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.7;
const BOT_SPEED = 3.7;
const SEE_DIST = 42;
const ENEMY_NAMES = ['Rook', 'Vex', 'Mara', 'Kite', 'Havoc'];
const ALLY_NAMES = ['Sable', 'Wren', 'Onyx', 'Pax'];
const HIT_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });

function makeSoldier(scene, team) {
  const color = team === 'enemy' ? PALETTE.enemy : PALETTE.teal;
  const group = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(team === 'enemy' ? PALETTE.sunset : PALETTE.lamp) });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.3), torsoMat);
  torso.position.y = 1.06;
  // Vest plate and backpack give the silhouette a tactical read at distance.
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.1), darkMat);
  vest.position.set(0, 1.08, -0.19);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.16), darkMat);
  pack.position.set(0, 1.1, 0.22);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.32), darkMat);
  belt.position.y = 0.66;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), darkMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), torsoMat);
  helmet.position.y = 1.65;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.05), glowMat);
  visor.position.set(0, 1.63, -0.15);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.22), darkMat);
  legL.position.set(-0.14, 0.34, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.1, 0.3), torsoMat);
  bootL.position.set(-0.14, 0.05, -0.03);
  const bootR = bootL.clone();
  bootR.position.x = 0.14;
  // Arms: a shoulder pair plus forearms reaching to the gun.
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), torsoMat);
  armL.position.set(-0.35, 1.12, -0.06);
  armL.rotation.x = -0.7;
  const armR = armL.clone();
  armR.position.x = 0.35;
  const padL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.2), torsoMat);
  padL.position.set(-0.35, 1.38, 0);
  const padR = padL.clone();
  padR.position.x = 0.35;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
  gun.position.set(0.18, 1.15, -0.34);
  const gunMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), darkMat);
  gunMag.position.set(0.18, 1.02, -0.22);
  const gunTip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.1), glowMat);
  gunTip.position.set(0.18, 1.16, -0.68);
  for (const m of [torso, vest, pack, belt, head, helmet, legL, legR, bootL, bootR, armL, armR, padL, padR, gun, gunMag]) {
    m.castShadow = true;
    group.add(m);
  }
  group.add(visor, gunTip);
  // Hit proxies: one invisible box per body part, sized to the model above.
  const hitboxes = [];
  const parts = [
    ['head', 0.36, 0.36, 0.36, 0, 1.62, 0],
    ['torso', 0.6, 0.82, 0.38, 0, 1.04, 0],
    ['arm', 0.18, 0.56, 0.2, -0.36, 1.12, -0.05],
    ['arm', 0.18, 0.56, 0.2, 0.36, 1.12, -0.05],
    ['leg', 0.24, 0.72, 0.26, -0.14, 0.36, 0],
    ['leg', 0.24, 0.72, 0.26, 0.14, 0.36, 0],
  ];
  for (const [part, w, h, d, x, y, z] of parts) {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIT_MAT);
    proxy.position.set(x, y, z);
    proxy.userData.part = part;
    group.add(proxy);
    hitboxes.push(proxy);
  }
  scene.add(group);
  return { group, hitboxes };
}

export function createBots(scene, map, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const bots = [];
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  // Perception scratch: candidate slots and the found-target record are
  // module-owned and reused, so stepping nine bots allocates nothing.
  const candPool = [];
  for (let i = 0; i < 10; i += 1) candPool.push({ kind: '', bot: null, x: 0, z: 0 });
  const found = { kind: '', bot: null, x: 0, z: 0, dist: 0 };
  let hitList = [];
  let hitDirty = true;

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.05, z + BOT_RADIUS);
    for (let i = 0; i < map.colliders.length; i += 1) {
      if (probe.intersectsBox(map.colliders[i])) return true;
    }
    return false;
  }

  function makeBot(team, index) {
    const parts = makeSoldier(scene, team);
    const bot = {
      id: `${team}-${index}`,
      team,
      name: team === 'enemy' ? ENEMY_NAMES[index] : ALLY_NAMES[index],
      group: parts.group,
      hitboxes: parts.hitboxes,
      pos: new THREE.Vector3(),
      yaw: 0,
      hp: 100,
      alive: true,
      state: 'patrol',
      node: null,
      fromNode: null,
      target: new THREE.Vector3(),
      hasTarget: false,
      lastSeen: new THREE.Vector3(),
      lastSeenAt: -100,
      visibleTarget: null,
      visSlot: { kind: '', bot: null },
      hadContact: false,
      reactAt: 0,
      burstLeft: 0,
      burstGap: 0,
      fireCooldown: 0,
      strafeDir: 1,
      strafeUntil: 0,
      holdUntil: 0,
      lookSweep: 0,
      defuseProgress: 0,
      walkPhase: Math.random() * 6,
      role: '',
      directive: null,
      seenDirective: null,
      path: [],
      finalX: 0,
      finalZ: 0,
      blindUntil: 0,
      utilUsed: false,
    };
    for (const proxy of parts.hitboxes) proxy.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 5; i += 1) makeBot('enemy', i);
  for (let i = 0; i < 4; i += 1) makeBot('ally', i);

  function reset(now) {
    for (const bot of bots) {
      bot.hp = 100;
      bot.alive = true;
      bot.state = 'patrol';
      bot.lastSeenAt = -100;
      bot.visibleTarget = null;
      bot.hadContact = false;
      bot.burstLeft = 0;
      bot.fireCooldown = 0;
      bot.defuseProgress = 0;
      bot.directive = null;
      bot.seenDirective = null;
      bot.path.length = 0;
      bot.blindUntil = 0;
      bot.utilUsed = false;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      if (bot.team === 'enemy') {
        const s = map.spawns.enemies[bots.indexOf(bot)];
        bot.pos.set(s[0], 0, s[1]);
        bot.yaw = 0;
        bot.node = bots.indexOf(bot) < 2 ? 'siteA' : 'siteB';
      } else {
        const s = map.spawns.allies[bots.indexOf(bot) - 5];
        bot.pos.set(s[0], 0, s[1]);
        bot.yaw = 0;
        bot.node = 'mid1';
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
    hitDirty = true;
  }

  function canSee(bot, tx, tz) {
    tmpDir.set(tx - bot.pos.x, 0, tz - bot.pos.z);
    const dist = tmpDir.length();
    if (dist > SEE_DIST) return false;
    tmpDir.normalize();
    // Facing check: the bot looks along -Z rotated by yaw.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const dot = fx * tmpDir.x + fz * tmpDir.z;
    if (dist > 6 && dot < 0.25) return false;
    tmpEye.set(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
    tmp.set(tx, 1.4, tz);
    if (hooks.losBlocked(tmpEye, tmp)) return false;
    tmpDir.copy(tmp).sub(tmpEye);
    const len = tmpDir.length();
    raycaster.set(tmpEye, tmpDir.normalize());
    const hits = raycaster.intersectObjects(map.shootables, false);
    return !(hits.length > 0 && hits[0].distance < len - 0.4);
  }

  // Fills the shared `found` record; returns false when nothing is visible.
  function findTarget(bot) {
    let n = 0;
    if (bot.team === 'enemy') {
      const p = hooks.playerState();
      if (p.alive) {
        const c = candPool[n]; n += 1;
        c.kind = 'player'; c.bot = null; c.x = p.position.x; c.z = p.position.z;
      }
      for (const o of bots) {
        if (o.team !== 'ally' || !o.alive) continue;
        const c = candPool[n]; n += 1;
        c.kind = 'bot'; c.bot = o; c.x = o.pos.x; c.z = o.pos.z;
      }
    } else {
      for (const o of bots) {
        if (o.team !== 'enemy' || !o.alive) continue;
        const c = candPool[n]; n += 1;
        c.kind = 'bot'; c.bot = o; c.x = o.pos.x; c.z = o.pos.z;
      }
    }
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < n; i += 1) {
      const c = candPool[i];
      const d = Math.hypot(c.x - bot.pos.x, c.z - bot.pos.z);
      if (d < bestDist && canSee(bot, c.x, c.z)) { best = c; bestDist = d; }
    }
    if (!best) return false;
    found.kind = best.kind;
    found.bot = best.bot;
    found.x = best.x;
    found.z = best.z;
    found.dist = bestDist;
    return true;
  }

  function nearestNodeId(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const id in map.nodes) {
      const p = map.nodes[id];
      const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  // Breadth-first over the waypoint graph; runs only when a directive lands.
  function pathTo(bot, tx, tz) {
    bot.path.length = 0;
    bot.finalX = tx;
    bot.finalZ = tz;
    const start = nearestNodeId(bot.pos.x, bot.pos.z);
    const goal = nearestNodeId(tx, tz);
    if (start === goal) return;
    const prev = { [start]: null };
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const nb of map.edges[cur] || []) {
        if (!(nb in prev)) { prev[nb] = cur; queue.push(nb); }
      }
    }
    if (!(goal in prev)) return;
    const chain = [];
    let cur = goal;
    while (cur && cur !== start) { chain.push(cur); cur = prev[cur]; }
    chain.reverse();
    for (const id of chain) bot.path.push(id);
    bot.node = goal;
  }

  function moveToward(bot, dt, tx, tz, speed) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    const nx = bot.pos.x + vx * dt;
    if (!overlaps(nx, bot.pos.z)) bot.pos.x = nx;
    const nz = bot.pos.z + vz * dt;
    if (!overlaps(bot.pos.x, nz)) bot.pos.z = nz;
    bot.yaw = Math.atan2(-vx, -vz);
    bot.walkPhase += dt * speed * 2;
    return len < 0.7;
  }

  function followPath(bot, dt, speed) {
    if (bot.path.length) {
      const p = map.nodes[bot.path[0]];
      if (moveToward(bot, dt, p[0], p[1], speed)) bot.path.shift();
      return false;
    }
    return moveToward(bot, dt, bot.finalX, bot.finalZ, speed);
  }

  function faceToward(bot, tx, tz, dt) {
    const want = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
  }

  function pickNextNode(bot) {
    const neighbours = map.edges[bot.node] || [];
    const options = neighbours.filter((n) => n !== bot.fromNode);
    const pool = options.length ? options : neighbours;
    if (!pool.length) return;
    const next = pool[Math.floor(hooks.rng() * pool.length)];
    bot.fromNode = bot.node;
    bot.node = next;
    const p = map.nodes[next];
    bot.target.set(p[0], 0, p[1]);
    bot.hasTarget = true;
  }

  function fireBurst(bot, dist, now) {
    if (bot.fireCooldown > now) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(hooks.rng() * 3);
      bot.fireCooldown = now + 0.9 + hooks.rng() * 0.6;
      return;
    }
    if (bot.burstGap > now) return;
    bot.burstGap = now + 0.13;
    bot.burstLeft -= 1;
    // Hit chance falls with distance and with the target's speed; crouching helps the target.
    const p = hooks.playerState();
    let targetSpeed = 0;
    let crouching = false;
    if (found.kind === 'player') {
      targetSpeed = hooks.playerSpeed();
      crouching = p.crouching;
    } else {
      targetSpeed = BOT_SPEED * 0.7;
    }
    let chance = 0.62 - dist * 0.008 - targetSpeed * 0.03 - (crouching ? 0.08 : 0);
    chance = Math.max(0.08, Math.min(0.8, chance));
    const hit = hooks.rng() < chance;
    const muzzle = tmpEye.set(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    if (hit) {
      const dmg = Math.round(11 + hooks.rng() * 8) * (dist > 25 ? 0.75 : 1);
      if (found.kind === 'player') hooks.damagePlayer(dmg, bot);
      else hooks.damageBot(found.bot, dmg, bot);
      hooks.tracer(muzzle, found.kind === 'player' ? tmp.copy(p.position).setY(1.3) : tmp.copy(found.bot.pos).setY(1.2));
    } else {
      const miss = tmp.set(found.x, 0, found.z);
      miss.x += (hooks.rng() - 0.5) * 2.4;
      miss.y = 1.2 + hooks.rng() * 0.8;
      miss.z += (hooks.rng() - 0.5) * 2.4;
      hooks.tracer(muzzle, miss);
    }
    hooks.botShot(bot);
  }

  function maybeUtility(bot) {
    const dir = bot.directive;
    if (!dir || !dir.utility || bot.utilUsed) return;
    const d = Math.hypot(bot.pos.x - dir.utilityX, bot.pos.z - dir.utilityZ);
    if (d < 10.5) {
      bot.utilUsed = true;
      hooks.throwUtility(bot, dir.utility, dir.utilityX, dir.utilityZ);
      hooks.callout(bot, dir.utility === 'flash' ? 'Flashing ' + dir.site + '!' : 'Smoking the cross!');
    }
  }

  function stepDirective(bot, dt, now) {
    const dir = bot.directive;
    if (!dir) return false;
    if (dir !== bot.seenDirective) {
      bot.seenDirective = dir;
      if (dir.kind === 'goto' || dir.kind === 'hold' || dir.kind === 'trade') pathTo(bot, dir.x, dir.z);
    }
    if (dir.kind === 'trade' && dir.until && now > dir.until) {
      bot.directive = null;
      return false;
    }
    if (dir.kind === 'follow') {
      const lead = dir.follow;
      if (!lead || !lead.alive) { bot.directive = null; return false; }
      const d = Math.hypot(lead.pos.x - bot.pos.x, lead.pos.z - bot.pos.z);
      if (d > 4.4) moveToward(bot, dt, lead.pos.x, lead.pos.z, BOT_SPEED * 1.05);
      else if (d > 2.4) moveToward(bot, dt, lead.pos.x, lead.pos.z, BOT_SPEED * 0.6);
      else faceToward(bot, lead.pos.x - Math.sin(lead.yaw) * 6, lead.pos.z - Math.cos(lead.yaw) * 6, dt);
      maybeUtility(bot);
      return true;
    }
    if (dir.kind === 'hold') {
      const d = Math.hypot(dir.x - bot.pos.x, dir.z - bot.pos.z);
      if (d > 0.9) followPath(bot, dt, BOT_SPEED * dir.speed);
      else {
        faceToward(bot, dir.faceX, dir.faceZ, dt);
        bot.yaw += Math.sin(now * 0.8 + bot.walkPhase) * dt * 0.22;
      }
      return true;
    }
    // goto / trade: travel the graph, then settle.
    maybeUtility(bot);
    if (followPath(bot, dt, BOT_SPEED * dir.speed)) {
      bot.directive = null;
      bot.state = 'hold';
      bot.holdUntil = now + 6 + hooks.rng() * 4;
      bot.node = nearestNodeId(bot.pos.x, bot.pos.z);
    }
    return true;
  }

  function step(bot, dt, now) {
    if (!bot.alive) return;

    // A blinded bot sees nothing, fires nothing, and turns from the light.
    if (now < bot.blindUntil) {
      bot.visibleTarget = null;
      bot.yaw += dt * 2.1;
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    const seen = findTarget(bot);
    if (seen) {
      bot.visSlot.kind = found.kind;
      bot.visSlot.bot = found.bot;
      bot.visibleTarget = bot.visSlot;
      bot.lastSeen.set(found.x, 0, found.z);
      bot.lastSeenAt = now;
      if (bot.reactAt === 0) bot.reactAt = now + 0.35 + hooks.rng() * 0.35;
      if (!bot.hadContact) {
        bot.hadContact = true;
        hooks.contact(bot, found.x, found.z);
      }
    } else {
      bot.visibleTarget = null;
      bot.reactAt = 0;
      bot.hadContact = false;
    }

    const bomb = hooks.bombState();
    // Defuse duty: when the bomb is planted, the nearest living enemy walks to it.
    if (bomb.planted && bot.team === 'enemy') {
      const defuser = hooks.defuser();
      if (defuser === bot) {
        const d = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
        if (d < 2.2) {
          faceToward(bot, bomb.x, bomb.z, dt);
          bot.defuseProgress += dt;
          hooks.defuseTick(bot.defuseProgress);
          if (bot.defuseProgress >= 4) hooks.bombDefused(bot);
          bot.group.position.copy(bot.pos);
          bot.group.rotation.y = bot.yaw;
          return;
        }
        moveToward(bot, dt, bomb.x, bomb.z, BOT_SPEED * 1.05);
        bot.group.position.copy(bot.pos);
        bot.group.rotation.y = bot.yaw;
        return;
      }
    }

    if (seen && now >= bot.reactAt) {
      // Engage: strafe sideways, keep 8-20 m, fire in bursts.
      faceToward(bot, found.x, found.z, dt);
      if (now > bot.strafeUntil) {
        bot.strafeDir = hooks.rng() < 0.5 ? -1 : 1;
        bot.strafeUntil = now + 0.9 + hooks.rng() * 1.2;
      }
      const dx = found.x - bot.pos.x;
      const dz = found.z - bot.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const px = -dz / dist;
      const pz = dx / dist;
      let mx = px * bot.strafeDir;
      let mz = pz * bot.strafeDir;
      if (dist < 7) { mx -= dx / dist; mz -= dz / dist; }
      else if (dist > 22) { mx += dx / dist; mz += dz / dist; }
      const ml = Math.hypot(mx, mz) || 1;
      const nx = bot.pos.x + (mx / ml) * BOT_SPEED * 0.8 * dt;
      if (!overlaps(nx, bot.pos.z)) bot.pos.x = nx;
      const nz = bot.pos.z + (mz / ml) * BOT_SPEED * 0.8 * dt;
      if (!overlaps(bot.pos.x, nz)) bot.pos.z = nz;
      fireBurst(bot, dist, now);
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    const holding = bot.directive && bot.directive.kind === 'hold';
    if (!holding && now - bot.lastSeenAt < 6) {
      // Chase the last place the target was seen or heard.
      if (moveToward(bot, dt, bot.lastSeen.x, bot.lastSeen.z, BOT_SPEED)) {
        bot.lastSeenAt = -100;
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (stepDirective(bot, dt, now)) {
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'hold') {
      // Fallback hold: sweep the view, drift back to a site when the timer ends.
      bot.lookSweep += dt;
      bot.yaw += Math.sin(bot.lookSweep * 0.7) * dt * 0.6;
      if (now > bot.holdUntil) {
        const site = bot.pos.x < 0 ? 'siteA' : 'siteB';
        bot.node = site;
        const p = map.nodes[site];
        bot.target.set(p[0], 0, p[1]);
        bot.hasTarget = true;
        bot.state = 'patrol';
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Patrol the waypoint graph.
    if (!bot.hasTarget) pickNextNode(bot);
    if (bot.hasTarget && moveToward(bot, dt, bot.target.x, bot.target.z, BOT_SPEED * 0.9)) {
      bot.hasTarget = false;
      if (bot.team === 'enemy' && (bot.node === 'siteA' || bot.node === 'siteB')) {
        bot.state = 'hold';
        bot.holdUntil = now + 5 + hooks.rng() * 7;
      }
    }
    bot.group.position.copy(bot.pos);
    bot.group.rotation.y = bot.yaw;
  }

  // The hearing bus lands here: an opposing team's loud sound inside its
  // radius becomes a noisy last-seen and a reason to move — unless the bot
  // holds an angle for the plan, in which case it simply knows.
  function hearEvent(e) {
    if (e.type !== 'shot' && e.type !== 'reload' && e.type !== 'plant' && e.type !== 'explosion') return;
    for (const bot of bots) {
      if (!bot.alive || bot.team === e.team) continue;
      const d = Math.hypot(e.x - bot.pos.x, e.z - bot.pos.z);
      if (d >= e.radius) continue;
      const noise = e.type === 'shot' || e.type === 'explosion' ? 3 : 1.2;
      bot.lastSeen.set(e.x + (hooks.rng() - 0.5) * noise * 2, 0, e.z + (hooks.rng() - 0.5) * noise * 2);
      bot.lastSeenAt = e.now;
      if (!bot.directive) bot.state = 'patrol';
    }
  }

  // A flashbang pops: bots facing it inside its reach lose their eyes for a
  // while — full-face longest, a glance shortest, a wall in between nothing.
  function applyFlash(x, z, now) {
    let blinded = 0;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = x - bot.pos.x;
      const dz = z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 26) continue;
      tmpEye.set(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
      tmp.set(x, 1.3, z);
      tmpDir.copy(tmp).sub(tmpEye);
      const len = tmpDir.length();
      raycaster.set(tmpEye, tmpDir.normalize());
      const hits = raycaster.intersectObjects(map.shootables, false);
      if (hits.length > 0 && hits[0].distance < len - 0.4) continue;
      const fx = -Math.sin(bot.yaw);
      const fz = -Math.cos(bot.yaw);
      const dot = (fx * dx + fz * dz) / (dist || 1);
      const facing = dot > 0.2 ? 1 : dot > -0.7 ? 0.45 : 0.16;
      const dur = 3.2 * facing * (1 - dist / 32);
      if (dur > 0.25) {
        bot.blindUntil = Math.max(bot.blindUntil, now + dur);
        blinded += 1;
      }
    }
    return blinded;
  }

  function kill(bot) {
    bot.alive = false;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
    hitDirty = true;
  }

  return {
    bots,
    reset,
    hearEvent,
    applyFlash,
    kill,
    stepAll(dt, now) {
      for (const bot of bots) {
        step(bot, dt, now);
        // A small walk bob sells the movement; dead bots keep their fall height.
        if (bot.alive) bot.group.position.y = Math.abs(Math.sin(bot.walkPhase * 2)) * 0.035;
      }
    },
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    hitMeshes() {
      if (hitDirty) {
        hitList = [];
        for (const bot of bots) {
          if (!bot.alive) continue;
          for (const proxy of bot.hitboxes) hitList.push(proxy);
        }
        hitDirty = false;
      }
      return hitList;
    },
  };
}
