import * as fs from 'node:fs';
import * as path from 'node:path';

/** Files that together identify a directory as an rAthena checkout. */
const MARKERS = ['conf', 'db', 'npc', 'src'];

/** Returns true when `dir` looks like the root of an rAthena server. */
export function isServerRoot(dir: string): boolean {
  return MARKERS.every((marker) => {
    try {
      return fs.statSync(path.join(dir, marker)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Finds the rAthena root for a given starting directory.
 *
 * Walks up from `startDir` — so opening `npc/custom/` inside the server tree
 * works — and then checks the sibling directories of each workspace folder,
 * which covers the common layout of keeping the extension project next to the
 * server checkout.
 */
export function detectServerRoot(startDirs: string[]): string | undefined {
  for (const start of startDirs) {
    const found = walkUp(start);
    if (found) {
      return found;
    }
  }

  for (const start of startDirs) {
    const parent = path.dirname(start);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(parent, entry.name);
      if (isServerRoot(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function walkUp(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isServerRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Expands a leading `~` so users can write `~/rathena` in their settings. */
export function expandHome(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.join(home, inputPath.slice(1));
  }
  return inputPath;
}
