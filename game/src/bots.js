// The bots: two teams of simple soldiers. Enemy "Jackals" defend the two sites until
// they see or hear the player; ally "Vanguards" push with the player. A bot perceives
// with a field of view and a line-of-sight ray, walks the map's waypoint graph, holds
// positions, chases the last place it saw or heard a shot, strafes while it fires in
// bursts, and converges on a planted bomb to defuse it. No allocation in step().
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.7;
const BOT_SPEED = 3.7;
const SEE_DIST = 42;
const HEAR_DIST = 26;
const ENEMY_NAMES = ['Rook', 'Vex', 'Mara', 'Kite', 'Havoc'];
const ALLY_NAMES = ['Sable', 'Wren', 'Onyx', 'Pax'];

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
  scene.add(group);
  return { group, torso, head, gun };
}

export function createBots(scene, map, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const bots = [];
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();

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
      torso: parts.torso,
      head: parts.head,
      gun: parts.gun,
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
      reactAt: 0,
      burstLeft: 0,
      burstGap: 0,
      fireCooldown: 0,
      strafeDir: 1,
      strafeUntil: 0,
      holdUntil: 0,
      lookSweep: 0,
      defuseProgress: 0,
      assignedSite: null,
      walkPhase: Math.random() * 6,
    };
    parts.torso.userData.bot = bot;
    parts.torso.userData.part = 'body';
    parts.head.userData.bot = bot;
    parts.head.userData.part = 'head';
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
      bot.burstLeft = 0;
      bot.fireCooldown = 0;
      bot.defuseProgress = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      if (bot.team === 'enemy') {
        const s = map.spawns.enemies[bots.indexOf(bot)];
        bot.pos.set(s[0], 0, s[1]);
        bot.yaw = 0;
        bot.assignedSite = bots.indexOf(bot) < 2 ? 'A' : 'B';
        bot.node = bots.indexOf(bot) < 2 ? 'siteA' : 'siteB';
        bot.state = 'hold';
        bot.holdUntil = now + 6 + hooks.rng() * 6;
      } else {
        const s = map.spawns.allies[bots.indexOf(bot) - 5];
        bot.pos.set(s[0], 0, s[1]);
        bot.yaw = 0;
        bot.node = 'mid1';
        bot.state = 'patrol';
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
  }

  function canSee(bot, targetPos) {
    tmpDir.copy(targetPos).sub(bot.pos);
    tmpDir.y = 0;
    const dist = tmpDir.length();
    if (dist > SEE_DIST) return false;
    tmpDir.normalize();
    // Facing check: bot looks along -Z rotated by yaw; use dot with forward vector.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const dot = fx * tmpDir.x + fz * tmpDir.z;
    if (dist > 6 && dot < 0.25) return false;
    tmpEye.set(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
    tmp.copy(targetPos);
    tmp.y = 1.4;
    tmpDir.copy(tmp).sub(tmpEye);
    const len = tmpDir.length();
    raycaster.set(tmpEye, tmpDir.normalize());
    const hits = raycaster.intersectObjects(map.shootables, false);
    return !(hits.length > 0 && hits[0].distance < len - 0.4);
  }

  function nearestVisibleEnemy(bot, now) {
    let best = null;
    let bestDist = Infinity;
    const candidates = [];
    if (bot.team === 'enemy') {
      const p = hooks.playerState();
      if (p.alive) candidates.push({ kind: 'player', pos: tmp.copy(p.position).setY(1.4), dist: 0 });
      for (const other of bots) if (other.team === 'ally' && other.alive) candidates.push({ kind: 'bot', bot: other, pos: other.pos, dist: 0 });
    } else {
      for (const other of bots) if (other.team === 'enemy' && other.alive) candidates.push({ kind: 'bot', bot: other, pos: other.pos, dist: 0 });
    }
    for (const c of candidates) {
      const d = Math.hypot(c.pos.x - bot.pos.x, c.pos.z - bot.pos.z);
      if (d < bestDist && canSee(bot, c.pos)) {
        best = c;
        bestDist = d;
      }
    }
    return best ? { target: best, dist: bestDist } : null;
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

  function faceToward(bot, tx, tz, dt) {
    const want = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
  }

  function fireBurst(bot, target, dist, now) {
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
    if (target.kind === 'player') {
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
      if (target.kind === 'player') hooks.damagePlayer(dmg, bot);
      else hooks.damageBot(target.bot, dmg, bot);
      hooks.tracer(muzzle, target.kind === 'player' ? tmp.copy(p.position).setY(1.3) : tmp.copy(target.bot.pos).setY(1.2));
    } else {
      const miss = tmp.copy(target.kind === 'player' ? p.position : target.bot.pos);
      miss.x += (hooks.rng() - 0.5) * 2.4;
      miss.y = 1.2 + hooks.rng() * 0.8;
      miss.z += (hooks.rng() - 0.5) * 2.4;
      hooks.tracer(muzzle, miss);
    }
    hooks.botShot(bot);
  }

  function step(bot, dt, now) {
    if (!bot.alive) return;
    const seen = nearestVisibleEnemy(bot, now);
    if (seen) {
      bot.visibleTarget = seen.target;
      bot.lastSeen.copy(seen.target.pos);
      bot.lastSeenAt = now;
      if (bot.reactAt === 0) bot.reactAt = now + 0.35 + hooks.rng() * 0.35;
    } else {
      bot.visibleTarget = null;
      bot.reactAt = 0;
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
      const t = seen.target;
      const tx = t.kind === 'player' ? hooks.playerState().position.x : t.bot.pos.x;
      const tz = t.kind === 'player' ? hooks.playerState().position.z : t.bot.pos.z;
      faceToward(bot, tx, tz, dt);
      if (now > bot.strafeUntil) {
        bot.strafeDir = hooks.rng() < 0.5 ? -1 : 1;
        bot.strafeUntil = now + 0.9 + hooks.rng() * 1.2;
      }
      const dx = tx - bot.pos.x;
      const dz = tz - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      const px = -dz / (dist || 1);
      const pz = dx / (dist || 1);
      let mx = px * bot.strafeDir;
      let mz = pz * bot.strafeDir;
      if (dist < 7) { mx -= dx / dist; mz -= dz / dist; }
      else if (dist > 22) { mx += dx / dist; mz += dz / dist; }
      const ml = Math.hypot(mx, mz) || 1;
      const nx = bot.pos.x + (mx / ml) * BOT_SPEED * 0.8 * dt;
      if (!overlaps(nx, bot.pos.z)) bot.pos.x = nx;
      const nz = bot.pos.z + (mz / ml) * BOT_SPEED * 0.8 * dt;
      if (!overlaps(bot.pos.x, nz)) bot.pos.z = nz;
      fireBurst(bot, t, dist, now);
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (now - bot.lastSeenAt < 6) {
      // Chase the last place the target was seen or heard.
      if (moveToward(bot, dt, bot.lastSeen.x, bot.lastSeen.z, BOT_SPEED)) {
        bot.lastSeenAt = -100;
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'hold') {
      // Hold the site: sweep the view, move to the next hold node when the timer ends.
      bot.lookSweep += dt;
      bot.yaw += Math.sin(bot.lookSweep * 0.7) * dt * 0.6;
      if (now > bot.holdUntil) {
        const site = bot.assignedSite === 'A' ? 'siteA' : 'siteB';
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

  function hearShot(pos, team) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === team) continue;
      const d = Math.hypot(pos.x - bot.pos.x, pos.z - bot.pos.z);
      if (d < HEAR_DIST) {
        bot.lastSeen.set(pos.x + (hooks.rng() - 0.5) * 3, 0, pos.z + (hooks.rng() - 0.5) * 3);
        bot.lastSeenAt = hooks.now();
        bot.state = 'patrol';
      }
    }
  }

  function kill(bot) {
    bot.alive = false;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
  }

  return {
    bots,
    reset,
    hearShot,
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
      const list = [];
      for (const bot of bots) {
        if (!bot.alive) continue;
        list.push(bot.torso, bot.head);
      }
      return list;
    },
  };
}
