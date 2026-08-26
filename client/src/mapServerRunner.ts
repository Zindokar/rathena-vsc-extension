/**
 * Runs the real map-server binary and turns its console output into
 * diagnostics.
 *
 * The ported parser in the language server is fast and always available, but it
 * is still a reimplementation. This is the ground truth: the actual binary,
 * loading the actual scripts, printing the actual errors — including the ones
 * that only surface at load time, such as duplicate NPC names across files or a
 * warp pointing at a map that is not in the map cache.
 *
 * `map-server --run-once` loads everything and exits, which is exactly the
 * check we want. It does need a compiled server and a reachable MySQL, so this
 * is an explicit command rather than something that runs on save.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

/**
 * ANSI colour codes rAthena's `ShowError` and friends emit. The control
 * character is written as the `\u001b` escape — an earlier version had a
 * literal ESC byte embedded in the source, invisible in every editor.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * `script error on <file> line <n>` — the header emitted by
 * `script_errorwarning_sub`.
 */
const SCRIPT_ERROR = /script error on (.+?) line (\d+)/;

/** Generic `[Error]:` / `[Warning]:` lines that mention a file and line. */
const FILE_LINE = /([\w./\\-]+\.(?:txt|yml|conf))["']?\s*(?:,|:|\s+line\s+)\s*(\d+)/i;

export interface RunResult {
  exitCode: number | null;
  diagnostics: Map<string, vscode.Diagnostic[]>;
  errorCount: number;
  warningCount: number;
}

export interface RunOptions {
  serverRoot: string;
  binary: string;
  args: string[];
  output: vscode.OutputChannel;
  token: vscode.CancellationToken;
}

/** Resolves the map-server binary, accounting for platform and build layout. */
export function findBinary(serverRoot: string, configured: string): string | undefined {
  if (configured) {
    const explicit = path.isAbsolute(configured) ? configured : path.join(serverRoot, configured);
    return fs.existsSync(explicit) ? explicit : undefined;
  }

  const names =
    process.platform === 'win32'
      ? ['map-server.exe', path.join('vcproj-16', 'Release', 'map-server.exe')]
      : ['map-server'];

  for (const name of names) {
    const candidate = path.join(serverRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function runMapServer(options: RunOptions): Promise<RunResult> {
  const { serverRoot, binary, args, output, token } = options;

  const diagnostics = new Map<string, vscode.Diagnostic[]>();
  let errorCount = 0;
  let warningCount = 0;

  output.appendLine(`$ ${binary} ${args.join(' ')}`);
  output.appendLine(`  (cwd: ${serverRoot})`);
  output.appendLine('');

  return new Promise<RunResult>((resolve) => {
    const child = spawn(binary, args, { cwd: serverRoot });

    token.onCancellationRequested(() => {
      child.kill('SIGTERM');
      output.appendLine('\n-- cancelled --');
    });

    let buffer = '';
    /** Set while consuming the context block that follows a script error. */
    let pendingError: { file: string; line: number; message: string } | null = null;

    const handleLine = (raw: string): void => {
      const line = raw.replace(ANSI, '').trimEnd();
      output.appendLine(line);

      const scriptError = SCRIPT_ERROR.exec(line);
      if (scriptError) {
        // The message is on the following line, indented four spaces.
        pendingError = { file: scriptError[1], line: Number(scriptError[2]), message: '' };
        return;
      }

      if (pendingError && pendingError.message === '' && line.startsWith('    ')) {
        pendingError.message = line.trim();
        addDiagnostic(
          diagnostics,
          serverRoot,
          pendingError.file,
          pendingError.line,
          pendingError.message,
          vscode.DiagnosticSeverity.Error
        );
        errorCount += 1;
        pendingError = null;
        return;
      }

      const isError = line.includes('[Error]');
      const isWarning = line.includes('[Warning]');
      if (!isError && !isWarning) {
        return;
      }

      const match = FILE_LINE.exec(line);
      if (match) {
        addDiagnostic(
          diagnostics,
          serverRoot,
          match[1],
          Number(match[2]),
          line.replace(/^.*?\[(Error|Warning)\]:\s*/, '').trim(),
          isError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
        );
      }
      if (isError) {
        errorCount += 1;
      } else {
        warningCount += 1;
      }
    };

    const consume = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    };

    child.stdout.on('data', consume);
    child.stderr.on('data', consume);

    child.on('error', (error) => {
      output.appendLine(`\nFailed to start the map-server: ${error.message}`);
      resolve({ exitCode: null, diagnostics, errorCount: errorCount + 1, warningCount });
    });

    child.on('close', (code) => {
      if (buffer.length > 0) {
        handleLine(buffer);
      }
      output.appendLine(`\n-- map-server exited with code ${code} --`);
      resolve({ exitCode: code, diagnostics, errorCount, warningCount });
    });
  });
}

function addDiagnostic(
  target: Map<string, vscode.Diagnostic[]>,
  serverRoot: string,
  file: string,
  line: number,
  message: string,
  severity: vscode.DiagnosticSeverity
): void {
  const absolute = path.isAbsolute(file) ? file : path.join(serverRoot, file);
  if (!fs.existsSync(absolute)) {
    return; // a path we cannot map back to a real file is not actionable
  }

  // rAthena counts lines from 1; VS Code from 0.
  const zeroBased = Math.max(0, line - 1);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(zeroBased, 0, zeroBased, Number.MAX_SAFE_INTEGER),
    message,
    severity
  );
  diagnostic.source = 'map-server';

  const existing = target.get(absolute) ?? [];
  existing.push(diagnostic);
  target.set(absolute, existing);
}
