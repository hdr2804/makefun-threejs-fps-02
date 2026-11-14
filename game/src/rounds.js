// Rounds and money: one match is first to 5 round wins (at most 9 rounds). Each round
// is a buy phase, a live phase, and an end banner. The player attacks with the bomb:
// plant it at site A or B and it explodes after 35 s, or eliminate the Jackals.
// Money: kill +$200, round win +$600, round loss +$300, plant +$300. The buy menu
// spends it on weapons and grenades between rounds. All numbers live here; main.js
// and hud.js only read the state and call the transitions.
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE } from './weapons.js';

export const BUY_SECONDS = 10;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const DEFUSE_SECONDS = 4;
export const PLANT_SECONDS = 3;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function createRounds(events) {
  const state = {
    phase: 'buy', // buy | live | planted | ended | match
    round: 1,
    wins: 0, // Vanguard (player team) rounds
    losses: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    plants: 0,
    phaseLeft: BUY_SECONDS,
    plantProgress: 0,
    planting: false,
    defuseProgress: 0,
    bombSite: null,
    bombPos: null,
    endReason: '',
    matchWinner: null,
    buyOpen: false,
  };

  function startRound() {
    state.phase = 'buy';
    state.phaseLeft = BUY_SECONDS;
    state.plantProgress = 0;
    state.planting = false;
    state.defuseProgress = 0;
    state.bombSite = null;
    state.bombPos = null;
    state.endReason = '';
    state.buyOpen = true;
    events.onRoundStart(state.round);
  }

  function endRound(won, reason) {
    if (state.phase === 'ended' || state.phase === 'match') return;
    state.phase = 'ended';
    state.phaseLeft = 4;
    state.endReason = reason;
    state.buyOpen = false;
    if (won) {
      state.wins += 1;
      state.money += 600;
    } else {
      state.losses += 1;
      state.money += 300;
    }
    events.onRoundEnd(won, reason, state.wins, state.losses);
    if (state.wins >= WIN_ROUNDS || state.losses >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'match';
      state.matchWinner = state.wins > state.losses ? 'Vanguard' : 'Jackals';
      events.onMatchEnd(state.matchWinner, state.wins, state.losses);
    }
  }

  function nextRound() {
    if (state.phase === 'match') return;
    state.round += 1;
    startRound();
  }

  function tick(dt) {
    if (state.phase === 'buy') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        state.phase = 'live';
        state.phaseLeft = ROUND_SECONDS;
        state.buyOpen = false;
        events.onLiveStart();
      }
    } else if (state.phase === 'live') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) endRound(false, 'Time expired — the Jackals held the yard.');
    } else if (state.phase === 'planted') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        events.onBombExploded();
        endRound(true, 'The spike detonated at site ' + state.bombSite + '.');
      }
    } else if (state.phase === 'ended') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) nextRound();
    }
  }

  function onKill(byPlayer) {
    if (!byPlayer) return;
    state.kills += 1;
    state.money += 200;
  }

  function plantAt(site, x, z) {
    state.phase = 'planted';
    state.phaseLeft = FUSE_SECONDS;
    state.bombSite = site;
    state.bombPos = { x, z };
    state.plants += 1;
    state.money += 300;
    state.planting = false;
    state.plantProgress = 0;
    events.onPlanted(site);
  }

  function defused() {
    endRound(false, 'The Jackals defused the spike.');
  }

  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def || state.money < def.price) return false;
    state.money -= def.price;
    return true;
  }

  function buyGrenade() {
    if (state.money < GRENADE_PRICE) return false;
    state.money -= GRENADE_PRICE;
    return true;
  }

  function resetMatch() {
    state.round = 1;
    state.wins = 0;
    state.losses = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.plants = 0;
    state.matchWinner = null;
    startRound();
  }

  return {
    state,
    startRound,
    endRound,
    nextRound,
    tick,
    onKill,
    plantAt,
    defused,
    buyWeapon,
    buyGrenade,
    resetMatch,
    buyList() {
      return WEAPON_ORDER.map((id) => ({
        id,
        name: WEAPONS[id].name,
        price: WEAPONS[id].price,
        damage: WEAPONS[id].damage,
        mag: WEAPONS[id].mag,
      }));
    },
  };
}
