// The map: DUSTLINE YARD, an original 46 x 34 m industrial yard at dusk.
// Two bomb sites (A = the silo yard north-west, B = the depot south-east), three lanes
// (west, mid through the container arch, east), crates and containers as cover.
// Every box is a collider for movement and a surface a bullet stops on. The waypoint
// graph is what the bots walk: nodes at lane junctions, edges between neighbours.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.45 : 0.92,
      metalness: name === 'steel' ? 0.55 : 0.04,
    });
  }
  // A second, darker concrete for visual rhythm on crates.
  materials.dark = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.95, metalness: 0.02 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] || materials.concrete);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and perimeter.
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'canvas');
  box(0.6, WALL_H, 34.4, -23.1, WALL_H / 2, 0, 'surface');
  box(0.6, WALL_H, 34.4, 23.1, WALL_H / 2, 0, 'surface');
  box(46.4, WALL_H, 0.6, 0, WALL_H / 2, -17.1, 'surface');
  box(46.4, WALL_H, 0.6, 0, WALL_H / 2, 17.1, 'surface');

  // Site A (north-west): the silo yard. Two tall silos, low walls, a crate stack.
  box(3.2, 6.5, 3.2, -19.5, 3.25, -13.5, 'steel');
  box(3.2, 5.2, 3.2, -14.5, 2.6, -14.2, 'steel');
  box(4.5, 1.0, 0.8, -17.5, 0.5, -9.5, 'concrete');
  box(1.3, 1.3, 1.3, -12.5, 0.65, -10.5, 'sand');
  box(1.3, 1.3, 1.3, -12.5, 1.95, -10.5, 'sand');
  box(1.3, 1.3, 1.3, -11.2, 0.65, -10.5, 'sand');

  // Site B (south-east): the depot. Container stack and crate rows.
  box(6.0, 2.6, 2.4, 17.5, 1.3, 12.5, 'rust');
  box(6.0, 2.6, 2.4, 17.5, 3.9, 12.5, 'sand');
  box(2.4, 2.6, 6.0, 12.0, 1.3, 13.5, 'steel');
  box(1.3, 1.3, 1.3, 13.5, 0.65, 8.0, 'sand');
  box(1.3, 1.3, 1.3, 14.8, 0.65, 8.0, 'sand');

  // Mid: the container arch. Two containers with a gap between them, the yard's spine.
  box(2.4, 2.6, 7.0, -3.4, 1.3, 0, 'rust');
  box(2.4, 2.6, 7.0, 3.4, 1.3, 0, 'rust');
  box(9.2, 0.5, 7.0, 0, 2.85, 0, 'dark', false); // roof slab, bullets pass over it is false: it collides
  // The slab above is a roof: it must collide too, so register it manually.
  colliders.push(new THREE.Box3().setFromObject(group.children[group.children.length - 1]));
  shootables.push(group.children[group.children.length - 1]);

  // West lane cover: low wall + crates, a corner to clear.
  box(0.8, 1.2, 5.0, -19.0, 0.6, 2.0, 'concrete');
  box(1.3, 1.3, 1.3, -20.0, 0.65, 7.5, 'sand');
  box(1.3, 1.3, 1.3, -18.7, 0.65, 7.5, 'sand');
  box(2.2, 0.9, 2.2, -16.5, 0.45, -4.5, 'concrete');

  // East lane cover: container + barrel stack.
  box(2.4, 2.6, 4.0, 19.5, 1.3, -2.0, 'steel');
  box(1.3, 1.3, 1.3, 20.0, 0.65, 3.5, 'sand');
  box(1.3, 1.3, 1.3, 18.7, 0.65, 3.5, 'sand');
  box(2.2, 0.9, 2.2, 16.0, 0.45, -7.5, 'concrete');

  // Centre-north and centre-south: the two sightline breakers.
  box(3.0, 1.1, 1.2, -8.0, 0.55, -6.0, 'concrete');
  box(3.0, 1.1, 1.2, 8.0, 0.55, 6.0, 'concrete');
  box(1.6, 2.2, 1.6, -9.5, 1.1, 6.5, 'dark');
  box(1.6, 2.2, 1.6, 9.5, 1.1, -6.5, 'dark');

  // Site markers: flat amber rings on the floor, no collision, purely visual.
  function ring(x, z, label) {
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.5, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(x, 0.02, z);
    group.add(ringMesh);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.015, z);
    group.add(disc);
    return { x, z, label };
  }
  const siteA = ring(-16.5, -11.5, 'A');
  const siteB = ring(15.5, 11.0, 'B');

  // Waypoint graph: nodes by id, edges as neighbour lists. Bots walk it.
  const nodes = {
    spawnP: [0, 14.5], spawnA1: [-6, 14.5], spawnA2: [6, 14.5],
    west1: [-19, 11], west2: [-19, 2], west3: [-19, -7],
    mid1: [0, 9], mid2: [0, 0], mid3: [0, -9],
    east1: [19, 11], east2: [19, 2], east3: [19, -7],
    siteA: [-16.5, -11.5], siteB: [15.5, 11.0],
    spawnE: [0, -14.5], spawnE1: [-8, -14.5], spawnE2: [8, -14.5],
    north1: [-10, -13], north2: [10, -13],
  };
  const edges = {
    spawnP: ['spawnA1', 'spawnA2', 'mid1'],
    spawnA1: ['spawnP', 'west1', 'mid1'],
    spawnA2: ['spawnP', 'east1', 'mid1'],
    west1: ['spawnA1', 'west2', 'siteB'],
    west2: ['west1', 'west3', 'mid2'],
    west3: ['west2', 'siteA', 'mid3'],
    mid1: ['spawnP', 'mid2', 'west1', 'east1'],
    mid2: ['mid1', 'mid3', 'west2', 'east2'],
    mid3: ['mid2', 'west3', 'east3', 'north1', 'north2'],
    east1: ['spawnA2', 'east2', 'siteB'],
    east2: ['east1', 'east3', 'mid2'],
    east3: ['east2', 'mid3', 'north2'],
    siteA: ['west3', 'north1'],
    siteB: ['west1', 'east1'],
    spawnE: ['spawnE1', 'spawnE2', 'mid3'],
    spawnE1: ['spawnE', 'north1', 'west3'],
    spawnE2: ['spawnE', 'north2', 'east3'],
    north1: ['spawnE1', 'mid3', 'siteA'],
    north2: ['spawnE2', 'mid3', 'east3'],
  };

  // Light: low amber sun from the west, cool dusk fill, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.canvas), 1.05);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.amber), 2.0);
  sun.position.set(-18, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  return {
    colliders,
    shootables,
    nodes,
    edges,
    siteA,
    siteB,
    spawns: {
      player: [0, 14.5],
      allies: [[-6, 14.5], [6, 14.5]],
      enemies: [[0, -14.5], [-8, -14.5], [8, -14.5], [-13, -13]],
    },
  };
}
