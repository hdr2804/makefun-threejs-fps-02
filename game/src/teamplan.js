// The team-plan layer: the part of the bots that thinks like a squad. bots.js
// owns legs and eyes; this module owns the plan. Every round it deals roles
// (entry, support, anchor, lurker, rotate), picks a plan from the round
// number — Execute A, Execute B, or a Default spread for the attack; a
// two-two-one setup for the defence — and writes each bot a directive:
// a place to go, a named angle to hold, a teammate to follow. Then it listens:
// contacts become radio callouts and rotations, a death becomes a trade, a
// plant becomes post-plant angles for one team and a paired retake for the
// other. Callouts are only ever written here, and only from real events.
//
// The same layer runs each squad's money: a bank and a loss streak per
// team, spent like a Counter-Strike side — full buy (rifles, armour,
// utility), force buy (scatterguns, vests) or eco (pistols, one decoy).
// The buy writes every bot's weapon, armour, kit and utility counts for
// the round, and the callout names it, so a pistol round plays like one.
import { UTILITY } from './grenades.js';

const ATTACK_PLANS = ['EXECUTE_A', 'EXECUTE_B', 'DEFAULT'];
const GEAR_COST = { vk47: 900, sc12: 700, vest: 500, helmet: 350, kit: 400 };
const BUY_LINES = {
  full: 'Full buy — rifles and armour.',
  force: 'Force buy — scatterguns and vests.',
  eco: 'Eco round — save for next.',
};
const ALLY_ROLES = ['entry', 'support', 'entry', 'lurker'];
const ENEMY_ROLES = ['anchor', 'anchor', 'anchor', 'anchor', 'rotate'];

// Named angles, in map coordinates: where a holder stands and what they watch.
const DEF_HOLD = {
  A: [{ x: -19.6, z: -8.8, fx: -11, fz: -12 }, { x: -12.6, z: -13.9, fx: -17, fz: -9 }],
  B: [{ x: 20.4, z: 7.8, fx: 13, fz: 11 }, { x: 12.8, z: 14.6, fx: 17, fz: 9 }],
};
const POST_PLANT = {
  A: [{ x: -19.9, z: -8.2, fx: -12.5, fz: -8 }, { x: -12.2, z: -14.4, fx: -16, fz: -9.5 },
      { x: -13.6, z: -5.6, fx: -17.5, fz: -11.5 }, { x: -20.2, z: -13.8, fx: -15, fz: -10 }],
  B: [{ x: 20.6, z: 7.4, fx: 13, fz: 8.5 }, { x: 12.4, z: 14.9, fx: 16, fz: 9.5 },
      { x: 14.0, z: 6.0, fx: 17.5, fz: 11.5 }, { x: 19.8, z: 14.2, fx: 15, fz: 10 }],
};
const CHOKE = { A: { x: -11.5, z: -7.6 }, B: { x: 11.8, z: 7.4 } };   // where an execute enters
const CROSS = { A: { x: -13.8, z: -8.2 }, B: { x: 13.2, z: 8.8 } };   // where a retake crosses
const ROTATE_TO = { A: { x: -13.5, z: -8.0, fx: -18, fz: -12 }, B: { x: 13.0, z: 8.6, fx: 18, fz: 12 } };

const ZONE_LABEL = { A: 'A site', B: 'B site', mid: 'mid', west: 'west lane', east: 'east lane', north: 'north lane', south: 'our spawn' };

export function zoneOf(map, x, z) {
  if (Math.hypot(x - map.siteA.x, z - map.siteA.z) < 7.5) return 'A';
  if (Math.hypot(x - map.siteB.x, z - map.siteB.z) < 7.5) return 'B';
  if (Math.abs(x) <= 7 && z > -11 && z < 11) return 'mid';
  if (x < -8) return 'west';
  if (x > 8) return 'east';
  if (z < -11) return 'north';
  return 'south';
}

export function createTeamPlan({ map, bots, radio, now }) {
  let plan = 'EXECUTE_A';
  let rotatedTo = null;
  let plantHeard = false;
  const contacts = { ally: null, enemy: null };
  const eco = {
    ally: { bank: 4000, streak: 0 },
    enemy: { bank: 4000, streak: 0 },
  };
  const buyTypes = { ally: 'eco', enemy: 'eco' };

  function teamBots(team) {
    return bots.bots.filter((b) => b.team === team);
  }

  // What one bot carries into the round, by buy type and job. Utility is
  // dealt to the roles that throw it: the support flashes and smokes, the
  // lurker fakes the far site with the decoy, two defenders carry the
  // defuse kits that halve their defuse time.
  function loadoutFor(team, type, bot, i) {
    const load = { weaponId: 'p9', vest: false, helmet: false, kit: false, util: { frag: 0, flash: 0, smoke: 0, decoy: 0 } };
    if (type !== 'eco') {
      load.weaponId = type === 'full' ? 'vk47' : (i < 2 ? 'sc12' : 'p9');
      load.vest = type === 'full' || i < 2;
      load.helmet = type === 'full';
    }
    if (team === 'ally') {
      if (bot.role === 'lurker') load.util.decoy = 1;
      if (type === 'full' && bot.role === 'support') { load.util.flash = 1; load.util.smoke = 1; }
      if (type === 'full' && bot.role === 'entry' && i === 2) load.util.frag = 1;
      if (type === 'force' && bot.role === 'support') load.util.flash = 1;
    } else {
      if (type !== 'eco' && i < 2) load.kit = true;
      if (type === 'full' && i === 0) load.util.frag = 1;
      if (type !== 'eco' && i === 1) load.util.smoke = 1;
      if (type === 'full' && i === 2) load.util.flash = 1;
      if (type === 'full' && bot.role === 'rotate') load.util.smoke = 1;
    }
    return load;
  }

  function applyBuy(team) {
    const e = eco[team];
    const list = teamBots(team);
    const type = e.bank >= list.length * 2050 ? 'full' : e.bank >= list.length * 1100 ? 'force' : 'eco';
    buyTypes[team] = type;
    let spent = 0;
    list.forEach((bot, i) => {
      const load = loadoutFor(team, type, bot, i);
      bot.weaponId = load.weaponId;
      bot.gear.vest = load.vest;
      bot.gear.helmet = load.helmet;
      bot.kit = load.kit;
      bot.util = load.util;
      spent += (GEAR_COST[load.weaponId] || 0) + (load.vest ? GEAR_COST.vest : 0)
        + (load.helmet ? GEAR_COST.helmet : 0) + (load.kit ? GEAR_COST.kit : 0);
      for (const t of Object.keys(load.util)) spent += load.util[t] * UTILITY[t].price;
    });
    e.bank -= spent;
  }

  // Round income: a win pays flat, a loss pays the growing loss bonus, so
  // a beaten team forces once, then has to eco — the streak resets on a win.
  function onRoundResult(allyWon) {
    for (const team of ['ally', 'enemy']) {
      const e = eco[team];
      const won = team === 'ally' ? allyWon : !allyWon;
      if (won) {
        e.bank += 6800;
        e.streak = 0;
      } else {
        e.streak += 1;
        e.bank += 4600 + Math.min(1800, (e.streak - 1) * 600);
      }
    }
  }

  function setDirective(bot, kind, x, z, extra = {}) {
    bot.directive = { kind, x, z, faceX: extra.faceX ?? x, faceZ: extra.faceZ ?? z,
      speed: extra.speed ?? 1, until: extra.until ?? 0, site: extra.site ?? null,
      utility: extra.utility ?? null, utilityX: extra.utilityX ?? 0, utilityZ: extra.utilityZ ?? 0,
      follow: extra.follow ?? null };
  }

  function startRound(round) {
    plan = ATTACK_PLANS[(round - 1) % ATTACK_PLANS.length];
    rotatedTo = null;
    plantHeard = false;
    contacts.ally = null;
    contacts.enemy = null;
    const allies = teamBots('ally');
    const enemies = teamBots('enemy');
    allies.forEach((bot, i) => { bot.role = ALLY_ROLES[i]; bot.utilUsed = false; });
    enemies.forEach((bot, i) => { bot.role = ENEMY_ROLES[i]; bot.utilUsed = false; });
    applyBuy('ally');
    applyBuy('enemy');

    // Defence: anchors take their named angles, the fifth man holds mid.
    enemies.forEach((bot, i) => {
      if (bot.role === 'rotate') {
        setDirective(bot, 'hold', 0, -9, { faceX: 0, faceZ: 6 });
      } else {
        const site = i < 2 ? 'A' : 'B';
        const angle = DEF_HOLD[site][i % 2];
        setDirective(bot, 'hold', angle.x, angle.z, { faceX: angle.fx, faceZ: angle.fz, site });
      }
    });

    // Attack: the plan names the site; the lurker always works the far side
    // and fakes it with the decoy, so the defence has to honour both ends.
    const site = plan === 'EXECUTE_B' ? 'B' : 'A';
    const farSite = site === 'A' ? 'B' : 'A';
    const far = site === 'A' ? map.siteB : map.siteA;
    const choke = CHOKE[site];
    const farChoke = CHOKE[farSite];
    const target = site === 'A' ? map.siteA : map.siteB;
    allies.forEach((bot) => {
      if (plan === 'DEFAULT') {
        if (bot.role === 'entry' && bot === allies[0]) setDirective(bot, 'hold', -10, -2, { faceX: -6, faceZ: -12 });
        else if (bot.role === 'support') setDirective(bot, 'follow', 0, 0, { follow: allies[0] });
        else if (bot.role === 'entry') setDirective(bot, 'hold', 10, -2, { faceX: 6, faceZ: -12 });
        else setDirective(bot, 'goto', 6, 2, { speed: 0.7, site: farSite,
          utility: 'decoy', utilityX: farChoke.x, utilityZ: farChoke.z });
      } else if (bot.role === 'entry') {
        setDirective(bot, 'goto', target.x, target.z, { site });
      } else if (bot.role === 'support') {
        setDirective(bot, 'follow', 0, 0, { follow: allies[0], site,
          utility: 'flash', utilityX: choke.x, utilityZ: choke.z });
      } else {
        setDirective(bot, 'goto', far.x, far.z, { speed: 0.7, site: farSite,
          utility: 'decoy', utilityX: farChoke.x, utilityZ: farChoke.z });
      }
    });
    return plan;
  }

  function liveStart() {
    const allies = teamBots('ally').filter((b) => b.alive);
    const enemies = teamBots('enemy').filter((b) => b.alive);
    if (allies.length) {
      radio(allies[0].name, plan === 'DEFAULT' ? 'Default — play for picks.' : 'Execute ' + plan.slice(-1) + ' — on my go.', 'ally');
    }
    if (allies.length > 1) radio(allies[1].name, BUY_LINES[buyTypes.ally], 'ally');
    if (enemies.length) radio(enemies[0].name, 'Hold your angles.', 'enemy');
  }

  // A bot gained a target: feed the contact window for its team. Two or more
  // contacts in one zone inside four seconds is a callout and, for the
  // defence, a rotation.
  function onContact(bot, tx, tz) {
    const t = now();
    const zone = zoneOf(map, tx, tz);
    let w = contacts[bot.team];
    if (!w || w.zone !== zone || t - w.last > 4) {
      w = { zone, count: 0, last: t, calledOne: false, calledTwo: false };
      contacts[bot.team] = w;
    }
    w.count += 1;
    w.last = t;
    const label = ZONE_LABEL[zone];
    if (!w.calledOne) {
      w.calledOne = true;
      radio(bot.name, 'Contact ' + label + '!', bot.team);
    } else if (w.count >= 2 && !w.calledTwo) {
      w.calledTwo = true;
      radio(bot.name, zone === 'mid' ? 'Two crossing mid!' : (w.count >= 3 ? 'Three' : 'Two') + ' at ' + label + '!', bot.team);
      if (bot.team === 'enemy' && (zone === 'A' || zone === 'B') && rotatedTo !== zone) {
        rotatedTo = zone;
        const rot = teamBots('enemy').find((b) => b.role === 'rotate' && b.alive);
        if (rot) {
          const a = ROTATE_TO[zone];
          setDirective(rot, 'hold', a.x, a.z, { faceX: a.fx, faceZ: a.fz, site: zone });
          radio(rot.name, 'Rotating to ' + zone + '.', rot.team);
        }
      }
    }
  }

  // A death is a debt: the nearest living teammate who is not already in a
  // fight takes the trade — they push the killer's last known ground.
  function onDeath(victim, killerX, killerZ) {
    let best = null;
    let bestD = 17;
    for (const b of bots.bots) {
      if (b.team !== victim.team || !b.alive || b === victim || b.visibleTarget) continue;
      const d = Math.hypot(b.pos.x - killerX, b.pos.z - killerZ);
      if (d < bestD) { best = b; bestD = d; }
    }
    if (best) {
      setDirective(best, 'trade', killerX, killerZ, { speed: 1.1, until: now() + 6 });
      radio(best.name, 'Trading for ' + victim.name + '!', best.team);
    }
  }

  // The planting beeps carried: the nearest living defender says so, once.
  function onPlantHeard(x, z) {
    if (plantHeard) return;
    plantHeard = true;
    let best = null;
    let bestD = Infinity;
    for (const b of teamBots('enemy')) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < bestD) { best = b; bestD = d; }
    }
    if (best) radio(best.name, 'They are planting!', best.team);
  }

  // The spike is down: attackers fall back to named post-plant angles, the
  // defence pairs up for the retake and smokes the cross.
  function onPlant(site) {
    plantHeard = true;
    const angles = POST_PLANT[site];
    const target = site === 'A' ? map.siteA : map.siteB;
    const cross = CROSS[site];
    const allies = teamBots('ally').filter((b) => b.alive);
    allies.forEach((bot, i) => {
      const a = angles[i % angles.length];
      setDirective(bot, 'hold', a.x, a.z, { faceX: a.fx, faceZ: a.fz, site });
    });
    if (allies.length) radio(allies[0].name, 'Spike down ' + site + ' — hold angles.', 'ally');
    const enemies = teamBots('enemy').filter((b) => b.alive)
      .sort((a, b) => Math.hypot(a.pos.x - target.x, a.pos.z - target.z) - Math.hypot(b.pos.x - target.x, b.pos.z - target.z));
    enemies.forEach((bot, i) => {
      if (i === 1) setDirective(bot, 'goto', target.x, target.z, { site, utility: 'smoke', utilityX: cross.x, utilityZ: cross.z });
      else setDirective(bot, 'goto', target.x, target.z, { site });
    });
    if (enemies.length) radio(enemies[0].name, 'Retake ' + site + ' — together.', 'enemy');
  }

  return {
    startRound,
    liveStart,
    onContact,
    onDeath,
    onPlant,
    onPlantHeard,
    onRoundResult,
    planName() { return plan; },
    buyName(team) { return buyTypes[team]; },
  };
}
