// DUSTLINE YARD — a three.js tactical FPS for make.fun threejs-fps-02.
// Node 22, standard library only. The entrypoint copies game/ and screenshots/ from
// beside this file to /output and writes /output/dossier.json with the vendored
// make.fun library, exactly as the kit's contract requires.
//
// Serve the game locally with `node serve.ts` (or any static server over game/),
// then open http://localhost:8080. Outside the grader's container,
// MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Fail fast on the one thing a human forgets: the gate wants 3 or 4 screenshots,
// and a run with an empty screenshots/ folder would otherwise write a dossier the
// scorer refuses. The check below mirrors the scorer's own count, nothing more.
const shots = readdirSync(join(out, 'screenshots')).filter((name) => !name.startsWith('.'));
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`screenshots/ holds ${shots.length} images, the gate wants 3 or 4`);
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, in all: game/
// counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
// buildDossier is deterministic over the same input files, so the grader's two runs
// of this program write the same bytes.
const DOSSIER_OPTIONS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_OPTIONS));
