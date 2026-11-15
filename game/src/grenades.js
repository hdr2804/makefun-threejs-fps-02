// Grenades: three kinds of utility behind one thrower. The frag kills inside
// a radius, the flashbang blinds whoever is facing it, the smoke hangs a
// cloud that cuts line of sight for bots and player alike. This module owns
// the inventory, the thrown-projectile pool and the flight physics; what a
// grenade DOES when its fuse ends is the simulation's business, delivered
// through hooks, so a bot's flash and the player's flash resolve identically.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const UTILITY = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, fuse: 2.2 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, fuse: 1.4 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, fuse: 1.1 },
};
export const UTILITY_ORDER = ['frag', 'flash', 'smoke'];
const GRAVITY = 12;
const POOL = 6;
const COLORS = { frag: PALETTE.enemy, flash: PALETTE.lamp, smoke: PALETTE.muted };

export function createGrenades(scene, colliders, hooks) {
  const counts = { frag: 0, flash: 0, smoke: 0 };
  const pool = [];
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.4 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, type: 'frag', team: '', thrower: null });
  }

  function spawn(type, team, thrower) {
    for (const g of pool) {
      if (g.active) continue;
      g.active = true;
      g.type = type;
      g.team = team;
      g.thrower = thrower;
      g.fuse = UTILITY[type].fuse;
      g.mesh.material.color.set(COLORS[type]);
      g.mesh.visible = true;
      return g;
    }
    return null;
  }

  // A hand throw: flat and fast, the way the player throws with G / F / T.
  function throwFrom(origin, dir, type, team, thrower) {
    const g = spawn(type, team, thrower);
    if (!g) return null;
    g.pos.copy(origin);
    g.vel.copy(dir).multiplyScalar(13);
    g.vel.y += 4.5;
    g.mesh.position.copy(origin);
    return g;
  }

  // A placed throw: an arc that lands on the target point, the way a bot
  // flashes a choke or smokes a cross. Flight time grows with distance.
  function throwAt(origin, tx, tz, type, team, thrower) {
    const g = spawn(type, team, thrower);
    if (!g) return null;
    g.pos.copy(origin);
    const dx = tx - origin.x;
    const dz = tz - origin.z;
    const dist = Math.hypot(dx, dz);
    const t = Math.max(0.55, Math.min(1.15, dist / 13));
    g.vel.set(dx / t, (0.4 - origin.y + 0.5 * GRAVITY * t * t) / t, dz / t);
    g.fuse = Math.max(UTILITY[type].fuse, t + 0.25);
    g.mesh.position.copy(origin);
    return g;
  }

  function collideAxis(g, axis, next) {
    const r = 0.11;
    const px = axis === 'x' ? next : g.pos.x;
    const py = axis === 'y' ? next : g.pos.y;
    const pz = axis === 'z' ? next : g.pos.z;
    for (const c of colliders) {
      if (px > c.min.x - r && px < c.max.x + r && py > c.min.y - r && py < c.max.y + r && pz > c.min.z - r && pz < c.max.z + r) return true;
    }
    return false;
  }

  function step(dt) {
    for (const g of pool) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const nx = g.pos.x + g.vel.x * dt;
      if (collideAxis(g, 'x', nx)) g.vel.x *= -0.45; else g.pos.x = nx;
      const nz = g.pos.z + g.vel.z * dt;
      if (collideAxis(g, 'z', nz)) g.vel.z *= -0.45; else g.pos.z = nz;
      const ny = g.pos.y + g.vel.y * dt;
      if (ny < 0.11) {
        g.pos.y = 0.11;
        g.vel.y *= -0.45;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      } else if (collideAxis(g, 'y', ny)) g.vel.y *= -0.45;
      else g.pos.y = ny;
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        if (g.type === 'frag') hooks.fragAt(g.pos, g.thrower, g.team);
        else if (g.type === 'flash') hooks.flashAt(g.pos);
        else hooks.smokeAt(g.pos);
      }
    }
  }

  return {
    counts,
    throwFrom,
    throwAt,
    step,
    buy(type) { counts[type] += 1; },
    reset() {
      counts.frag = 0;
      counts.flash = 0;
      counts.smoke = 0;
      for (const g of pool) { g.active = false; g.mesh.visible = false; }
    },
    hideAll() {
      for (const g of pool) { g.active = false; g.mesh.visible = false; }
    },
  };
}
