/**
 * Regression harness: runs the lexer and the diagnostics over every script in
 * a real rAthena `npc/` tree.
 *
 *   npm run verify -- --server ~/rathena
 *
 * The official scripts are the best test corpus available — roughly 26 MB
 * across 1,100+ files, written over two decades by many hands. The bar is that
 * they produce *no* diagnostics: anything reported here is either a bug in our
 * analysis or a genuine defect upstream. As of rAthena 0c3ca757a there are
 * exactly two, both from one stray parenthesis in `quests_moscovia.txt:9923`.
 *
 * Exits non-zero when the diagnostic count exceeds `--max`, so it can be wired
 * into CI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { quickCheck } from '../server/src/analysis/quickCheck.js';
import { strictCheck } from '../server/src/analysis/strictCheck.js';
import { ServerDatabase } from '../server/src/data/database.js';
import { TokenKind, tokenize } from '../server/src/lexer.js';

function arg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function expandHome(input: string): string {
  return input.startsWith('~')
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', input.slice(1))
    : input;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.txt')) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const serverRoot = path.resolve(expandHome(arg('--server', process.env.RATHENA_PATH ?? '../rathena')));
  const maxDiagnostics = Number(arg('--max', '2'));
  const npcDir = path.join(serverRoot, 'npc');

  if (!fs.existsSync(npcDir)) {
    console.error(`✘ No npc/ directory in ${serverRoot}`);
    process.exit(1);
  }

  const database = new ServerDatabase();
  await database.index({ serverRoot, mode: 'renewal' });
  console.log('Indexed:', JSON.stringify(database.stats));

  const files = walk(npcDir);
  console.log(`\nChecking ${files.length} script files…\n`);

  let totalTokens = 0;
  let unknownTokens = 0;
  let bytes = 0;
  const byCode = new Map<string, number>();
  const samples = new Map<string, string[]>();

  const started = Date.now();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    bytes += text.length;

    const { tokens } = tokenize(text);
    totalTokens += tokens.length;
    for (const token of tokens) {
      if (token.kind === TokenKind.Unknown) {
        unknownTokens += 1;
      }
    }

    const found = [
      ...quickCheck(text, tokens, { checkUnknownCommands: true, database }),
      ...strictCheck(text, database)
    ];

    for (const diagnostic of found) {
      const code = String(diagnostic.code);
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
      const list = samples.get(code) ?? [];
      if (list.length < 5) {
        list.push(
          `${path.relative(serverRoot, file)}:${diagnostic.range.start.line + 1} — ${diagnostic.message.split('\n')[0]}`
        );
        samples.set(code, list);
      }
    }
  }

  const elapsed = Date.now() - started;
  const total = [...byCode.values()].reduce((a, b) => a + b, 0);

  console.log(`${(bytes / 1024 / 1024).toFixed(1)} MB · ${totalTokens.toLocaleString()} tokens · ${elapsed} ms`);
  console.log(`Unclassified characters: ${unknownTokens} (expected: NPC name suffixes such as 'Healer#alb')`);
  console.log(`\nDiagnostics: ${total}`);

  for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`\n  ${code}: ${count}`);
    for (const sample of samples.get(code) ?? []) {
      console.log(`     ${sample}`);
    }
  }

  if (total > maxDiagnostics) {
    console.error(`\n✘ ${total} diagnostics exceeds the allowed maximum of ${maxDiagnostics}.`);
    process.exit(1);
  }
  console.log(`\n✔ Within the allowed maximum of ${maxDiagnostics}.`);
}

void main();
