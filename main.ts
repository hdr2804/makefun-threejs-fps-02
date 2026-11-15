// DUSTLINE YARD — entrypoint for make.fun's threejs-fps-02 bounty (Node 22,
// standard library only, no build step).
//
// What this program does, in order:
//   1. resolves the output directory (/output in the grader, or
//      MAKEFUN_OUTPUT_DIR when run by hand: `MAKEFUN_OUTPUT_DIR=out node main.ts`)
//   2. validates the hand-in against the gate's caps before copying anything:
//      every screenshot within its byte cap, the game tree within its file
//      and byte caps — a violation fails here, with the file named
//   3. copies the playable game (game/, static ES modules + vendored three.js
//      0.187.0) and the maker's screenshots (screenshots/, 4 JPEG renders) there
//   4. writes dossier.json with the vendored buildDossier library — the exact
//      bytes the sealed gate rebuilds and compares, so the options below mirror
//      the scorer's own caps from reference/gate.json
//
// The game itself is served statically: `node serve.ts` puts game/ on
// http://localhost:8080 for a human to play in desktop Chrome.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// The sealed gate rejects an oversized screenshot outright, and a hand-in
// that only discovers that at grading time has no recovery. Check every
// shot's bytes here, by name, so a bad capture fails the build instead.
function assertScreenshotSizes(dir, names) {
  for (const name of names) {
    const bytes = statSync(join(dir, name)).size;
    if (bytes > GATE.screenshotMaxBytes) {
      throw new Error(
        `screenshot ${name} is ${bytes} bytes, over the ${GATE.screenshotMaxBytes}-byte cap: recapture it smaller`,
      );
    }
  }
}

// A census of the game tree: file count and total bytes, the two numbers
// the gate caps before it ever opens a file. Vendored three.js dominates
// the bytes; the game's own modules must stay a small slice of the cap.
function gameTreeCensus(dir) {
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  }
  return { files, bytes };
}

function assertGameTreeWithinCaps(dir) {
  const census = gameTreeCensus(dir);
  if (census.files > GATE.gameMaxFiles) {
    throw new Error(`game tree holds ${census.files} files, over the ${GATE.gameMaxFiles}-file cap`);
  }
  if (census.bytes > GATE.gameMaxBytes) {
    throw new Error(`game tree holds ${census.bytes} bytes, over the ${GATE.gameMaxBytes}-byte cap`);
  }
  return census;
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
  assertScreenshotSizes(shotsFrom, shots);
  const census = assertGameTreeWithinCaps(gameFrom);

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

  console.log(`dustline-yard: game (${census.files} files, ${census.bytes} bytes) + ${shots.length} screenshots -> ${outputDir}`);
  console.log(`dustline-yard: dossier.json ${Buffer.byteLength(dossier)} bytes`);
}

main();
