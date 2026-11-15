// Ballistics: the pure math of a shot — where it can go and what it does when it
// lands. No three.js, no game state: callers pass numbers in and get numbers
// out, so the same functions price the player's ray and read plainly on paper.
//
// Locational damage: a headshot is worth four torso hits, a limb three
// quarters, and damage falls off past 20 m toward the weapon's range.
// Spread blends a weapon's still and moving spread by the shooter's state:
// running opens it up, being airborne triples it, crouching and aiming close
// it down, and the first shot after a trigger rest is nearly true.
// Recoil is a pattern, not a dice roll: each weapon climbs and drifts the same
// way every burst, so a player can learn to pull against it; the pattern
// restarts when the trigger rests.
export const PART_MULT = { head: 4, torso: 1, arm: 0.75, leg: 0.75 };
export const FIRST_SHOT_PAUSE = 0.35; // trigger rest that earns first-shot accuracy
export const PATTERN_RESET = 0.4;     // trigger rest that restarts the recoil pattern

export function damageFor(def, part, dist) {
  const mult = PART_MULT[part] ?? 1;
  const fall = dist <= 20 ? 1 : Math.max(0.55, 1 - ((dist - 20) / def.range) * 0.45);
  return def.damage * mult * fall;
}

// ctx: { speed, airborne, crouching, adsBlend, bloom, firstShot }
export function inaccuracy(def, ctx) {
  const move = Math.min(1, ctx.speed / 5.4);
  let s = def.spreadStill + (def.spreadMove - def.spreadStill) * move + ctx.bloom;
  if (ctx.airborne) s *= 3;
  if (ctx.crouching) s *= 0.7;
  s *= 1 - 0.6 * ctx.adsBlend;
  if (ctx.firstShot) s *= 0.15;
  return s;
}

const PATTERNS = {
  p9: [[1.0, 0.0], [1.0, 0.15], [1.0, -0.15], [1.0, 0.1]],
  vk47: [[1.0, 0.0], [1.05, 0.1], [1.1, 0.25], [1.1, 0.4], [1.05, 0.3],
         [1.0, 0.05], [0.95, -0.3], [0.95, -0.5], [0.9, -0.35], [0.9, -0.1]],
  sc12: [[1.4, 0.0]],
  ls7: [[1.6, 0.0]],
};

// The kick for the shotIndex-th round of a burst, already scaled by the
// weapon's own kick. Past the table the climb holds and the drift sways.
export function recoilFor(def, shotIndex) {
  const table = PATTERNS[def.id] || PATTERNS.vk47;
  const row = table[Math.min(shotIndex, table.length - 1)];
  const sway = shotIndex >= table.length ? Math.sin(shotIndex * 1.7) * 0.3 : 0;
  return { pitch: def.kick * row[0], yaw: def.kick * (row[1] + sway) };
}
