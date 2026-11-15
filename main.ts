// DUSTLINE YARD — entrypoint for make.fun's threejs-fps-02 bounty (Node 22,
// standard library only, no build step).
//
// What this program does, in order:
//   1. resolves the output directory (/output in the grader, or
//      MAKEFUN_OUTPUT_DIR when run by hand: `MAKEFUN_OUTPUT_DIR=out node main.ts`)
//   2. copies the playable game (game/, static ES modules + vendored three.js
//      0.187.0) and the maker's screenshots (screenshots/, 4 JPEG renders) there
//   3. writes dossier.json with the vendored buildDossier library — the exact
//      bytes the sealed gate rebuilds and compares, so the options below mirror
//      the scorer's own caps from reference/gate.json
//
// The game itself is served statically: `node serve.ts` puts game/ on
// http://localhost:8080 for a human to play in desktop Chrome.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's caps, named once so a reader can check them against the rules
// without hunting through the dossier call.
const GATE = {
  textMaxBytes: 163840, // the judge reads at most 160 KiB of source text
  screenshotMax: 4,
  screenshotMaxBytes: 262144, // 256 KiB a shot
  gameMaxFiles: 993,
  gameMaxBytes: 50331648, // 48 MiB of game files
};

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function screenshotNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith('.'))
    .sort();
}

function main() {
  const gameFrom = join(repoRoot, 'game');
  const shotsFrom = join(repoRoot, 'screenshots');
  if (!existsSync(join(gameFrom, 'index.html'))) {
    throw new Error('game/index.html is missing: nothing to hand in');
  }
  const shots = screenshotNames(shotsFrom);
  if (shots.length < 3 || shots.length > GATE.screenshotMax) {
    throw new Error(`expected 3 or 4 screenshots, found ${shots.length}`);
  }

  mkdirSync(outputDir, { recursive: true });
  // Start from a clean slate so a stale local out/ can never smuggle an old
  // screenshot or a removed game file into the hand-in.
  rmSync(join(outputDir, 'game'), { recursive: true, force: true });
  rmSync(join(outputDir, 'screenshots'), { recursive: true, force: true });
  copyTree(gameFrom, join(outputDir, 'game'));
  copyTree(shotsFrom, join(outputDir, 'screenshots'));

  const dossierOptions = {
    text_max_bytes: GATE.textMaxBytes,
    screenshots: { max: GATE.screenshotMax, max_bytes: GATE.screenshotMaxBytes },
    game_max_files: GATE.gameMaxFiles,
    game_max_bytes: GATE.gameMaxBytes,
  };
  const dossier = buildDossier(outputDir, dossierOptions);
  // The grader runs this program twice and demands identical bytes both times.
  // Rebuild once here and compare byte for byte (buildDossier returns bytes,
  // not a string) and fail loudly rather than hand in a dossier that drifts.
  const rebuilt = buildDossier(outputDir, dossierOptions);
  if (!Buffer.from(rebuilt).equals(Buffer.from(dossier))) {
    throw new Error('dossier is not deterministic: refusing to hand in drifting bytes');
  }
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  console.log(`dustline-yard: game + ${shots.length} screenshots -> ${outputDir}`);
  console.log(`dustline-yard: dossier.json ${Buffer.byteLength(dossier)} bytes`);
}

main();
