/**
 * Port of `script_errorwarning_sub` from `src/map/script.cpp`.
 *
 * When the map-server rejects a script it does not just print a message — it
 * prints the file and line, then five lines of context on either side, with the
 * offending character wrapped in single quotes and its line marked with a `*`:
 *
 * ```
 * script error on npc/custom/test.txt line 12
 *     parse_line: expected ';'
 *      7 : mes "[Test]";
 *      8 : next;
 *      9 :
 *     10 : .@a = 1
 * *   11 : 'e'nd;
 *     12 : }
 * ```
 *
 * Reproducing that exactly is the difference between a diagnostic that says
 * something went wrong and one that shows you what. `script_print_line` uses
 * `"*% 5d : "` for the offending line and `" % 5d : "` for the rest, which is
 * where the column alignment comes from.
 */

export interface ReportInput {
  /** Full text of the script source. */
  source: string;
  /** Path shown in the header, as the user would recognise it. */
  file: string;
  /** Absolute offset of the offending character. */
  offset: number;
  /** The message rAthena would print. */
  message: string;
}

export interface Report {
  /** Zero-based line of the error, for LSP ranges. */
  line: number;
  /** Zero-based character offset within that line. */
  character: number;
  /** The whole block, formatted the way the map-server prints it. */
  text: string;
}

const CONTEXT_LINES = 5;

export function formatRathenaError({ source, file, offset, message }: ReportInput): Report {
  const lines = source.split('\n');

  // Locate the line containing `offset`.
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = lineStart + lines[i].length;
    if (offset <= lineEnd) {
      line = i;
      break;
    }
    lineStart = lineEnd + 1; // past the newline
    line = i + 1;
  }
  const character = Math.max(0, offset - lineStart);

  const out: string[] = [];
  // rAthena counts lines from 1.
  out.push(`script error on ${file} line ${line + 1}`);
  out.push(`    ${message}`);

  for (let i = Math.max(0, line - CONTEXT_LINES); i < line; i += 1) {
    out.push(`${pad(i + 1)} : ${lines[i]}`);
  }

  out.push(`*${pad(line + 1).slice(1)} : ${markCharacter(lines[line] ?? '', character)}`);

  for (let i = line + 1; i <= Math.min(lines.length - 1, line + CONTEXT_LINES); i += 1) {
    out.push(`${pad(i + 1)} : ${lines[i]}`);
  }

  return { line, character, text: out.join('\n') };
}

/** `" % 5d"` — a leading space then the number right-aligned in five columns. */
function pad(n: number): string {
  return ` ${String(n).padStart(5, ' ')}`;
}

/** Wraps the offending character in single quotes, as `script_print_line` does. */
function markCharacter(lineText: string, character: number): string {
  if (character >= lineText.length) {
    return `${lineText}'<end of line>'`;
  }
  return `${lineText.slice(0, character)}'${lineText[character]}'${lineText.slice(character + 1)}`;
}
