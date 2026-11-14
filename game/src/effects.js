// Transient combat effects, all from preallocated pools: tracers, impact sparks,
// explosions and the grenade meshes. Nothing is created per shot; the pools recycle.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 12;
const SPARKS = 10;

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) });
  const sparks = [];
  for (let i = 0; i < SPARKS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }
  let sparkNext = 0;

  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 18);
  scene.add(boomLight);
  let boomLife = 0;

  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.4 });
  const grenades = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0 });
  }

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  return {
    tracer(from, to) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACERS;
      tmpA.copy(to).sub(from);
      const len = tmpA.length();
      t.mesh.position.copy(from).addScaledVector(tmpA, 0.5);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(to);
      t.mesh.visible = true;
      t.life = 0.07;
    },
    spark(point, count = 3) {
      for (let i = 0; i < count; i += 1) {
        const s = sparks[sparkNext];
        sparkNext = (sparkNext + 1) % SPARKS;
        s.mesh.position.copy(point);
        s.vel.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).multiplyScalar(3);
        s.mesh.visible = true;
        s.life = 0.25;
      }
    },
    explosion(point) {
      boom.position.copy(point);
      boom.visible = true;
      boomLife = 0.5;
      boomLight.position.copy(point).y += 1;
      boomLight.intensity = 60;
    },
    throwGrenade(from, dir) {
      for (const g of grenades) {
        if (g.active) continue;
        g.active = true;
        g.pos.copy(from);
        g.vel.copy(dir).multiplyScalar(13);
        g.vel.y += 4.5;
        g.fuse = 2.2;
        g.mesh.visible = true;
        g.mesh.position.copy(from);
        return g;
      }
      return null;
    },
    grenades,
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          if (t.life <= 0) t.mesh.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          s.mesh.position.addScaledVector(s.vel, dt);
          s.vel.y -= 9 * dt;
          if (s.life <= 0) s.mesh.visible = false;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const p = 1 - boomLife / 0.5;
        boom.scale.setScalar(1 + p * 7);
        boom.material.opacity = 0.55 * (1 - p);
        boomLight.intensity = 60 * (1 - p);
        if (boomLife <= 0) {
          boom.visible = false;
          boomLight.intensity = 0;
        }
      }
    },
    hideAll() {
      for (const t of tracers) { t.mesh.visible = false; t.life = 0; }
      for (const s of sparks) { s.mesh.visible = false; s.life = 0; }
      boom.visible = false;
      boomLife = 0;
      boomLight.intensity = 0;
      for (const g of grenades) { g.active = false; g.mesh.visible = false; }
    },
  };
}
