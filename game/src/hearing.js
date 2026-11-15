// The hearing bus: one publish/subscribe channel for every sound loud enough
// to matter. Shooters publish shots, reloads, planting beeps and explosions;
// bots and the team-plan layer subscribe and react, with distance noise, so a
// bot never learns more than its ears could tell it. Events are pooled
// objects — publishing allocates nothing, and subscribers must copy out what
// they keep before the next publish.
const POOL = 24;

export function createHearing() {
  const listeners = [];
  const pool = [];
  for (let i = 0; i < POOL; i += 1) {
    pool.push({ type: '', x: 0, z: 0, team: '', radius: 0, now: 0 });
  }
  let next = 0;
  return {
    subscribe(fn) { listeners.push(fn); },
    publish(type, x, z, team, radius, now) {
      const e = pool[next];
      next = (next + 1) % POOL;
      e.type = type;
      e.x = x;
      e.z = z;
      e.team = team;
      e.radius = radius;
      e.now = now;
      for (const fn of listeners) fn(e);
    },
  };
}
