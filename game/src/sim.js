// The simulation: a fixed 60 Hz step that owns everything which changes the
// game — player movement, shooting, grenades, the plant flow, bot turns,
// team-plan ticks — while main.js owns the renderer and asks for steps.
// Rendering reads the state the step leaves behind; the step never touches
// the canvas. Damage, blindness, smoke and sound all resolve here, so the
// player's tools and the bots' tools run through the same code.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRounds, BUY_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS } from './rounds.js';
import { UTILITY, UTILITY_ORDER } from './grenades.js';
import { damageVs, penMult } from './ballistics.js';
import { WEAPONS } from './weapons.js';

export const FIXED_STEP = 1 / 60;

export function createSim(deps) {
  const { scene, camera, state, map, player, input, weapons, bots, hud, audio, fx, grenades, hearing, teamplan, rng, staging } = deps;
  const body = player.state;
  let accumulator = 0;
  let bombMesh = null;
  let bombLight = null;

  const raycaster = new THREE.Raycaster();
  raycaster.far = 100;
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();

  const rounds = createRounds({
    onRoundStart(round) {
      resetPositions();
      weapons.refillAmmo();
      hideBomb();
      hud.setScore(rounds.state.wins, rounds.state.losses, round);
      hud.setGear(rounds.state.gear.vest, rounds.state.gear.helmet);
      hud.banner('ROUND ' + round + ' — BUY PHASE', 2000);
      if (!staging) buildBuyMenu();
    },
    onLiveStart() {
      hud.banner('PLANT THE SPIKE AT A OR B — OR ELIMINATE THE JACKALS', 2600);
      hud.showBuy(false);
      teamplan.liveStart();
    },
    onRoundEnd(won, reason, wins, losses) {
      hud.setScore(wins, losses, rounds.state.round);
      teamplan.onRoundResult(won);
      const planLabel = { EXECUTE_A: 'Execute A', EXECUTE_B: 'Execute B', DEFAULT: 'The default' }[teamplan.planName()];
      hud.banner((won ? 'ROUND WON — ' : 'ROUND LOST — ') + (won ? planLabel + ' succeeds · ' : planLabel + ' is stopped · ') + reason, 3400);
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
      teamplan.onPlant(site);
    },
    onBombExploded() {
      fx.explosion(tmpV.set(rounds.state.bombPos.x, 1, rounds.state.bombPos.z));
      audio.explosion();
      state.trauma = 1;
      hideBomb();
    },
  });

  function resetPositions() {
    player.reset(map.spawns.player[0], map.spawns.player[1]);
    bots.reset(state.now);
    fx.hideAll();
    grenades.hideAll();
    state.trauma = 0;
    teamplan.startRound(rounds.state.round);
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

  function buildBuyMenu() {
    hud.buildBuyMenu(rounds.buyList(), weapons.state.owned, rounds.state.money, buyWeapon, grenades.counts, buyUtility, UTILITY,
      rounds.state.gear, rounds.gearList(), buyGear);
  }

  function buyGear(id) {
    if (rounds.state.phase !== 'buy') return;
    if (!rounds.buyGear(id)) return;
    audio.buy();
    buildBuyMenu();
    hud.setMoney(rounds.state.money);
    hud.setGear(rounds.state.gear.vest, rounds.state.gear.helmet);
  }

  function buyWeapon(id) {
    if (rounds.state.phase !== 'buy') return;
    if (!rounds.buyWeapon(id)) return;
    weapons.buy(id);
    audio.buy();
    buildBuyMenu();
    hud.setMoney(rounds.state.money);
  }

  function buyUtility(type) {
    if (rounds.state.phase !== 'buy') return;
    if (!rounds.buyUtility(type)) return;
    grenades.buy(type);
    audio.buy();
    buildBuyMenu();
    hud.setMoney(rounds.state.money);
  }

  // One death, every cause: money, feed, the plan's trade, the round check.
  // The feed line names the weapon and the manner — HEADSHOT, WALLBANG —
  // because the feed is how a round tells its story at a glance.
  function killBot(bot, killerName, killerPos, byPlayer, note, weapon) {
    bots.kill(bot);
    if (byPlayer && bot.team === 'enemy') {
      rounds.onKill(true);
      hud.killFeed('You', bot.name, weapon, note);
      audio.kill();
    } else {
      hud.killFeed(killerName, bot.name, weapon, note);
    }
    teamplan.onDeath(bot, killerPos.x, killerPos.z);
    if (bot.team === 'enemy' && bots.aliveCount('enemy') === 0
      && rounds.state.phase !== 'ended' && rounds.state.phase !== 'match') {
      rounds.endRound(true, 'All Jackals eliminated.');
    }
  }

  function damagePlayer(dmg, bot, head) {
    if (!body.alive) return;
    if (rounds.state.phase !== 'live' && rounds.state.phase !== 'planted') return;
    // Armour prices a bot's hit as it prices the player's rounds: a helmet
    // blunts the high shot, a vest eats body shots. Death drops the kit.
    let taken = dmg;
    if (head) taken *= rounds.state.gear.helmet ? 1.15 : 1.75;
    else if (rounds.state.gear.vest) taken *= 0.55;
    body.hp -= taken;
    hud.damageFlash();
    audio.hurt();
    state.trauma = Math.min(1, state.trauma + 0.25);
    if (body.hp <= 0) {
      body.hp = 0;
      body.alive = false;
      rounds.state.deaths += 1;
      rounds.state.gear.vest = false;
      rounds.state.gear.helmet = false;
      hud.setGear(false, false);
      hud.killFeed(bot.name, 'you', WEAPONS[bot.weaponId].name, head ? 'HEADSHOT' : '');
      rounds.endRound(false, 'You were eliminated.');
    }
  }

  function damageBot(target, dmg, fromBot) {
    if (!target.alive) return;
    target.hp -= target.gear.vest ? dmg * 0.55 : dmg;
    if (target.hp <= 0) {
      target.hp = 0;
      killBot(target, fromBot.name, fromBot.pos, false, '', WEAPONS[fromBot.weaponId].name);
    }
  }

  function shoot(spreadOverride) {
    if (!weapons.ready()) return false;
    if (!weapons.canFire()) {
      audio.dry();
      return false;
    }
    weapons.takeRound();
    const def = weapons.def();
    camera.getWorldDirection(dir);
    weapons.muzzleWorld(muzzle);
    tmpB.setFromMatrixColumn(camera.matrix, 0);
    fx.shell(muzzle, tmpB);
    const spread = spreadOverride !== undefined ? spreadOverride
      : weapons.spread(player.groundSpeed(), !body.onGround, body.crouching);
    let hitSomething = false;
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      tmpV.copy(dir);
      tmpV.x += (rng() * 2 - 1) * spread;
      tmpV.y += (rng() * 2 - 1) * spread;
      tmpV.z += (rng() * 2 - 1) * spread;
      tmpV.normalize();
      scene.updateMatrixWorld(true);
      raycaster.set(camera.position, tmpV);
      // Full hit lists: penetration needs the second surface and the bot
      // standing behind the first, not just the nearest of each.
      const wallHits = raycaster.intersectObjects(map.shootables, false);
      const botHits = raycaster.intersectObjects(bots.hitMeshes(), false);
      const w1 = wallHits[0];
      const b1 = botHits[0];
      let hit = null;
      let mult = 1;
      let wallbang = false;
      let entry = null;
      if (b1 && (!w1 || b1.distance < w1.distance)) hit = b1;
      else if (w1) {
        const m = penMult(w1.object.userData.pen);
        if (m > 0) {
          // Thin cover: the round pays the material its fraction and flies
          // on to whatever stands behind it — a bot, a second wall, or air.
          entry = w1;
          const b2 = botHits.find((h) => h.distance > w1.distance + 0.05);
          const w2 = wallHits.find((h) => h.distance > w1.distance + 0.05);
          if (b2 && (!w2 || b2.distance < w2.distance)) { hit = b2; mult = m; wallbang = true; }
          else if (w2) hit = w2;
        } else hit = w1;
      }
      if (!hit) {
        hitPoint.copy(camera.position).addScaledVector(tmpV, def.range);
        if (entry) { fx.tracer(muzzle, entry.point); fx.spark(entry.point, 2); fx.tracer(entry.point, hitPoint); }
        else fx.tracer(muzzle, hitPoint);
        continue;
      }
      hitPoint.copy(hit.point);
      if (entry) { fx.tracer(muzzle, entry.point); fx.spark(entry.point, 2); fx.tracer(entry.point, hitPoint); }
      else fx.tracer(muzzle, hitPoint);
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const part = hit.object.userData.part;
        const dmg = damageVs(def, part, hit.distance, bot.gear) * mult;
        bot.hp -= dmg;
        hitSomething = true;
        hud.hitMarker(bot.hp <= 0, bot.hp <= 0 ? 4000 : 90);
        if (bot.hp <= 0) {
          bot.hp = 0;
          const note = part === 'head' ? (wallbang ? 'HEADSHOT · WALLBANG' : 'HEADSHOT')
            : (wallbang ? 'WALLBANG' : '');
          killBot(bot, 'You', body.position, true, note, def.name);
        } else {
          audio.hit();
          bot.lastSeen.copy(body.position);
          bot.lastSeenAt = state.now;
        }
        fx.spark(hitPoint, 2);
      } else {
        fx.spark(hitPoint, 3);
      }
    }
    hearing.publish('shot', body.position.x, body.position.z, 'ally', 26, state.now);
    audio.shot(def.id);
    const kick = weapons.state.kickPattern;
    player.recoil(kick.pitch, kick.yaw);
    state.trauma = Math.min(1, state.trauma + def.kick * 6);
    return hitSomething;
  }

  function throwUtilityPlayer(type) {
    if (grenades.counts[type] <= 0) return;
    grenades.counts[type] -= 1;
    camera.getWorldDirection(dir);
    grenades.throwFrom(camera.position, dir, type, 'ally', 'player');
    audio.tick();
  }

  // Grenade resolutions, called by grenades.js when a fuse ends.
  function fragAt(pos, thrower) {
    fx.explosion(pos);
    audio.explosion();
    const byPlayer = thrower === 'player';
    const killerName = byPlayer ? 'Your grenade' : thrower.name;
    const killerPos = byPlayer ? body.position : thrower.pos;
    hearing.publish('explosion', pos.x, pos.z, byPlayer ? 'ally' : thrower.team, 42, state.now);
    const pd = Math.hypot(pos.x - body.position.x, pos.z - body.position.z);
    if (pd < 6 && body.alive) {
      body.hp -= Math.round(45 * (1 - pd / 7));
      hud.damageFlash();
      if (body.hp <= 0) {
        body.hp = 0;
        body.alive = false;
        rounds.state.deaths += 1;
        rounds.endRound(false, byPlayer ? 'Caught by your own grenade.' : 'Blown up by a Jackal grenade.');
      }
    }
    if (pd < 12) state.trauma = Math.min(1, state.trauma + 0.5);
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(pos.x - bot.pos.x, pos.z - bot.pos.z);
      if (d > 7) continue;
      bot.hp -= Math.round(100 * (1 - d / 8));
      if (bot.hp <= 0) {
        bot.hp = 0;
        killBot(bot, killerName, killerPos, byPlayer, '', UTILITY.frag.name);
      }
    }
  }

  function flashAt(pos) {
    fx.flashPop(pos);
    audio.flash();
    bots.applyFlash(pos.x, pos.z, state.now);
    // The player: brightness falls with distance, and facing decides the rest.
    const dist = camera.position.distanceTo(pos);
    if (dist < 26) {
      tmpV.copy(pos).sub(camera.position).normalize();
      raycaster.set(camera.position, tmpV);
      const wall = raycaster.intersectObjects(map.shootables, false)[0];
      if (!wall || wall.distance > dist - 0.4) {
        camera.getWorldDirection(dir);
        const dot = dir.dot(tmpV);
        const facing = dot > 0.5 ? 1 : dot > -0.5 ? 0.55 : 0.25;
        const factor = Math.max(0, Math.min(1, 1.25 - dist / 20)) * facing;
        if (factor > 0.15) {
          hud.flashScreen(factor);
          state.playerBlindUntil = state.now + factor * 3.2;
        }
      }
    }
  }

  function smokeAt(pos) {
    fx.smoke(pos.x, pos.z);
    audio.puff();
  }

  // A decoy sings: the fake shot goes on the hearing bus at full rifle
  // radius, a spark sells the muzzle flash, and a nearby player hears the
  // crack — while the other team rotates toward a fight that is not there.
  function decoyShot(pos, team) {
    hearing.publish('shot', pos.x, pos.z, team, 26, state.now);
    fx.spark(pos, 1);
    if (Math.hypot(pos.x - body.position.x, pos.z - body.position.z) < 30) audio.distantShot();
  }

  // Does the segment a→b pass through a live smoke cloud?
  function losBlocked(a, b) {
    for (const s of fx.smokes) {
      if (s.life <= 0) continue;
      const age = 1 - s.life / s.maxLife;
      const r = s.r * (0.25 + 0.75 * Math.min(1, age * 6)) * 0.95;
      tmpV.set(s.x, 1.2, s.z);
      tmpB.copy(b).sub(a);
      const len2 = tmpB.lengthSq() || 1;
      tmpC.copy(tmpV).sub(a);
      const t = Math.max(0, Math.min(1, tmpC.dot(tmpB) / len2));
      tmpB.multiplyScalar(t).add(a);
      if (tmpB.distanceTo(tmpV) < r) return true;
    }
    return false;
  }

  function nearestSite() {
    const dA = Math.hypot(body.position.x - map.siteA.x, body.position.z - map.siteA.z);
    const dB = Math.hypot(body.position.x - map.siteB.x, body.position.z - map.siteB.z);
    if (dA < 2.6) return { site: 'A', dist: dA };
    if (dB < 2.6) return { site: 'B', dist: dB };
    return null;
  }

  function step(dt) {
    state.now += dt;
    state.elapsed += dt;
    state.trauma = Math.max(0, state.trauma - dt * 1.6);
    rounds.tick(dt);
    const phase = rounds.state.phase;

    if (state.started && body.alive && (phase === 'live' || phase === 'planted' || phase === 'buy')) {
      player.step(dt, input.state.keys);
    }

    weapons.setAds(!!input.state.aiming && state.started && body.alive);

    if (state.started && body.alive) {
      for (let i = 0; i < 4; i += 1) {
        if (input.pressed('Digit' + (i + 1))) weapons.switchTo(['p9', 'vk47', 'sc12', 'ls7'][i]);
      }
      if (input.pressed('KeyR') && weapons.reload()) {
        audio.reload();
        hearing.publish('reload', body.position.x, body.position.z, 'ally', 12, state.now);
      }
      if (phase === 'live' || phase === 'planted') {
        if (input.pressed('KeyG')) throwUtilityPlayer('frag');
        if (input.pressed('KeyF')) throwUtilityPlayer('flash');
        if (input.pressed('KeyT')) throwUtilityPlayer('smoke');
        if (input.pressed('KeyV')) throwUtilityPlayer('decoy');
      }
      if (input.pressed('KeyB') && phase === 'buy') {
        rounds.state.buyOpen = true;
        buildBuyMenu();
        hud.showBuy(true);
        input.releaseLock();
      }
    }

    // Planting: hold E inside a site during the live phase. The beeps carry
    // on the hearing bus — a defender in earshot knows, and converges.
    const site = nearestSite();
    if (state.started && body.alive && phase === 'live' && site && input.state.keys.has('KeyE')) {
      rounds.state.planting = true;
      rounds.state.plantProgress += dt / PLANT_SECONDS;
      if (Math.floor(rounds.state.plantProgress * 10) !== Math.floor((rounds.state.plantProgress - dt / PLANT_SECONDS) * 10)) audio.beep();
      if (state.now - state.plantNoiseAt > 1) {
        state.plantNoiseAt = state.now;
        hearing.publish('plant', body.position.x, body.position.z, 'ally', 20, state.now);
        teamplan.onPlantHeard(body.position.x, body.position.z);
      }
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
    if (state.started && body.alive && input.state.firing && weapons.ready()
      && (phase === 'live' || phase === 'planted' || phase === 'buy')) {
      if (weapons.canFire()) shoot();
      else if (weapons.def().auto) audio.dry();
    }

    weapons.step(dt);
    bots.stepAll(dt, state.now);
    grenades.step(dt);
    fx.step(dt);
    map.tick(state.now);

    // Bomb blink.
    if (bombLight && bombLight.visible) {
      bombLight.intensity = (Math.sin(state.now * 6) > 0 ? 6 : 1.5);
    }

    // Hint line.
    if (!state.started) hud.setHint('');
    else if (phase === 'buy') hud.setHint('BUY PHASE — press B for the buy menu · 1-4 switch weapon');
    else if (phase === 'live' && site) hud.setHint('HOLD E — PLANT THE SPIKE AT SITE ' + site.site);
    else if (phase === 'live') hud.setHint('Plant the spike at A or B — or eliminate the Jackals');
    else if (phase === 'planted') hud.setHint('SPIKE ARMED — defend site ' + rounds.state.bombSite);
    else hud.setHint('');

    // HUD numbers.
    const def = weapons.def();
    const am = weapons.ammo[weapons.state.current];
    hud.setHealth(body.hp);
    hud.setAmmo(am.mag, am.reserve, def.name, grenades.counts);
    hud.setMoney(rounds.state.money);
    hud.setTimer(rounds.state.phaseLeft, phase);
    hud.setScore(rounds.state.wins, rounds.state.losses, rounds.state.round);
    hud.setAlive((body.alive ? 1 : 0) + bots.aliveCount('ally'), bots.aliveCount('enemy'));
    hud.setCrosshair(6 + weapons.spread(player.groundSpeed(), !body.onGround, body.crouching) * 320);
    input.clearPressed();
  }

  // One rendered frame's worth of simulation: apply the look, then run as
  // many fixed steps as the elapsed time buys, never more than five.
  function frame(dt, look) {
    if (state.started && body.alive) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }

  return {
    rounds,
    frame,
    stepOnce() { step(FIXED_STEP); },
    shootNow(spread) { return shoot(spread); },
    showBomb,
    hideBomb,
    buildBuyMenu,
    buyWeapon,
    buyUtility,
    buyGear,
    resetPositions,
    fragAt,
    flashAt,
    smokeAt,
    decoyShot,
    losBlocked,
    damagePlayer,
    damageBot,
    throwUtilityPlayer,
    utilityOrder: UTILITY_ORDER,
    defuseSeconds: DEFUSE_SECONDS,
    buySeconds: BUY_SECONDS,
  };
}
