// The one store. Every piece of mutable state that more than one module needs
// lives on this object, created once in main.js and passed by reference to the
// modules that read it. Modules keep private state in their own closures; the
// shared things — the simulation clock, the camera trauma, the run flags, the
// player's flash blindness — are fields here and nowhere else.
export function createState() {
  return {
    now: 0,               // simulation clock in seconds, advanced only by the fixed step
    elapsed: 0,           // total simulated seconds since boot
    started: false,       // the player has deployed at least once
    frozen: false,        // screenshot staging holds the frame still
    trauma: 0,            // camera shake energy, 0..1, decays inside the step
    playerBlindUntil: 0,  // sim time until a flashbang's glare leaves the player
    plantNoiseAt: -100,   // last sim time the planting beep carried on the hearing bus
  };
}
