import * as path from 'node:path';

import * as vscode from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions
} from 'vscode-languageclient/node';

import { browseAndInsert, clearBrowseCache, type BrowseKind } from './browsers.js';
import { findBinary, runMapServer } from './mapServerRunner.js';

let client: LanguageClient | undefined;
let mapServerOutput: vscode.OutputChannel | undefined;
let mapServerDiagnostics: vscode.DiagnosticCollection | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      // Matches the "Attach to Language Server" launch configuration.
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'rathena-script' },
      { scheme: 'file', language: 'rathena-conf' },
      { scheme: 'file', language: 'yaml', pattern: '**/db/**/*.yml' }
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/db/**/*.yml')
    },
    initializationOptions: {
      // The server cannot read VS Code settings directly during startup.
      serverPath: vscode.workspace.getConfiguration('rathena').get<string>('serverPath', ''),
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
    },
    outputChannel: vscode.window.createOutputChannel('rAthena Language Server')
  };

  client = new LanguageClient('rathena', 'rAthena Language Server', serverOptions, clientOptions);

  context.subscriptions.push(
    vscode.commands.registerCommand('rathena.restartServer', async () => {
      await client?.restart();
      void vscode.window.showInformationMessage('rAthena language server restarted.');
    }),
    vscode.commands.registerCommand('rathena.reindexDatabase', async () => {
      await client?.sendRequest('rathena/reindex');
      clearBrowseCache();
      void vscode.window.showInformationMessage('rAthena database re-indexed.');
    }),
    ...(['item', 'mob', 'skill', 'sprite', 'map'] as BrowseKind[]).map((kind) =>
      vscode.commands.registerCommand(`rathena.insert.${kind}`, () => browseAndInsert(client, kind))
    ),
    vscode.commands.registerCommand('rathena.showServerPath', async () => {
      const detected = await client?.sendRequest<string | null>('rathena/serverPath');
      void vscode.window.showInformationMessage(
        detected ? `rAthena server detected at: ${detected}` : 'No rAthena server folder detected.'
      );
    }),
    vscode.commands.registerCommand('rathena.strictCheck', () => strictCheckCommand()),
    vscode.commands.registerCommand('rathena.runMapServerCheck', () => runMapServerCommand())
  );

  await client.start();
}

interface StrictCheckResponse {
  errors: number;
  reports: string[];
  first?: string;
  line: number | null;
  character: number | null;
}

/**
 * Runs the ported parser on the active file and, when it finds something,
 * prints the full rAthena-style report and offers to jump to the line.
 */
async function strictCheckCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Open an rAthena script first.');
    return;
  }

  const result = await client?.sendRequest<StrictCheckResponse>('rathena/strictCheck', {
    uri: editor.document.uri.toString()
  });

  if (!result || result.errors === 0) {
    void vscode.window.showInformationMessage('The map-server would load this file without complaint.');
    return;
  }

  const channel = getOutputChannel();
  channel.clear();
  channel.appendLine(`Checking ${vscode.workspace.asRelativePath(editor.document.uri)}\n`);
  for (const report of result.reports) {
    channel.appendLine(report);
    channel.appendLine('');
  }
  channel.appendLine(`${result.errors} script(s) would fail to load.`);

  const relative = vscode.workspace.asRelativePath(editor.document.uri);
  const lineLabel = result.line !== null ? ` (line ${result.line + 1})` : '';
  const choice = await vscode.window.showErrorMessage(
    `${relative}${lineLabel}: ${result.first}`,
    'Go to error',
    'Show details'
  );

  if (choice === 'Go to error' && result.line !== null) {
    const position = new vscode.Position(result.line, result.character ?? 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } else if (choice === 'Show details') {
    channel.show(true);
  }
}

/**
 * Runs the real binary. Slower and needs a built server plus a database, but it
 * is the only thing that can catch load-time problems a parser cannot see.
 */
async function runMapServerCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('rathena');
  const detected = await client?.sendRequest<string | null>('rathena/serverPath');
  const serverRoot = detected ?? config.get<string>('serverPath', '');

  if (!serverRoot) {
    void vscode.window.showErrorMessage(
      'No rAthena server folder found. Set "rathena.serverPath" first.'
    );
    return;
  }

  const binary = findBinary(serverRoot, config.get<string>('mapServer.binary', ''));
  if (!binary) {
    const choice = await vscode.window.showErrorMessage(
      'No map-server binary found. Build it with `./configure && make sql` in your rAthena folder, or set "rathena.mapServer.binary".',
      'Open settings'
    );
    if (choice === 'Open settings') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'rathena.mapServer');
    }
    return;
  }

  const args = config.get<string[]>('mapServer.args', ['--run-once']);
  const channel = getOutputChannel();
  channel.clear();
  channel.show(true);

  const collection = getDiagnosticCollection();
  collection.clear();

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Loading scripts with the real map-server…',
      cancellable: true
    },
    (_progress, token) => runMapServer({ serverRoot, binary, args, output: channel, token })
  );

  for (const [file, diagnostics] of result.diagnostics) {
    collection.set(vscode.Uri.file(file), diagnostics);
  }

  if (result.errorCount === 0) {
    void vscode.window.showInformationMessage(
      `The map-server loaded every script${result.warningCount > 0 ? `, with ${result.warningCount} warning(s)` : ' cleanly'}.`
    );
    return;
  }

  const choice = await vscode.window.showErrorMessage(
    `The map-server reported ${result.errorCount} error(s) and ${result.warningCount} warning(s).`,
    'Show output',
    'Show problems'
  );
  if (choice === 'Show output') {
    channel.show(true);
  } else if (choice === 'Show problems') {
    void vscode.commands.executeCommand('workbench.actions.view.problems');
  }
}

function getOutputChannel(): vscode.OutputChannel {
  mapServerOutput ??= vscode.window.createOutputChannel('rAthena Script Check');
  return mapServerOutput;
}

function getDiagnosticCollection(): vscode.DiagnosticCollection {
  mapServerDiagnostics ??= vscode.languages.createDiagnosticCollection('rathena-map-server');
  return mapServerDiagnostics;
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
  mapServerOutput?.dispose();
  mapServerDiagnostics?.dispose();
}
