import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { detectServerRoot, expandHome, isServerRoot } from '../src/data/serverPath.js';

/** Builds a directory tree under a temp root. */
function makeTree(dirs: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rathena-path-'));
  for (const dir of dirs) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('isServerRoot', () => {
  it('requires conf, db, npc and src together', () => {
    const full = makeTree(['server/conf', 'server/db', 'server/npc', 'server/src']);
    roots.push(full);
    expect(isServerRoot(path.join(full, 'server'))).toBe(true);
  });

  it('rejects a partial layout', () => {
    const partial = makeTree(['server/conf', 'server/db']);
    roots.push(partial);
    expect(isServerRoot(path.join(partial, 'server'))).toBe(false);
  });

  it('rejects a missing directory', () => {
    expect(isServerRoot('/does/not/exist')).toBe(false);
  });
});

describe('detectServerRoot', () => {
  it('walks up from a folder inside the server tree', () => {
    const root = makeTree(['rathena/conf', 'rathena/db', 'rathena/npc', 'rathena/src/map']);
    roots.push(root);
    const found = detectServerRoot([path.join(root, 'rathena', 'npc')]);
    expect(found).toBe(path.join(root, 'rathena'));
  });

  it('finds the server as a sibling of the workspace folder', () => {
    // The layout this project itself uses: extension and server side by side.
    const root = makeTree([
      'rathena_ext',
      'rathena/conf',
      'rathena/db',
      'rathena/npc',
      'rathena/src'
    ]);
    roots.push(root);
    const found = detectServerRoot([path.join(root, 'rathena_ext')]);
    expect(found).toBe(path.join(root, 'rathena'));
  });

  it('returns undefined when nothing looks like a server', () => {
    const bare = makeTree(['just/a/folder']);
    roots.push(bare);
    expect(detectServerRoot([path.join(bare, 'just')])).toBeUndefined();
  });
});

describe('expandHome', () => {
  it('expands a leading tilde', () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    expect(expandHome('~/rathena')).toBe(path.join(home, 'rathena'));
  });

  it('leaves absolute paths alone', () => {
    expect(expandHome('/opt/rathena')).toBe('/opt/rathena');
  });
});
