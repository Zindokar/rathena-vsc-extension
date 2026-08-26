/**
 * Works out what *kind* of value each parameter of a command expects.
 *
 * `BUILDIN_DEF` gives us types but not meaning: `getitem` has signature `vi?`,
 * which says the first argument is a value and the second an int, but not that
 * the first is an item ID. That distinction is what makes completion useful.
 *
 * Rather than hand-maintaining a table of several hundred commands, the meaning
 * is derived from the usage lines in `doc/script_commands.txt`, which turn out
 * to use a remarkably consistent placeholder vocabulary:
 *
 *     *getitem <item id>,<amount>{,<account ID>};
 *     *getitem "<item name>",<amount>{,<account ID>};
 *     *monster "<map name>",<x>,<y>,"<name to show>",<mob id>,<amount>{...};
 *     *sc_start <effect type>,<ticks>,<value 1>{,<rate>,<flag>{,<GID>}};
 *
 * `<item id>` appears 49 times, `<map name>` 56, `<amount>` 53. Mapping that
 * vocabulary once covers every command that has documentation, and a command
 * we cannot classify simply falls back to the generic suggestion list.
 */

export type ValueKind =
  | 'item-id'
  | 'item-name'
  | 'mob-id'
  | 'mob-name'
  | 'map-name'
  | 'skill-id'
  | 'skill-name'
  | 'status'
  | 'effect'
  | 'sprite'
  | 'send-target'
  | 'bound-type'
  | 'size'
  | 'ai'
  | 'event-label'
  | 'unknown';

export interface ParamInfo {
  /** The placeholder text as documented, e.g. `item id`. */
  placeholder: string;
  kind: ValueKind;
  /** True when the documented form wraps the placeholder in quotes. */
  quoted: boolean;
}

/** One documented usage line, flattened into positional parameters. */
export type SignatureVariant = ParamInfo[];

/**
 * Placeholder vocabulary. Matched on the normalised (lowercased, punctuation
 * stripped) placeholder text, longest key first so `item id` beats `id`.
 */
const VOCABULARY: [string, ValueKind][] = [
  ['item id', 'item-id'],
  ['itemid', 'item-id'],
  ['item name', 'item-name'],
  ['mob id', 'mob-id'],
  ['monster id', 'mob-id'],
  ['mob name', 'mob-name'],
  ['monster name', 'mob-name'],
  ['map name', 'map-name'],
  ['mapname', 'map-name'],
  ['skill id', 'skill-id'],
  ['skill name', 'skill-name'],
  ['effect type', 'status'],
  ['sc type', 'status'],
  ['status', 'status'],
  ['effect number', 'effect'],
  ['effect id', 'effect'],
  ['sprite id', 'sprite'],
  ['send target', 'send-target'],
  ['send_target', 'send-target'],
  ['bound type', 'bound-type'],
  ['size', 'size'],
  ['ai', 'ai'],
  ['event label', 'event-label'],
  ['npc::onlabel', 'event-label'],
  ['label', 'event-label']
];

/** Constant prefixes offered for the kinds that resolve to script constants. */
export const CONSTANT_PREFIX: Partial<Record<ValueKind, string[]>> = {
  status: ['SC_'],
  effect: ['EF_'],
  'send-target': ['bc_', 'AREA', 'SELF', 'TARGET', 'ALL_'],
  'bound-type': ['Bound_'],
  size: ['Size_'],
  ai: ['AI_']
};

function classify(placeholder: string): ValueKind {
  const normalised = placeholder
    .toLowerCase()
    .replace(/[^a-z0-9:_ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [needle, kind] of VOCABULARY) {
    if (normalised === needle || normalised.includes(needle)) {
      return kind;
    }
  }
  return 'unknown';
}

/**
 * Turns one documented usage line into positional parameters.
 *
 * Optional arguments are written `{,<x>}` and can nest, so the braces are
 * simply stripped: for completion we care about position, not about which
 * arguments are required.
 */
export function parseSignature(signature: string): SignatureVariant {
  // Drop the command name and any leading `(`.
  const withoutName = signature.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*\(?/, '');
  // Strip optional-argument braces, the trailing `;` and the closing paren.
  const body = withoutName.replace(/[{}]/g, '').replace(/[);\s]+$/, '');

  const params: ParamInfo[] = [];
  let depth = 0;
  let current = '';

  const flush = (): void => {
    const text = current.trim();
    current = '';
    if (text === '') {
      return;
    }
    const quoted = /^"/.test(text);
    const match = /<([^>]*)>/.exec(text);
    const placeholder = match ? match[1] : text.replace(/"/g, '');
    params.push({ placeholder, kind: classify(placeholder), quoted });
  };

  for (const ch of body) {
    if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
    }
    if (ch === ',' && depth <= 0) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();

  return params;
}

/**
 * Builds every documented variant for a command.
 *
 * Commands with an ID form and a name form (`getitem <item id>` versus
 * `getitem "<item name>"`) produce two variants, which is exactly what lets us
 * offer AegisNames inside a string and numeric IDs outside one.
 */
export function variantsFor(signatures: string[] | undefined): SignatureVariant[] {
  if (!signatures || signatures.length === 0) {
    return [];
  }
  return signatures.map(parseSignature).filter((variant) => variant.length > 0);
}

/**
 * The kinds acceptable at a given argument position.
 *
 * When the cursor sits inside a string literal the quoted variants are
 * preferred, because that is the form the user has already committed to.
 */
export function kindsAt(
  variants: SignatureVariant[],
  argIndex: number,
  insideString: boolean
): ValueKind[] {
  const matching = variants
    .map((variant) => variant[argIndex])
    .filter((param): param is ParamInfo => param !== undefined);

  if (matching.length === 0) {
    return [];
  }

  const preferred = matching.filter((param) => param.quoted === insideString);
  const chosen = preferred.length > 0 ? preferred : matching;

  const kinds = new Set<ValueKind>();
  for (const param of chosen) {
    if (param.kind !== 'unknown') {
      kinds.add(param.kind);
    }
  }
  return [...kinds];
}

