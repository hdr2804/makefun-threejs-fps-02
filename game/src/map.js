// The map: DUSTLINE YARD, an original 46 x 34 m industrial yard at golden hour.
// Two bomb sites (A = the silo yard north-west, B = the depot south-east), three lanes
// (west, mid through the container arch, east), crates and containers as cover.
// Every box is a collider for movement and a surface a bullet stops on. The waypoint
// graph is what the bots walk: nodes at lane junctions, edges between neighbours.
// The look is built from geometry alone: cylindrical silos and barrels, corrugated
// container walls, floodlight poles with lit heads, hazard-striped site pads, big
// pixel-letter site signs, a distant skyline and a low sun disc on the horizon.
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
      roughness: name === 'steel' ? 0.42 : 0.92,
      metalness: name === 'steel' ? 0.55 : 0.04,
    });
  }
  // A second, darker concrete for visual rhythm on crates.
  materials.dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.95, metalness: 0.02 });
  // Lit surfaces: floodlight heads, site letters, the sun. Basic materials read as
  // emissive at a glance and never go black on their shadow side.
  materials.lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp) });
  materials.amberGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber) });
  materials.tealGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.teal) });
  materials.warnGlow = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  materials.sunGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sunset), fog: false });
  materials.skyline = new THREE.MeshBasicMaterial({ color: 0x1d2027, fog: true });

  const colliders = [];
  const shootables = [];

  // Penetration classes for ballistics.js, tagged on every surface a bullet
  // can meet: wooden crates and sheet-metal containers let a round through
  // at a price; concrete, the perimeter walls and the ground carry no class
  // and stop it dead. A box is priced by its thinnest axis and its skin.
  function boxPen(material, w, h, d) {
    const thin = Math.min(w, h, d);
    if (material === 'sand' || material === 'crateblue' || material === 'cratered') {
      return thin <= 1.4 ? 'crate' : 'sheet';
    }
    if ((material === 'rust' || material === 'steel' || material === 'dark') && h <= 2.7 && thin <= 2.6) return 'sheet';
    return null;
  }

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] || materials.concrete);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      mesh.userData.pen = boxPen(material, w, h, d);
    }
    return mesh;
  }

  function cyl(rTop, rBot, h, x, y, z, material, collide = true, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segments), materials[material] || materials.steel);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      // Barrels and vent stacks are thin skins; the silos are not.
      mesh.userData.pen = Math.max(rTop, rBot) <= 0.35 ? 'barrel' : null;
    }
    return mesh;
  }

  // A flat ground decal: no shadow casting, no collision, purely paint on the floor.
  function flat(w, d, x, z, material, opacity = 1) {
    const mat = (materials[material] || materials.concrete).clone();
    if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), mat);
    mesh.position.set(x, 0.015, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Floor and perimeter.
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'asphalt');
  box(0.6, WALL_H, 34.4, -23.1, WALL_H / 2, 0, 'surface');
  box(0.6, WALL_H, 34.4, 23.1, WALL_H / 2, 0, 'surface');
  box(46.4, WALL_H, 0.6, 0, WALL_H / 2, -17.1, 'surface');
  box(46.4, WALL_H, 0.6, 0, WALL_H / 2, 17.1, 'surface');
  // Wall cap trim catches the sunset along the top of every wall.
  box(0.8, 0.18, 34.4, -23.1, WALL_H + 0.09, 0, 'rust', false);
  box(0.8, 0.18, 34.4, 23.1, WALL_H + 0.09, 0, 'rust', false);
  box(46.4, 0.18, 0.8, 0, WALL_H + 0.09, -17.1, 'rust', false);
  box(46.4, 0.18, 0.8, 0, WALL_H + 0.09, 17.1, 'rust', false);

  // Ground paint: concrete pads under both sites, lane centre dashes, spawn apron.
  flat(13, 11, -16.5, -11.5, 'concrete', 0.55);
  flat(13, 11, 15.5, 11.0, 'concrete', 0.55);
  flat(10, 4.5, 0, 14.5, 'concrete', 0.4);
  for (let z = -13; z <= 13; z += 3.4) flat(0.28, 1.7, 0, z, 'sand', 0.65);
  for (let x = -20; x <= 20; x += 4.2) flat(1.9, 0.24, x, 3.4, 'muted', 0.3);

  // Site A (north-west): the silo yard. Two cylindrical silos with caps and a down
  // pipe, low walls, a crate stack, barrels and a floodlight.
  cyl(1.7, 1.7, 6.5, -19.5, 3.25, -13.5, 'steel');
  cyl(1.85, 1.85, 0.35, -19.5, 6.65, -13.5, 'rust');
  cyl(1.5, 1.5, 5.2, -14.5, 2.6, -14.2, 'crateblue');
  cyl(1.62, 1.62, 0.3, -14.5, 5.35, -14.2, 'rust');
  cyl(0.16, 0.16, 5.6, -17.6, 2.8, -13.8, 'rust');
  box(4.5, 1.0, 0.8, -17.5, 0.5, -9.5, 'concrete');
  box(1.3, 1.3, 1.3, -12.5, 0.65, -10.5, 'sand');
  box(1.3, 1.3, 1.3, -12.5, 1.95, -10.5, 'sand');
  box(1.3, 1.3, 1.3, -11.2, 0.65, -10.5, 'cratered');

  // Site B (south-east): the depot. Container stack and crate rows.
  box(6.0, 2.6, 2.4, 17.5, 1.3, 12.5, 'rust');
  box(6.0, 2.6, 2.4, 17.5, 3.9, 12.5, 'crateblue');
  box(2.4, 2.6, 6.0, 12.0, 1.3, 13.5, 'steel');
  box(1.3, 1.3, 1.3, 13.5, 0.65, 8.0, 'sand');
  box(1.3, 1.3, 1.3, 14.8, 0.65, 8.0, 'sand');

  // Mid: the container arch. Two containers with a gap between them, the yard's spine.
  box(2.4, 2.6, 7.0, -3.4, 1.3, 0, 'cratered');
  box(2.4, 2.6, 7.0, 3.4, 1.3, 0, 'crateblue');
  box(9.2, 0.5, 7.0, 0, 2.85, 0, 'dark', false); // roof slab, bullets pass over it is false: it collides
  // The slab above is a roof: it must collide too, so register it manually.
  colliders.push(new THREE.Box3().setFromObject(group.children[group.children.length - 1]));
  shootables.push(group.children[group.children.length - 1]);
  // Container ribs: thin vertical strips proud of the arch walls.
  for (const sx of [-4.65, 4.65]) {
    for (let i = 0; i < 5; i += 1) box(0.1, 2.6, 0.28, sx, 1.3, -2.8 + i * 1.4, 'dark', false);
  }

  // West lane cover: low wall + crates, a corner to clear.
  box(0.8, 1.2, 5.0, -19.0, 0.6, 2.0, 'concrete');
  box(1.3, 1.3, 1.3, -20.0, 0.65, 7.5, 'sand');
  box(1.3, 1.3, 1.3, -18.7, 0.65, 7.5, 'crateblue');
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

  // Mid-south variety: a pipe rack to crouch behind on the way to B, and a
  // pallet stack breaking the west-mid sightline.
  box(2.6, 1.0, 0.6, 7.5, 0.5, 12.8, 'rust');
  cyl(0.09, 0.09, 2.6, 7.5, 1.25, 12.8, 'steel', false, 8).rotation.z = Math.PI / 2;
  box(2.0, 0.14, 1.4, -7.5, 0.07, -3.2, 'sand');
  box(2.0, 0.14, 1.4, -7.5, 0.35, -3.2, 'dark', false);
  box(2.0, 0.14, 1.4, -7.5, 0.62, -3.2, 'sand', false);
  box(1.3, 1.3, 1.3, -7.5, 1.3, -3.2, 'crateblue');

  // Barrels: rust and sunset clusters that read instantly as a yard. Each cluster
  // shares one collider footprint via its first barrel; the rest are visual.
  function barrels(x, z, n) {
    const spots = [[0, 0], [0.72, 0.2], [0.3, 0.68], [-0.45, 0.55], [0.15, -0.6]];
    for (let i = 0; i < n; i += 1) {
      cyl(0.32, 0.32, 0.92, x + spots[i][0], 0.46, z + spots[i][1], i % 2 ? 'rust' : 'sunset', i === 0, 12);
    }
    cyl(0.32, 0.32, 0.92, x + 0.2, 1.38, z + 0.25, 'steel', false, 12);
  }
  barrels(-8.6, -12.8, 4);
  barrels(9.8, 12.6, 3);
  barrels(-21.2, -3.4, 3);
  barrels(6.2, -11.8, 4);

  // Sandbag lines and pallet stacks: low cover dressing along the lanes.
  function sandbags(x, z, alongX) {
    for (let i = 0; i < 5; i += 1) {
      const dx = alongX ? (i - 2) * 0.62 : 0;
      const dz = alongX ? 0 : (i - 2) * 0.62;
      box(0.58, 0.3, 0.42, x + dx, 0.15, z + dz, 'sand', i === 2);
      box(0.58, 0.3, 0.42, x + dx * 0.9, 0.45, z + dz * 0.9, 'sand', false);
    }
  }
  sandbags(-5.5, 6.8, true);
  sandbags(11.5, -3.4, false);
  box(2.0, 0.14, 1.4, -13.2, 0.07, 4.6, 'sand');
  box(2.0, 0.14, 1.4, -13.2, 0.35, 4.6, 'dark', false);
  box(2.0, 0.14, 1.4, -13.2, 0.62, 4.6, 'sand', false);

  // Floodlight poles: a mast, a lit head, and a real point light at both
  // sites. The sites have their own light: A burns sodium amber, B burns teal.
  function floodlight(x, z, withLight, tint = 'lamp') {
    cyl(0.09, 0.12, 5.6, x, 2.8, z, 'dark', true, 8);
    const head = box(0.9, 0.3, 0.24, x, 5.7, z, 'dark', false);
    head.material = materials.dark;
    const faceMat = tint === 'teal' ? materials.tealGlow : materials.lampGlow;
    const lampFace = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.05), faceMat);
    lampFace.position.set(x, 5.68, z + 0.14);
    group.add(lampFace);
    const lampBack = lampFace.clone();
    lampBack.position.z = z - 0.14;
    group.add(lampBack);
    if (withLight) {
      const light = new THREE.PointLight(new THREE.Color(tint === 'teal' ? PALETTE.teal : PALETTE.lamp), 55, 22, 1.8);
      light.position.set(x, 5.4, z);
      scene.add(light);
    }
  }
  floodlight(-20.8, -8.2, true);
  floodlight(20.6, 8.6, true, 'teal');
  floodlight(6.8, -15.6, false);
  floodlight(-7.4, 15.8, false, 'teal');

  // Pipes running the north wall, and a gantry beam over the mid arch.
  const pipe = cyl(0.14, 0.14, 30, -6, 3.6, -16.7, 'rust', false, 10);
  pipe.rotation.z = Math.PI / 2;
  const pipe2 = cyl(0.1, 0.1, 30, -6, 3.25, -16.7, 'steel', false, 10);
  pipe2.rotation.z = Math.PI / 2;
  box(10.5, 0.35, 0.5, 0, 4.6, -3.6, 'rust', false);
  box(0.4, 4.6, 0.4, -5.0, 2.3, -3.6, 'dark');
  box(0.4, 4.6, 0.4, 5.0, 2.3, -3.6, 'dark');

  // Distant skyline and the low sun: silhouettes beyond the walls, no collision.
  const skylineSpots = [[-26, -30, 7, 16], [-14, -32, 5, 11], [2, -31, 8, 19], [16, -30, 6, 13], [28, -29, 7, 15], [-30, 6, 6, 12], [30, -6, 6, 17], [24, 24, 8, 12], [-24, 24, 7, 14]];
  for (const [x, z, w, h] of skylineSpots) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), materials.skyline);
    m.position.set(x, h / 2 - 0.5, z);
    group.add(m);
  }
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), materials.sunGlow);
  sunDisc.position.set(-34, 7.5, -26);
  sunDisc.lookAt(0, 3, 0);
  group.add(sunDisc);
  const sunHalo = new THREE.Mesh(
    new THREE.RingGeometry(4.8, 6.4, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.horizon), transparent: true, opacity: 0.4, fog: false }),
  );
  sunHalo.position.copy(sunDisc.position);
  sunHalo.lookAt(0, 3, 0);
  group.add(sunHalo);

  // Grass tufts along the wall bases: small green cones, a third colour in the yard.
  for (const [x, z] of [[-22, 15], [-9, -16.2], [14, 16.3], [22.2, -12], [-22.3, -14], [8, 16.4], [-15, 16.2]]) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 6), materials.grass);
    tuft.position.set(x, 0.27, z);
    group.add(tuft);
  }

  // Site markers: flat rings on the floor, hazard-striped on the rim — amber
  // at A, teal at B, so a site reads by colour before its letter does.
  function ring(x, z, label) {
    const color = label === 'B' ? PALETTE.teal : PALETTE.amber;
    const flatMat = label === 'B' ? 'teal' : 'amber';
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.5, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(x, 0.03, z);
    group.add(ringMesh);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.025, z);
    group.add(disc);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      if (i % 2) continue;
      flat(0.62, 0.3, x + Math.cos(a) * 2.85, z + Math.sin(a) * 2.85, flatMat, 0.8);
    }
    return { x, z, label };
  }
  const siteA = ring(-16.5, -11.5, 'A');
  const siteB = ring(15.5, 11.0, 'B');

  // Site signs: a panel on posts with the site letter in lit pixel blocks, readable
  // from every lane that approaches the site.
  const LETTERS = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '11110'],
  };
  function siteSign(x, z, letter, faceDir) {
    const glow = letter === 'B' ? materials.tealGlow : materials.amberGlow;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = faceDir;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.7, 0.18), materials.dark);
    panel.position.y = 2.5;
    panel.castShadow = true;
    g.add(panel);
    colliders.push(new THREE.Box3().setFromObject(panel.clone().translateX(x).translateZ(z)));
    for (const px of [-0.8, 0.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 0.16), materials.dark);
      post.position.set(px, 0.65, 0);
      g.add(post);
    }
    const rows = LETTERS[letter];
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        if (rows[r][c] !== '1') continue;
        for (const side of [0.13, -0.13]) {
          const cube = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.27, 0.05), glow);
          cube.position.set((c - 2) * 0.36, 3.45 - r * 0.36, side);
          g.add(cube);
        }
      }
    }
    group.add(g);
  }
  siteSign(-12.8, -7.6, 'A', 0.5);
  siteSign(11.6, 7.2, 'B', -2.2);

  // The living skyline: a harbour crane beyond the north wall whose jib
  // slews slowly, a rotating beacon on the silo, red aviation lights on the
  // tall points, and steam breathing from two vent stacks. tick() below is
  // their only clock; nothing here collides or stops a bullet.
  const crane = new THREE.Group();
  crane.position.set(17, 0, -27);
  const craneTower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 15, 1.4), materials.skyline);
  craneTower.position.y = 7.5;
  crane.add(craneTower);
  const craneJib = new THREE.Group();
  craneJib.position.y = 14.6;
  const jibArm = new THREE.Mesh(new THREE.BoxGeometry(19, 0.55, 0.55), materials.skyline);
  jibArm.position.x = -5;
  const jibCounter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.2), materials.skyline);
  jibCounter.position.x = 5.4;
  const jibCable = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.4, 0.08), materials.skyline);
  jibCable.position.set(-12.5, -2.2, 0);
  const jibHook = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), materials.skyline);
  jibHook.position.set(-12.5, -4.8, 0);
  craneJib.add(jibArm, jibCounter, jibCable, jibHook);
  crane.add(craneJib);
  group.add(crane);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), materials.warnGlow);
  beacon.position.set(-19.5, 7.0, -13.5);
  group.add(beacon);
  const beaconLight = new THREE.PointLight(0xff3524, 0, 16, 1.6);
  beaconLight.position.copy(beacon.position);
  scene.add(beaconLight);

  const aviation = [];
  for (const [x, y, z, phase] of [[-5.0, 4.95, -3.6, 0], [5.0, 4.95, -3.6, 1.4], [-14.5, 5.6, -14.2, 2.6], [0, 5.05, -17.1, 0.8]]) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), materials.warnGlow);
    bulb.position.set(x, y, z);
    group.add(bulb);
    aviation.push({ mesh: bulb, phase });
  }

  // Steam vents: a squat boiler stack by each site pipe run, breathing puffs
  // on a loop. The puff pool is small and every puff is a reused sphere.
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.2, depthWrite: false });
  const steamPuffs = [];
  function steamVent(x, z, phase) {
    cyl(0.24, 0.3, 1.7, x, 0.85, z, 'rust', true, 10);
    for (let i = 0; i < 4; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), steamMat);
      puff.position.set(x, 1.8, z);
      group.add(puff);
      steamPuffs.push({ mesh: puff, x, z, phase: phase + i * 0.25 });
    }
  }
  steamVent(-21.6, -5.6, 0);
  steamVent(21.8, 4.2, 0.5);

  function tick(now) {
    craneJib.rotation.y = Math.sin(now * 0.045) * 0.65;
    const sweep = (Math.sin(now * 2.4) + 1) / 2;
    beacon.material = sweep > 0.72 ? materials.warnGlow : materials.dark;
    beaconLight.intensity = sweep > 0.72 ? 26 : 0;
    for (const a of aviation) a.mesh.visible = Math.sin(now * 1.6 + a.phase) > 0.2;
    for (const p of steamPuffs) {
      const age = (now * 0.22 + p.phase) % 1;
      p.mesh.position.set(p.x + age * 0.9, 1.8 + age * 3.0, p.z + age * 0.3);
      p.mesh.scale.setScalar(0.5 + age * 2.1);
    }
  }

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

  // Light: a low sunset from the west, warm hemisphere bounce, cool fill.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.horizon), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sunset), 2.6);
  sun.position.set(-20, 15, 9);
  sun.target.position.set(5, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 75;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.55);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  return {
    colliders,
    shootables,
    nodes,
    edges,
    siteA,
    siteB,
    tick,
    spawns: {
      player: [0, 14.5],
      allies: [[-6, 14.5], [6, 14.5], [-3.2, 15.6], [3.2, 15.6]],
      enemies: [[0, -14.5], [-8, -14.5], [8, -14.5], [-13.5, -12.5], [13.5, -12.5]],
    },
  };
}
