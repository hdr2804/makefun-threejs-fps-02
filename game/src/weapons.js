// The arsenal: four original weapons. Each definition owns its numbers
// (damage, magazine, spread, recoil, price); this module owns the view model,
// the muzzle flash and the reload cycle. Where a shot lands and what it costs
// the target is ballistics.js; the money is rounds.js; utility is grenades.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { inaccuracy, recoilFor, FIRST_SHOT_PAUSE, PATTERN_RESET } from './ballistics.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, auto: false,
    damage: 26, mag: 12, reserve: 48, gap: 0.16, reload: 1.25,
    spreadStill: 0.004, spreadMove: 0.03, kick: 0.006, pellets: 1, range: 60,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Carbine', price: 900, auto: true,
    damage: 30, mag: 25, reserve: 75, gap: 0.105, reload: 2.0,
    spreadStill: 0.003, spreadMove: 0.035, kick: 0.011, pellets: 1, range: 70,
  },
  sc12: {
    id: 'sc12', name: 'SC-12 Scattergun', price: 700, auto: false,
    damage: 12, mag: 6, reserve: 24, gap: 0.85, reload: 2.6,
    spreadStill: 0.045, spreadMove: 0.07, kick: 0.03, pellets: 8, range: 26,
  },
  ls7: {
    id: 'ls7', name: 'LS-7 Longshot', price: 1500, auto: false,
    damage: 85, mag: 5, reserve: 20, gap: 0.9, reload: 2.8,
    spreadStill: 0.0008, spreadMove: 0.05, kick: 0.028, pellets: 1, range: 90,
  },
};
export const WEAPON_ORDER = ['p9', 'vk47', 'sc12', 'ls7'];

function buildViewModel(def) {
  // The view model sits against a dark yard, so the receiver is the light ink colour
  // and only the grip stays dark; otherwise the gun vanishes into the background.
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.25 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.5, metalness: 0.2 });
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  if (def.id === 'p9') {
    add(0.07, 0.11, 0.24, 0, 0, -0.1, metal);
    add(0.06, 0.12, 0.08, 0, -0.09, 0.02, dark);
  } else if (def.id === 'vk47') {
    add(0.09, 0.1, 0.46, 0, 0, -0.12, metal);
    add(0.05, 0.05, 0.42, 0, 0.03, -0.42, dark);
    add(0.07, 0.14, 0.1, 0, -0.1, 0.05, dark);
    add(0.08, 0.08, 0.24, 0, -0.02, 0.28, dark);
    add(0.02, 0.05, 0.02, 0, 0.07, -0.2, accent);
  } else if (def.id === 'sc12') {
    add(0.1, 0.11, 0.5, 0, 0, -0.14, dark);
    add(0.09, 0.09, 0.5, 0, -0.01, -0.16, metal);
    add(0.08, 0.1, 0.16, 0, -0.08, 0.14, metal);
  } else {
    add(0.08, 0.09, 0.62, 0, 0, -0.2, metal);
    add(0.06, 0.06, 0.2, 0, 0.08, -0.05, dark);
    add(0.07, 0.12, 0.1, 0, -0.09, 0.08, dark);
    add(0.03, 0.03, 0.3, 0, 0.03, -0.5, accent);
    // A scope tube with a glass lens the player can actually aim through.
    add(0.055, 0.055, 0.22, 0, 0.085, -0.18, dark);
    const lens = add(0.04, 0.04, 0.012, 0, 0.085, -0.3, accent);
    lens.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.teal) });
  }
  // Forearms and a gloved hand on the grip: the gun is held, not floating.
  add(0.09, 0.09, 0.3, -0.02, -0.17, 0.16, dark);
  add(0.075, 0.1, 0.12, 0.0, -0.13, 0.03, accent);
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapons(camera) {
  const models = {};
  for (const id of WEAPON_ORDER) {
    models[id] = buildViewModel(WEAPONS[id]);
    models[id].visible = false;
    camera.add(models[id]);
  }
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sunset), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const flash = new THREE.Group();
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), flashMat);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), flashMat);
  flashB.rotation.z = Math.PI / 4;
  const flashCore = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  flash.add(flashA, flashB, flashCore);
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const id of WEAPON_ORDER) ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

  const state = {
    current: 'p9',
    owned: ['p9'],
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: 1,
    flash: 0,
    kick: 0,
    bloom: 0,
    ads: false,
    adsBlend: 0,
    shotsFired: 0,   // rounds into the current burst, indexes the recoil pattern
    restTime: 99,    // seconds since the last shot; rests reset pattern + earn first-shot accuracy
    kickPattern: { pitch: 0, yaw: 0 }, // the kick of the most recent round, from ballistics
  };

  function showCurrent() {
    for (const id of WEAPON_ORDER) models[id].visible = id === state.current;
  }
  showCurrent();

  function spread(moveSpeed, airborne = false, crouching = false) {
    return inaccuracy(WEAPONS[state.current], {
      speed: moveSpeed,
      airborne,
      crouching,
      adsBlend: state.adsBlend,
      bloom: state.bloom,
      firstShot: state.restTime > FIRST_SHOT_PAUSE,
    });
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.05);
    state.restTime += dt;
    if (state.restTime > PATTERN_RESET) state.shotsFired = 0;
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    // Aim-down-sights: the view model glides to the centre and the flash follows it.
    state.adsBlend += ((state.ads ? 1 : 0) - state.adsBlend) * Math.min(1, dt * 16);
    const b = state.adsBlend;
    const model = models[state.current];
    model.position.set(0.24 * (1 - b), -0.2 + 0.052 * b, -0.42 + state.kick + 0.04 * b);
    model.rotation.x = state.kick * 2.0;
    flash.position.set(0.24 * (1 - b), -0.17 + 0.05 * b, -0.95);
    flashLight.position.set(0.24 * (1 - b), -0.16 + 0.05 * b, -0.6);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    const s = 1 + state.flash * 3;
    flash.scale.set(s, s, 1);
    flashLight.intensity = state.flash > 0 ? 22 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.current];
      const progress = 1 - state.reloadLeft / state.reloadTotal;
      model.rotation.x = -0.5 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const need = def.mag - ammo[state.current].mag;
        const take = Math.min(need, ammo[state.current].reserve);
        ammo[state.current].mag += take;
        ammo[state.current].reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    step,
    def() { return WEAPONS[state.current]; },
    spread,
    ready() { return state.cooldown <= 0 && state.reloadLeft <= 0; },
    canFire() { return ammo[state.current].mag > 0; },
    takeRound() {
      if (!this.ready() || ammo[state.current].mag <= 0) return false;
      const def = WEAPONS[state.current];
      ammo[state.current].mag -= 1;
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = def.kick;
      state.bloom = Math.min(0.02, state.bloom + def.kick * 0.35);
      const kick = recoilFor(def, state.shotsFired);
      state.kickPattern.pitch = kick.pitch;
      state.kickPattern.yaw = kick.yaw;
      state.shotsFired += 1;
      state.restTime = 0;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || ammo[state.current].mag === def.mag || ammo[state.current].reserve === 0) return false;
      state.reloadLeft = def.reload;
      state.reloadTotal = def.reload;
      return true;
    },
    refillAmmo() {
      for (const id of WEAPON_ORDER) {
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
    },
    switchTo(id) {
      if (!state.owned.includes(id) || state.reloadLeft > 0) return false;
      state.current = id;
      state.cooldown = Math.max(state.cooldown, 0.25);
      showCurrent();
      return true;
    },
    buy(id) {
      if (state.owned.includes(id)) return false;
      state.owned.push(id);
      return true;
    },
    setAds(on) { state.ads = !!on; },
    muzzleWorld(out) {
      const b = state.adsBlend;
      out.set(0.24 * (1 - b), -0.17 + 0.05 * b, -0.95);
      return camera.localToWorld(out);
    },
  };
}
