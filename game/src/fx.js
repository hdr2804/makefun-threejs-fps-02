// Transient combat effects, all from preallocated pools: tracers, impact
// sparks and dust, shell casings, explosions, smoke clouds and the flashbang
// pop. Nothing is created per shot; every pool recycles its oldest member.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 12;
const SPARKS = 10;
const SHELLS = 16;
const SMOKES = 4;

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sunset) });
  const sparks = [];
  for (let i = 0; i < SPARKS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }
  let sparkNext = 0;

  // Dust puffs: soft spheres that bloom and fade where a bullet lands.
  const dustMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sand), transparent: true, opacity: 0.35, depthWrite: false });
  const dusts = [];
  for (let i = 0; i < 8; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), dustMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    dusts.push({ mesh, life: 0 });
  }
  let dustNext = 0;

  // Shell casings: small brass boxes that jump from the gun and settle.
  const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber) });
  const shells = [];
  for (let i = 0; i < SHELLS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), shellMat);
    mesh.visible = false;
    scene.add(mesh);
    shells.push({ mesh, life: 0, vel: new THREE.Vector3(), spin: 0 });
  }
  let shellNext = 0;

  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 18);
  scene.add(boomLight);
  let boomLife = 0;

  // The flashbang pop: a white core and a hard light pulse, gone in a blink.
  const flashBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
  );
  flashBall.visible = false;
  scene.add(flashBall);
  const flashLight = new THREE.PointLight(0xffffff, 0, 26);
  scene.add(flashLight);
  let flashLife = 0;

  // Smoke clouds: a cluster of soft spheres that swells, hangs, and thins.
  // The same list the bots' line-of-sight test reads, so what the player sees
  // is exactly what the bots cannot see through.
  const smokes = [];
  for (let i = 0; i < SMOKES; i += 1) {
    // One material clone per cloud, so clouds fade independently.
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.5, depthWrite: false });
    const group = new THREE.Group();
    const puffs = [];
    const spots = [[0, 1.1, 0], [1.1, 0.9, 0.4], [-1.0, 1.0, -0.5], [0.4, 1.3, -1.0], [-0.5, 0.8, 1.0], [0.9, 1.5, -0.3]];
    for (const [sx, sy, sz] of spots) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), smokeMat);
      m.position.set(sx, sy, sz);
      group.add(m);
      puffs.push(m);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, puffs, x: 0, z: 0, r: 2.6, life: 0, maxLife: 12 });
  }
  let smokeNext = 0;

  const tmpA = new THREE.Vector3();

  return {
    smokes,
    tracer(from, to) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACERS;
      tmpA.copy(to).sub(from);
      const len = tmpA.length();
      t.mesh.position.copy(from).addScaledVector(tmpA, 0.5);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(to);
      t.mesh.visible = true;
      t.life = 0.09;
    },
    spark(point, count = 3) {
      for (let i = 0; i < count; i += 1) {
        const s = sparks[sparkNext];
        sparkNext = (sparkNext + 1) % SPARKS;
        s.mesh.position.copy(point);
        s.vel.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).multiplyScalar(3.4);
        s.mesh.visible = true;
        s.life = 0.28;
      }
      const d = dusts[dustNext];
      dustNext = (dustNext + 1) % dusts.length;
      d.mesh.position.copy(point);
      d.mesh.scale.setScalar(0.7);
      d.mesh.visible = true;
      d.life = 0.45;
    },
    shell(from, right) {
      const s = shells[shellNext];
      shellNext = (shellNext + 1) % SHELLS;
      s.mesh.position.copy(from);
      s.vel.copy(right).multiplyScalar(1.1 + Math.random() * 0.5);
      s.vel.y = 1.5 + Math.random() * 0.6;
      s.spin = 6 + Math.random() * 10;
      s.mesh.visible = true;
      s.life = 1.1;
    },
    explosion(point) {
      boom.position.copy(point);
      boom.visible = true;
      boomLife = 0.5;
      boomLight.position.copy(point).y += 1;
      boomLight.intensity = 60;
    },
    flashPop(point) {
      flashBall.position.copy(point);
      flashBall.visible = true;
      flashLife = 0.16;
      flashLight.position.copy(point);
      flashLight.intensity = 90;
    },
    smoke(x, z) {
      const s = smokes[smokeNext];
      smokeNext = (smokeNext + 1) % SMOKES;
      s.x = x;
      s.z = z;
      s.life = s.maxLife;
      s.group.position.set(x, 0, z);
      s.group.scale.setScalar(0.25);
      s.group.visible = true;
      return s;
    },
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
      for (const d of dusts) {
        if (d.life > 0) {
          d.life -= dt;
          d.mesh.scale.multiplyScalar(1 + dt * 2.6);
          d.mesh.material.opacity = 0.35 * Math.max(0, d.life / 0.45);
          d.mesh.position.y += dt * 0.5;
          if (d.life <= 0) d.mesh.visible = false;
        }
      }
      for (const s of shells) {
        if (s.life > 0) {
          s.life -= dt;
          s.vel.y -= 9 * dt;
          s.mesh.position.addScaledVector(s.vel, dt);
          if (s.mesh.position.y < 0.03) {
            s.mesh.position.y = 0.03;
            s.vel.y *= -0.35;
            s.vel.x *= 0.6;
            s.vel.z *= 0.6;
          }
          s.mesh.rotation.x += s.spin * dt;
          s.mesh.rotation.z += s.spin * 0.7 * dt;
          if (s.life <= 0) s.mesh.visible = false;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const p = 1 - boomLife / 0.5;
        boom.scale.setScalar(1 + p * 9);
        boom.material.opacity = 0.6 * (1 - p);
        boomLight.intensity = 80 * (1 - p);
        if (boomLife <= 0) {
          boom.visible = false;
          boomLight.intensity = 0;
        }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        const p = Math.max(0, flashLife / 0.16);
        flashBall.material.opacity = 0.95 * p;
        flashBall.scale.setScalar(1 + (1 - p) * 2.2);
        flashLight.intensity = 90 * p;
        if (flashLife <= 0) {
          flashBall.visible = false;
          flashLight.intensity = 0;
        }
      }
      for (const s of smokes) {
        if (s.life <= 0) continue;
        s.life -= dt;
        const age = 1 - s.life / s.maxLife;
        const grow = Math.min(1, age * 6);
        s.group.scale.setScalar(0.25 + 0.75 * grow);
        const fade = s.life < 2 ? s.life / 2 : 1;
        s.puffs[0].material.opacity = 0.5 * fade;
        if (s.life <= 0) s.group.visible = false;
      }
    },
    hideAll() {
      for (const t of tracers) { t.mesh.visible = false; t.life = 0; }
      for (const s of sparks) { s.mesh.visible = false; s.life = 0; }
      for (const d of dusts) { d.mesh.visible = false; d.life = 0; }
      for (const s of shells) { s.mesh.visible = false; s.life = 0; }
      for (const s of smokes) { s.group.visible = false; s.life = 0; }
      boom.visible = false;
      boomLife = 0;
      boomLight.intensity = 0;
      flashBall.visible = false;
      flashLife = 0;
      flashLight.intensity = 0;
    },
  };
}
