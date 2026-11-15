// DUSTLINE YARD look plan, in one place. A golden-hour industrial yard: cold slate
// concrete against warm sand and rust, a low orange sunset, sodium floodlamps, one
// amber signal accent and one teal team accent. The same names are the CSS custom
// properties in index.html, so HUD and 3D scene always agree.
export const PALETTE = {
  canvas: '#14161c',
  sky: '#4a4356',
  horizon: '#c96f35',
  sunset: '#ff8a3d',
  surface: '#33373f',
  concrete: '#62686f',
  asphalt: '#2c2f36',
  sand: '#c99a58',
  rust: '#b35a30',
  steel: '#8b939e',
  ink: '#f2ecdf',
  muted: '#a7adb6',
  amber: '#ffb02e',
  lamp: '#ffd98a',
  teal: '#35c4ab',
  enemy: '#e05226',
  allydark: '#1f6f63',
  crateblue: '#3e6d8e',
  cratered: '#8e3b34',
  grass: '#5c6e3c',
};

export function hex(name) {
  return PALETTE[name];
}
