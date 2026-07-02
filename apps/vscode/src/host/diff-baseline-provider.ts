import * as vscode from 'vscode';

/**
 * Backs the left (read-only) side of the changes panel's native diff editor.
 *
 * VSCode's `vscode.diff` command needs two URIs. The right side is the real file
 * on disk, but the left side is the pre-session baseline the webview holds in
 * memory — there's no file for it. This {@link vscode.TextDocumentContentProvider}
 * serves that baseline text under a custom read-only scheme, keyed by the diff's
 * path. Register it once per view; call {@link setBaseline} before opening a
 * diff so the content is available when VSCode resolves the left URI.
 */
export class DiffBaselineProvider
  implements vscode.TextDocumentContentProvider
{
  /** Custom URI scheme the baseline side is served under. */
  public static readonly scheme = 'justcode-baseline';

  private readonly baselines = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  /** Fired so VSCode re-reads a baseline URI whose content changed. */
  public readonly onDidChange = this.changeEmitter.event;

  /** Builds the read-only baseline URI for a workspace-relative path. */
  public static uriFor(path: string): vscode.Uri {
    // Encode the path in the URI path so distinct files get distinct documents
    // (and the diff tab is labelled with the file name).
    return vscode.Uri.from({ scheme: DiffBaselineProvider.scheme, path });
  }

  /** Records the baseline text to serve for a path, then notifies VSCode. */
  public setBaseline(path: string, text: string): void {
    this.baselines.set(path, text);
    this.changeEmitter.fire(DiffBaselineProvider.uriFor(path));
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.baselines.get(uri.path) ?? '';
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.baselines.clear();
  }
}
