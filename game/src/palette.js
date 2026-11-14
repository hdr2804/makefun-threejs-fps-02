// DUSTLINE YARD look plan, in one place. A dusk industrial yard: cold slate concrete,
// warm sand, rusted steel, one amber signal accent and one teal team accent. The same
// names are the CSS custom properties in index.html, so HUD and 3D scene agree.
export const PALETTE = {
  canvas: '#191c22',
  sky: '#2a2f3a',
  surface: '#3a3f47',
  concrete: '#565c66',
  sand: '#b98d4f',
  rust: '#a4552c',
  steel: '#7d838d',
  ink: '#ece7db',
  muted: '#9aa0a8',
  amber: '#f0a830',
  teal: '#3fae9c',
  enemy: '#c4552d',
};

export function hex(name) {
  return PALETTE[name];
}
