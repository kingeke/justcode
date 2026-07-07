import * as vscode from 'vscode';

import { APP_NAME, APP_ISSUES_URL, APP_REPO_URL } from '@core/branding';
import { APP_VERSION } from '@core/version';
import { cacheDirectory } from '@core/application/cache-dir';
import {
  ASK_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '@core/application/system-prompt';
import { DEFAULT_COMPACT_PROMPT } from '@core/application/compact-prompt';
import { SUB_AGENT_CONFIGS, SubAgentType } from '@core/domain/sub-agent';
import {
  BUILD_MODE_ID,
  BUILT_IN_MODES,
  addCustomMode,
  removeCustomMode,
} from '@core/domain/chat-mode';
import {
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalConfig,
} from '@runtime/persistence/global-config';

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  SettingsHostMessageType,
  SettingsWebviewMessageType,
  type SettingsAppInfo,
  type SettingsHostToWebview,
  type SettingsMcpServerStatus,
  type SettingsPromptInfo,
  type SettingsWebviewToHost,
} from '@ext/shared/settings-protocol';
import type { SettingsSection } from '@ext/shared/protocol';
import {
  addCustomProvider,
  disconnectProvider,
  listProviders,
  oauthConnectProvider,
  testAndConnectProvider,
} from '@ext/host/provider-settings';
import { resetAppState } from '@runtime/persistence/reset-app-state';
import { ensureMcpConfigFile } from '@runtime/mcp/mcp-config';
import {
  discoverSkills,
  installSkill,
  localSkillsDirectory,
  removeSkill,
  skillsDirectory,
  updateSkill,
} from '@runtime/skills/skill-store';

const APP_INFO: SettingsAppInfo = {
  name: APP_NAME,
  version: APP_VERSION,
  description:
    'A lean, transparent coding assistant — bring your own provider, control every token.',
  repository: APP_REPO_URL,
  issues: APP_ISSUES_URL,
};

/**
 * Owns the Settings editor tab: a single webview panel (not a sidebar view)
 * with its own tab nav (Providers, About). It is created lazily on first open
 * and revealed thereafter, so only one Settings tab ever exists.
 */
export class SettingsPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** Aborts the in-progress OAuth sign-in, if any. */
  private oauthAbort: AbortController | undefined;
  /** Resolves the OAuth flow's pending promptInput() with the user's reply. */
  private oauthInputResolve: ((value: string) => void) | undefined;
  /** A section to focus once the webview has loaded (e.g. opened for MCP). */
  private pendingSection: SettingsSection | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    /** Opens the connect flow (terminal); used for OAuth-only providers. */
    private readonly onConnectProvider: () => void,
    /** Notifies the host that the provider set changed (connect/disconnect). */
    private readonly onProvidersChanged: () => void,
    /**
     * Persists+reconnects MCP servers after the user saves `mcp.json`, returning
     * each server's load outcome. Injected by the view provider so the panel can
     * stay decoupled from the live chat session. Returns undefined when no chat
     * session is open to reload (the file is still saved either way).
     */
    private readonly onMcpChanged: () => Promise<
      SettingsMcpServerStatus[] | undefined
    >,
    /**
     * Notifies the host that a system prompt changed, so the live chat session
     * re-reads the mode prompts from config and re-applies the active one.
     */
    private readonly onPromptsChanged: () => void,
    /**
     * Notifies the host that the installed skills changed (add/update/remove),
     * so the live chat session re-discovers them and refreshes the composer's
     * `/` completions without a panel reload.
     */
    private readonly onSkillsChanged: () => void
  ) {}

  /**
   * Creates the Settings tab if needed, then brings it to the foreground.
   * An optional section focuses a specific tab (e.g. `'mcp'` or `'providers'`)
   * once loaded.
   */
  public reveal(section?: SettingsSection): void {
    this.pendingSection = section;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      // Already loaded: the webview won't re-send Init, so focus it now.
      if (section)
        this.post({ type: SettingsHostMessageType.FocusSection, section });
      return;
    }

    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'justcode.settings',
      `${APP_NAME} Settings`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaUri],
      }
    );
    panel.iconPath = vscode.Uri.joinPath(mediaUri, 'emblem.svg');
    this.panel = panel;

    panel.webview.onDidReceiveMessage((message: SettingsWebviewToHost) => {
      void this.handle(message);
    });

    // The terminal connect flow finishes out-of-band; re-send providers each
    // time the tab regains focus so a freshly connected provider shows up.
    panel.onDidChangeViewState(() => {
      if (panel.visible) void this.sendProviders();
    });

    panel.onDidDispose(() => {
      // Closing the tab orphans any running sign-in (its prompts/status have
      // nowhere to go), so abort it.
      this.oauthAbort?.abort();
      this.oauthAbort = undefined;
      this.oauthInputResolve = undefined;
      if (this.panel === panel) this.panel = undefined;
    });

    panel.webview.html = this.renderHtml(panel.webview, mediaUri);
  }

  public dispose(): void {
    this.oauthAbort?.abort();
    this.oauthAbort = undefined;
    this.oauthInputResolve = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async handle(message: SettingsWebviewToHost): Promise<void> {
    switch (message.type) {
      case SettingsWebviewMessageType.Init:
        this.post({
          type: SettingsHostMessageType.Snapshot,
          appInfo: APP_INFO,
          providers: await listProviders(cacheDirectory()),
        });
        // If the tab was opened to a specific section (e.g. the chat's
        // "Configure MCP servers" link), focus it now that the UI is ready.
        if (this.pendingSection) {
          this.post({
            type: SettingsHostMessageType.FocusSection,
            section: this.pendingSection,
          });
          this.pendingSection = undefined;
        }
        return;
      case SettingsWebviewMessageType.ListProviders:
        await this.sendProviders();
        return;
      case SettingsWebviewMessageType.ConnectProvider:
        this.onConnectProvider();
        return;
      case SettingsWebviewMessageType.TestConnectProvider: {
        const result = await testAndConnectProvider(
          cacheDirectory(),
          message.providerId,
          message.apiKey,
          message.baseUrl,
          message.executablePath,
          message.configDir
        );
        this.post({
          type: SettingsHostMessageType.ConnectResult,
          ...result,
        });
        if (result.success) {
          this.onProvidersChanged();
          await this.sendProviders();
        }
        return;
      }
      case SettingsWebviewMessageType.OAuthConnectProvider:
        await this.runOAuthConnect(message.providerId);
        return;
      case SettingsWebviewMessageType.OAuthInput:
        this.oauthInputResolve?.(message.value);
        this.oauthInputResolve = undefined;
        return;
      case SettingsWebviewMessageType.CancelOAuth:
        this.oauthAbort?.abort();
        return;
      case SettingsWebviewMessageType.DisconnectProvider: {
        const removed = await disconnectProvider(
          cacheDirectory(),
          message.providerId
        );
        if (removed) this.onProvidersChanged();
        await this.sendProviders();
        return;
      }
      case SettingsWebviewMessageType.ResetApp: {
        await resetAppState(cacheDirectory());
        this.onProvidersChanged();
        await this.sendProviders();
        // Reset wiped mcp.json — push the fresh (empty) config so the editor
        // stops showing the old servers, and reconnect so their live tools drop.
        await this.sendMcpConfig();
        // Reset also rewrote the prompts; refresh the System Prompts tab.
        await this.sendPrompts();
        try {
          await this.onMcpChanged();
        } catch {
          // Reconnect failure shouldn't block the reset; the file is cleared.
        }
        return;
      }
      case SettingsWebviewMessageType.AddCustomProvider: {
        const result = await addCustomProvider(
          cacheDirectory(),
          message.name,
          message.apiKey,
          message.baseUrl
        );
        this.post({ type: SettingsHostMessageType.ConnectResult, ...result });
        if (result.success) {
          this.onProvidersChanged();
          await this.sendProviders();
        }
        return;
      }
      case SettingsWebviewMessageType.GetMcpConfig:
        await this.sendMcpConfig();
        return;
      case SettingsWebviewMessageType.SaveMcpConfig:
        await this.saveMcpConfig(message.content);
        return;
      case SettingsWebviewMessageType.GetPrompts:
        await this.sendPrompts();
        return;
      case SettingsWebviewMessageType.SavePrompt:
        await this.savePrompt(message.modeId, message.prompt);
        return;
      case SettingsWebviewMessageType.CreateMode:
        await this.createMode(message.name, message.prompt);
        return;
      case SettingsWebviewMessageType.DeleteMode:
        await this.deleteMode(message.modeId);
        return;
      case SettingsWebviewMessageType.OpenConfigFile:
        await this.openConfigFile();
        return;
      case SettingsWebviewMessageType.GetSkills:
        await this.sendSkills();
        return;
      case SettingsWebviewMessageType.AddSkill:
        await this.runSkillAction('add', () =>
          this.addSkill(message.source, message.scope)
        );
        return;
      case SettingsWebviewMessageType.UpdateSkill:
        await this.runSkillAction('update', async () => {
          const updated = await updateSkill(
            message.name,
            this.skillsDirFor(message.scope)
          );
          return `Updated ${updated.manifest.name} to v${updated.manifest.version}.`;
        });
        return;
      case SettingsWebviewMessageType.RemoveSkill:
        await this.runSkillAction('remove', async () => {
          await removeSkill(message.name, this.skillsDirFor(message.scope));
          return `Removed ${message.name}.`;
        });
        return;
    }
  }

  /** The first workspace folder, which local skill installs anchor to. */
  private workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** The on-disk skills directory for a scope. Throws for local w/o workspace. */
  private skillsDirFor(scope: 'local' | 'global'): string {
    if (scope === 'local') {
      const root = this.workspaceRoot();
      if (!root) {
        throw new Error('Open a workspace folder to manage local skills.');
      }
      return localSkillsDirectory(root);
    }
    return skillsDirectory(cacheDirectory());
  }

  /** Sends the installed skills of both scopes to the Skills tab. */
  private async sendSkills(): Promise<void> {
    const root = this.workspaceRoot();
    const local = root
      ? await discoverSkills(localSkillsDirectory(root), 'local')
      : { skills: [], errors: [] };
    const global = await discoverSkills(
      skillsDirectory(cacheDirectory()),
      'global'
    );
    this.post({
      type: SettingsHostMessageType.Skills,
      skills: [...local.skills, ...global.skills].map((skill) => ({
        name: skill.manifest.name,
        version: skill.manifest.version,
        description: skill.manifest.description,
        author: skill.manifest.author,
        source: skill.source,
        scope: skill.scope ?? 'global',
        commands: skill.commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint,
        })),
        errors: skill.errors,
      })),
      errors: [...local.errors, ...global.errors],
      workspaceOpen: root !== undefined,
    });
  }

  private async addSkill(
    source: string,
    scope: 'local' | 'global'
  ): Promise<string> {
    const installed = await installSkill(source, this.skillsDirFor(scope));
    const commandNames = installed.commands
      .map((command) => `/${command.name}`)
      .join(', ');
    return `Installed ${installed.manifest.name} v${installed.manifest.version} (${scope}) — ${commandNames}`;
  }

  /**
   * Runs a skill action, reports its outcome, re-sends the fresh list, and
   * tells the live chat session to refresh its `/` completions.
   */
  private async runSkillAction(
    action: 'add' | 'update' | 'remove',
    run: () => Promise<string>
  ): Promise<void> {
    try {
      const message = await run();
      this.post({
        type: SettingsHostMessageType.SkillActionResult,
        action,
        success: true,
        message,
      });
      this.onSkillsChanged();
    } catch (error) {
      this.post({
        type: SettingsHostMessageType.SkillActionResult,
        action,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await this.sendSkills();
  }

  /** Reads config and sends every mode's (effective) system prompt. */
  private async sendPrompts(): Promise<void> {
    const config = await readGlobalConfig(cacheDirectory());
    this.post({
      type: SettingsHostMessageType.Prompts,
      prompts: listPromptInfos(config),
    });
  }

  /**
   * Persists a mode's system prompt. A built-in's prompt is stored as a config
   * override — cleared again when saved empty or identical to the built-in
   * default, so config only carries real customizations. A custom mode keeps
   * the prompt on its own entry; empty means "fall back to the Build prompt".
   */
  private async savePrompt(modeId: string, prompt: string): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const trimmed = prompt.trim();

    const builtIn = BUILT_IN_PROMPTS[modeId];
    if (builtIn) {
      const override =
        trimmed && trimmed !== builtIn.default ? trimmed : undefined;
      const next = { ...config };
      if (override) next[builtIn.configKey] = override;
      else delete next[builtIn.configKey];
      await writeGlobalConfig(configDir, next);
    } else {
      const existing = config.customModes?.[modeId];
      if (!existing) {
        this.post({
          type: SettingsHostMessageType.PromptSaveResult,
          modeId,
          success: false,
          error: 'This mode no longer exists.',
        });
        return;
      }
      await writeGlobalConfig(configDir, {
        ...config,
        customModes: {
          ...config.customModes,
          [modeId]: {
            name: existing.name,
            ...(trimmed ? { systemPrompt: trimmed } : {}),
          },
        },
      });
    }

    // Let the live chat session pick the change up for its next turn.
    this.onPromptsChanged();
    this.post({
      type: SettingsHostMessageType.PromptSaveResult,
      modeId,
      success: true,
    });
    await this.sendPrompts();
  }

  /**
   * Creates a new custom mode (name + optional prompt) from the System Prompts
   * tab, mirroring the chat mode picker's create flow. The mode appears in the
   * chat picker immediately via onPromptsChanged, but is not made active — the
   * user is editing settings, not switching modes.
   */
  private async createMode(name: string, prompt: string): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const created = addCustomMode(name, prompt, config.customModes ?? {});
    if (!created) {
      this.post({
        type: SettingsHostMessageType.PromptSaveResult,
        modeId: '',
        success: false,
        error: 'A mode name is required.',
      });
      return;
    }
    await writeGlobalConfig(configDir, {
      ...config,
      customModes: created.customModes,
    });
    this.onPromptsChanged();
    this.post({
      type: SettingsHostMessageType.PromptSaveResult,
      modeId: created.id,
      success: true,
    });
    await this.sendPrompts();
  }

  /**
   * Deletes a custom mode from the System Prompts tab. Built-ins are refused by
   * `removeCustomMode`. When the deleted mode was the active one, the active
   * mode falls back to Build so the chat never sits on a mode that no longer
   * exists.
   */
  private async deleteMode(modeId: string): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const removed = removeCustomMode(modeId, config.customModes ?? {});
    if (!removed) {
      this.post({
        type: SettingsHostMessageType.PromptSaveResult,
        modeId,
        success: false,
        error: 'Only custom modes can be deleted.',
      });
      return;
    }
    await writeGlobalConfig(configDir, {
      ...config,
      customModes: removed.customModes,
      ...(config.mode === modeId ? { mode: BUILD_MODE_ID } : {}),
    });
    this.onPromptsChanged();
    this.post({
      type: SettingsHostMessageType.PromptSaveResult,
      modeId,
      success: true,
    });
    await this.sendPrompts();
  }

  /**
   * Opens the raw `config.json` in a VS Code editor tab, seeding the file first
   * if it doesn't exist yet so the editor doesn't open on a missing path.
   */
  private async openConfigFile(): Promise<void> {
    const configDir = cacheDirectory();
    const path = join(configDir, 'config.json');
    if (!existsSync(path)) {
      await writeGlobalConfig(configDir, await readGlobalConfig(configDir));
    }
    await vscode.window.showTextDocument(vscode.Uri.file(path), {
      preview: false,
    });
  }

  /** Reads `mcp.json` (seeding an empty template if absent) and sends its text. */
  private async sendMcpConfig(): Promise<void> {
    const path = await ensureMcpConfigFile(cacheDirectory());
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      content = '{\n  "mcpServers": {}\n}\n';
    }
    this.post({ type: SettingsHostMessageType.McpConfig, content });
  }

  /**
   * Validates and writes new `mcp.json` text, then reconnects MCP servers so
   * their tools appear immediately. Rejects malformed JSON without writing, so a
   * typo can't wipe a working config or leave servers half-loaded.
   */
  private async saveMcpConfig(content: string): Promise<void> {
    // Clearing the editor means "no servers" rather than an error — fall back to
    // an empty config instead of complaining about empty/blank input.
    const toSave = content.trim() ? content : '{\n  "mcpServers": {}\n}\n';

    const validationError = validateMcpJson(toSave);
    if (validationError) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: false,
        error: validationError,
      });
      return;
    }

    try {
      const path = await ensureMcpConfigFile(cacheDirectory());
      await writeFile(path, toSave, 'utf8');
    } catch (error) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: false,
        error: `Couldn't save mcp.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    // Re-sync the editor to exactly what was written (e.g. a cleared editor
    // becomes the empty template), so the textarea and "unsaved" hint match disk.
    this.post({ type: SettingsHostMessageType.McpConfig, content: toSave });

    // Reconnect against the new config; the chat view (if open) reloads its tool
    // list as part of this. A failure to reconnect doesn't unsave the file.
    let servers: SettingsMcpServerStatus[] | undefined;
    try {
      servers = await this.onMcpChanged();
    } catch (error) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: true,
        error: `Saved, but reconnecting failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    this.post({
      type: SettingsHostMessageType.McpSaveResult,
      success: true,
      ...(servers ? { servers } : {}),
    });
  }

  /**
   * Drives a provider's OAuth sign-in to completion inside the extension. The
   * runtime flow opens the browser (via {@link vscode.env.openExternal}) and
   * captures the redirect or device code itself; we relay its status lines and
   * any "paste this value" prompts to the webview and feed the user's reply
   * back. Only one sign-in runs at a time — a new request aborts the previous.
   */
  private async runOAuthConnect(providerId: string): Promise<void> {
    this.oauthAbort?.abort();
    const abort = new AbortController();
    this.oauthAbort = abort;
    this.oauthInputResolve = undefined;

    const result = await oauthConnectProvider(cacheDirectory(), providerId, {
      openUrl: (url) =>
        Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
      notify: (message) =>
        this.post({ type: SettingsHostMessageType.OAuthStatus, message }),
      promptInput: (label) =>
        new Promise<string>((resolve) => {
          this.oauthInputResolve = resolve;
          this.post({ type: SettingsHostMessageType.OAuthPrompt, label });
        }),
      signal: abort.signal,
    });

    if (this.oauthAbort === abort) {
      this.oauthAbort = undefined;
      this.oauthInputResolve = undefined;
    }

    this.post({ type: SettingsHostMessageType.OAuthResult, ...result });
    if (result.success) {
      this.onProvidersChanged();
      await this.sendProviders();
    }
  }

  private async sendProviders(): Promise<void> {
    this.post({
      type: SettingsHostMessageType.ProvidersUpdate,
      providers: await listProviders(cacheDirectory()),
    });
  }

  private post(message: SettingsHostToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.css')
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'emblem.svg')
    );
    const nonce = createNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>${APP_NAME} Settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.JUSTCODE_VIEW = 'settings';
      window.JUSTCODE_LOGO_URI = ${JSON.stringify(logoUri.toString())};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

/**
 * Each built-in prompt's default text and its config override key: the three
 * mode prompts plus the (non-mode) compaction prompt, which rides the same
 * save/reset machinery.
 */
const BUILT_IN_PROMPTS: Record<
  string,
  {
    default: string;
    configKey:
      | 'systemPrompt'
      | 'askSystemPrompt'
      | 'planSystemPrompt'
      | 'compactPrompt'
      | 'explorerSubAgentPrompt'
      | 'generalSubAgentPrompt';
  }
> = {
  build: { default: DEFAULT_SYSTEM_PROMPT, configKey: 'systemPrompt' },
  ask: { default: ASK_SYSTEM_PROMPT, configKey: 'askSystemPrompt' },
  plan: { default: PLAN_SYSTEM_PROMPT, configKey: 'planSystemPrompt' },
  compact: { default: DEFAULT_COMPACT_PROMPT, configKey: 'compactPrompt' },
  'subagent-explorer': {
    default: SUB_AGENT_CONFIGS[SubAgentType.Explorer].systemPrompt,
    configKey: 'explorerSubAgentPrompt',
  },
  'subagent-general': {
    default: SUB_AGENT_CONFIGS[SubAgentType.General].systemPrompt,
    configKey: 'generalSubAgentPrompt',
  },
};

/**
 * Flattens config into the prompt list the System Prompts tab renders:
 * built-ins first (their override, or the built-in default), then the user's
 * custom modes (whose prompt may be empty = "uses the Build prompt").
 */
function listPromptInfos(config: GlobalConfig): SettingsPromptInfo[] {
  const builtIns = BUILT_IN_MODES.map((mode) => {
    const entry = BUILT_IN_PROMPTS[mode.id];
    const override = entry ? config[entry.configKey] : undefined;
    return {
      id: mode.id,
      name: mode.name,
      custom: false,
      prompt: override ?? entry?.default ?? '',
      // A stored prompt identical to the built-in default doesn't count as a
      // customization — resetAppState seeds config with the defaults spelled
      // out, and that must not read as "overridden".
      overridden: override !== undefined && override !== entry?.default,
    };
  });
  // The compaction prompt isn't a chat mode, but it's edited (and reset) the
  // same way, so it rides along after the built-in modes.
  const compactEntry = BUILT_IN_PROMPTS['compact'];
  const compactOverride = config.compactPrompt;
  const compact = compactEntry
    ? [
        {
          id: 'compact',
          name: 'Compaction',
          custom: false,
          prompt: compactOverride ?? compactEntry.default,
          overridden:
            compactOverride !== undefined &&
            compactOverride !== compactEntry.default,
        },
      ]
    : [];
  // Sub agent prompts aren't chat modes either, but they're editable (and
  // reset) the same way, so they ride along after Compaction.
  const subAgents = (
    [
      ['subagent-explorer', 'Explorer sub agent'],
      ['subagent-general', 'General sub agent'],
    ] as const
  ).flatMap(([id, name]) => {
    const entry = BUILT_IN_PROMPTS[id];
    if (!entry) return [];
    const override = config[entry.configKey];
    return [
      {
        id,
        name,
        custom: false,
        prompt: override ?? entry.default,
        overridden: override !== undefined && override !== entry.default,
      },
    ];
  });
  const custom = Object.entries(config.customModes ?? {}).map(
    ([id, modeConfig]) => ({
      id,
      name: modeConfig.name,
      custom: true,
      prompt: modeConfig.systemPrompt ?? '',
      overridden: false,
    })
  );
  return [...builtIns, ...compact, ...subAgents, ...custom];
}

/**
 * Validates MCP config text before it's written: it must be a JSON object whose
 * `mcpServers` (if present) maps names to entries that each carry a `command`
 * (a string, or an array of strings as some ecosystems write it) or a string
 * `url`. Returns a human-readable error, or undefined when the text is fine.
 */
function validateMcpJson(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Expected a JSON object at the top level.';
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === undefined) {
    return 'Missing a "mcpServers" object.';
  }
  if (
    typeof servers !== 'object' ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return '"mcpServers" must be an object mapping a name to its config.';
  }
  for (const [name, value] of Object.entries(servers)) {
    if (typeof value !== 'object' || value === null) {
      return `Server "${name}" must be an object.`;
    }
    const entry = value as { command?: unknown; url?: unknown };
    const validCommand =
      typeof entry.command === 'string' ||
      (Array.isArray(entry.command) &&
        entry.command.length > 0 &&
        entry.command.every((part) => typeof part === 'string'));
    if (!validCommand && typeof entry.url !== 'string') {
      return `Server "${name}" must have a "command" (local: a string or array of strings) or "url" (remote).`;
    }
  }
  return undefined;
}

function createNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
