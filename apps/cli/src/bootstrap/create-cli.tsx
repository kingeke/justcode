import { Command, type OptionValues } from 'commander';
import React from 'react';
import { version as appVersion } from '../../../../package.json';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  deleteDebugLog,
  setDebugLogDirectory,
  setDebugLoggingEnabled,
} from '@core/application/debug-log';
import { cacheDirectory } from '@core/application/cache-dir';
import type { ProviderId } from '@core/ports/provider-catalog';
import { createRuntimeServices } from '@runtime/bootstrap/create-services';
import { DEFAULT_MAX_READ_LINES } from '@runtime/tools/read-file-tool';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import { DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT } from '@core/application/compact-prompt';
import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import { resetAppState } from '@runtime/persistence/reset-app-state';
import {
  addCustomMode,
  BUILD_MODE_ID,
  eagerToolsForMode,
  isKnownMode,
  listModes,
  resolveModeSystemPrompt,
} from '@core/domain/chat-mode';
import { APP_NAME, APP_NAME_LOWERED } from '@core/branding';
import { getUpdateNotice } from '@core/application/update-check';

interface SharedOptions {
  provider?: string;
  model?: string;
  session?: string;
}

interface StartupProviderSelection {
  providerId: ProviderId | undefined;
  allowDefaultProvider: boolean;
}

export function createCli(): Command {
  const program = new Command();

  // Debug logging can capture request/response payloads, so it's a dev-only
  // convenience: enable it only when the `dev`/`dev:watch` scripts set
  // JUSTCODE_DEBUG. The compiled production binary never sets it, so shipped
  // builds write no debug.log at all (even with redaction, we don't want token
  // traffic on a user's disk). Must run before the startup cleanup so the stale
  // log is actually removed in dev.
  setDebugLoggingEnabled(process.env.JUSTCODE_DEBUG === '1');
  // Keep debug.log out of whatever project the CLI is launched in: write it to
  // the shared cache dir (~/.cache/justcode) instead of process.cwd(), matching
  // the VSCode host. Must run before any logging or the startup cleanup below.
  setDebugLogDirectory(cacheDirectory());
  void deleteDebugLog();

  program
    .name(APP_NAME)
    .description(`${APP_NAME} CLI`)
    .option('-v, --version', 'Output the version number and check for updates')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions & { version?: boolean }>(
        args
      );
      if (options.version) {
        await printVersion();
        return;
      }
      await runChat(options);
    });

  program
    .command('chat')
    .description('Launch the interactive chat UI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions>(args);
      await runChat(options);
    });

  program
    .command('models')
    .description('List available models for a provider')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<Pick<SharedOptions, 'provider'>>(args);
      const providerId = resolveProviderId(options.provider);
      const runtime = await createRuntimeServices(
        providerId ? { providerId } : {}
      );

      if (!runtime.providerId) {
        process.stdout.write(
          `No provider is configured. Run \`${APP_NAME_LOWERED}\` and use /connect first.\n`
        );
        return;
      }

      const models = await runtime.listModelsService.execute();

      if (models.length === 0) {
        process.stdout.write(
          `No models are available for provider '${runtime.providerId}'.\n`
        );
        return;
      }

      process.stdout.write(`${runtime.providerId} models:\n`);
      for (const model of models) {
        process.stdout.write(`- ${model.id}\n`);
      }
    });

  registerSkillCommands(program);

  program
    .command('reset')
    .description(
      'Reset app defaults and clear connected providers, pulled models, MCP servers, and sessions'
    )
    .action(async () => {
      const confirmed = await confirmReset();
      if (!confirmed) {
        process.stdout.write('Reset cancelled.\n');
        return;
      }

      const appConfig = await loadAppConfig();
      await resetAppState(appConfig.configDirectory);
      process.stdout.write('Reset complete.\n');
    });

  return program;
}

/** The `--local` / `--global` scope flags shared by the skill subcommands. */
interface SkillScopeOptions {
  local?: boolean;
  global?: boolean;
}

/**
 * The `justcode skill …` subcommands: install skill packs from git
 * repositories, whose commands then appear as slash commands in the chat UI.
 * Plain-stdout management commands — nothing here touches the TUI.
 *
 * Skills install into one of two scopes: local (`.justcode/skills/` in the
 * current project) or global (`<configDirectory>/skills/`, shared everywhere).
 * `add` asks interactively when neither `--local` nor `--global` is given;
 * `remove`/`update`/`info` resolve local-first, matching how a local skill
 * shadows a global one at runtime.
 */
function registerSkillCommands(program: Command): void {
  const skill = program
    .command('skill')
    // `skills` is a natural slip; without the alias the root command swallows
    // it as a chat argument and errors confusingly on the scope flags.
    .alias('skills')
    .description('Manage installed skills (slash-command packs)');

  const configDir = (): Promise<string> =>
    loadAppConfig().then((config) => config.configDirectory);

  const scopeDirs = async (): Promise<{ local: string; global: string }> => {
    const { skillsDirectory, localSkillsDirectory } =
      await import('@runtime/skills/skill-store');
    return {
      local: localSkillsDirectory(process.cwd()),
      global: skillsDirectory(await configDir()),
    };
  };

  // Skill management is scriptable (used in CI/setup scripts), so failures
  // print one clean line and exit 1 instead of an unhandled-rejection stack.
  const run =
    <TArgs extends unknown[]>(action: (...args: TArgs) => Promise<void>) =>
    async (...args: TArgs): Promise<void> => {
      try {
        await action(...args);
      } catch (error) {
        process.stderr.write(
          `Error: ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
      }
    };

  const getScopeOptions = (args: unknown[]): SkillScopeOptions => {
    const options = getActionOptions<SkillScopeOptions>(args);
    if (options.local && options.global) {
      throw new Error('Pass either --local or --global, not both.');
    }
    return options;
  };

  /**
   * Which scope `add` installs into: an explicit flag wins; otherwise ask
   * interactively. Without a terminal to ask in (CI, pipes), default to
   * global — the safe, previous behavior.
   */
  const resolveAddScope = async (
    options: SkillScopeOptions
  ): Promise<'local' | 'global'> => {
    if (options.local) return 'local';
    if (options.global) return 'global';
    if (!process.stdin.isTTY) return 'global';
    // No output stream on the readline: with one set it would re-echo typed
    // characters. But that also means question() never prints its prompt, so
    // both lines are written to stdout directly and question('') just waits.
    const readline = createInterface({
      input: process.stdin,
      output: undefined,
    });
    try {
      process.stdout.write(
        `Install locally (this project's .justcode/skills) or globally (all projects)?\n[l]ocal / [g]lobal: `
      );
      const answer = await readline.question('');
      return answer.trim().toLowerCase().startsWith('l') ? 'local' : 'global';
    } finally {
      readline.close();
    }
  };

  /**
   * Where an already-installed skill lives, for remove/update/info: an
   * explicit flag pins the scope; otherwise local wins (mirroring runtime
   * shadowing), falling back to global.
   */
  const resolveInstalledDir = async (
    name: string,
    options: SkillScopeOptions
  ): Promise<string> => {
    const { isSkillInstalled } = await import('@runtime/skills/skill-store');
    const dirs = await scopeDirs();
    if (options.local) return dirs.local;
    if (options.global) return dirs.global;
    if (await isSkillInstalled(name, dirs.local)) return dirs.local;
    return dirs.global;
  };

  skill
    .command('add <repository>')
    .description(
      'Install a skill from a GitHub repository (owner/repo or a git URL)'
    )
    .option('--local', 'Install into this project (.justcode/skills)')
    .option('--global', 'Install for all projects')
    .action(
      run(async (repository: string, ...rest: unknown[]) => {
        const options = getScopeOptions([repository, ...rest]);
        const scope = await resolveAddScope(options);
        const { installSkill } = await import('@runtime/skills/skill-store');
        const dirs = await scopeDirs();
        const installed = await installSkill(repository, dirs[scope]);
        process.stdout.write(
          `Installed ${installed.manifest.name} v${installed.manifest.version} (${scope})\n`
        );
        for (const command of installed.commands) {
          process.stdout.write(
            `  /${command.name}${command.description ? ` — ${command.description}` : ''}\n`
          );
        }
        for (const problem of installed.errors) {
          process.stdout.write(`  warning: ${problem}\n`);
        }
      })
    );

  skill
    .command('remove <skill-name>')
    .description('Uninstall a skill and its slash commands')
    .option('--local', 'Remove the project-local install')
    .option('--global', 'Remove the global install')
    .action(
      run(async (name: string, ...rest: unknown[]) => {
        const options = getScopeOptions([name, ...rest]);
        const { removeSkill } = await import('@runtime/skills/skill-store');
        await removeSkill(name, await resolveInstalledDir(name, options));
        process.stdout.write(`Removed ${name}.\n`);
      })
    );

  skill
    .command('update <skill-name>')
    .description('Update an installed skill from its repository')
    .option('--local', 'Update the project-local install')
    .option('--global', 'Update the global install')
    .action(
      run(async (name: string, ...rest: unknown[]) => {
        const options = getScopeOptions([name, ...rest]);
        const { updateSkill } = await import('@runtime/skills/skill-store');
        const updated = await updateSkill(
          name,
          await resolveInstalledDir(name, options)
        );
        process.stdout.write(
          `Updated ${updated.manifest.name} to v${updated.manifest.version}\n`
        );
        for (const problem of updated.errors) {
          process.stdout.write(`  warning: ${problem}\n`);
        }
      })
    );

  skill
    .command('list')
    .description('List installed skills (local and global) and their commands')
    .action(
      run(async () => {
        const { discoverAllSkills } =
          await import('@runtime/skills/skill-store');
        const { buildSkillCommandIndex } = await import('@core/domain/skill');
        const { COMMANDS } = await import('@cli/ui/commands');
        const { skills, errors } = await discoverAllSkills({
          configDirectory: await configDir(),
          workspaceRoot: process.cwd(),
        });
        if (skills.length === 0 && errors.length === 0) {
          process.stdout.write(
            `No skills installed. Add one with \`${APP_NAME_LOWERED} skill add <owner/repo>\`.\n`
          );
          return;
        }
        const index = buildSkillCommandIndex(
          skills,
          COMMANDS.map((command) => command.name)
        );
        for (const installed of skills) {
          process.stdout.write(
            `${installed.manifest.name} v${installed.manifest.version}${
              installed.scope ? ` (${installed.scope})` : ''
            }${
              installed.manifest.description
                ? ` — ${installed.manifest.description}`
                : ''
            }\n`
          );
          for (const ref of index.commands.filter(
            (entry) => entry.skillName === installed.manifest.name
          )) {
            const invocation = ref.bareName
              ? `/${ref.bareName}`
              : `/${ref.qualifiedName}`;
            process.stdout.write(
              `  ${invocation}${ref.command.description ? ` — ${ref.command.description}` : ''}\n`
            );
          }
          for (const problem of installed.errors) {
            process.stdout.write(`  warning: ${problem}\n`);
          }
        }
        for (const collision of index.collisions) {
          process.stdout.write(
            `warning: /${collision.name} is defined by ${collision.claimedBy.join(
              ' and '
            )}; use the /<skill>${':'}${collision.name} form.\n`
          );
        }
        for (const problem of errors) {
          process.stdout.write(`warning: ${problem}\n`);
        }
      })
    );

  skill
    .command('info <skill-name>')
    .description('Show a skill’s manifest, commands, and install source')
    .option('--local', 'Inspect the project-local install')
    .option('--global', 'Inspect the global install')
    .action(
      run(async (name: string, ...rest: unknown[]) => {
        const options = getScopeOptions([name, ...rest]);
        const { getInstalledSkill } =
          await import('@runtime/skills/skill-store');
        const installed = await getInstalledSkill(
          name,
          await resolveInstalledDir(name, options)
        );
        const { manifest } = installed;
        process.stdout.write(`${manifest.name} v${manifest.version}\n`);
        if (manifest.description) {
          process.stdout.write(`${manifest.description}\n`);
        }
        if (manifest.author)
          process.stdout.write(`Author: ${manifest.author}\n`);
        if (installed.source) {
          process.stdout.write(`Source: ${installed.source}\n`);
        }
        if (installed.installedAt) {
          process.stdout.write(`Installed: ${installed.installedAt}\n`);
        }
        process.stdout.write(`Location: ${installed.directory}\n`);
        process.stdout.write('Commands:\n');
        for (const command of installed.commands) {
          const hint = command.argumentHint ? ` ${command.argumentHint}` : '';
          process.stdout.write(
            `  /${command.name}${hint}${command.description ? ` — ${command.description}` : ''}\n`
          );
          if (command.tools?.length) {
            process.stdout.write(`      tools: ${command.tools.join(', ')}\n`);
          }
          if (command.model && command.model !== 'auto') {
            process.stdout.write(`      model: ${command.model}\n`);
          }
        }
        for (const problem of installed.errors) {
          process.stdout.write(`  warning: ${problem}\n`);
        }
      })
    );
}

export function normalizeArgv(argv: readonly string[]): string[] {
  return argv.flatMap((argument) => {
    if (
      !argument.startsWith('-') ||
      argument.startsWith('--') ||
      !argument.includes('=')
    ) {
      return [argument];
    }

    const separatorIndex = argument.indexOf('=');
    const optionName = argument.slice(0, separatorIndex);
    const optionValue = argument.slice(separatorIndex + 1);

    if (!['-p', '-m', '-s'].includes(optionName) || !optionValue) {
      return [argument];
    }

    return [optionName, optionValue];
  });
}

async function confirmReset(): Promise<boolean> {
  process.stdout.write(
    `This will permanently reset ${APP_NAME} to defaults and clear connected providers, pulled models, MCP servers, and sessions. This is irreversible.\n`
  );

  const readline = createInterface({
    input: process.stdin,
    output: undefined,
  });

  try {
    const firstConfirmation = await readline.question('Continue? (y/N) ');
    if (firstConfirmation.trim().toLowerCase() !== 'y') {
      return false;
    }

    const secondConfirmation = await readline.question(
      'Type RESET to confirm this irreversible action: '
    );
    return secondConfirmation.trim() === 'RESET';
  } finally {
    readline.close();
  }
}

/**
 * Prints `<name> vX.Y.Z` and, when a newer release is known, the update notice.
 * Backs `justcode --version` and doubles as a TUI-free way to smoke-test the
 * update check (seed `~/.cache/justcode/update-check.json` and run it).
 */
async function printVersion(): Promise<void> {
  process.stdout.write(`${APP_NAME} v${appVersion}\n`);
  const notice = await getUpdateNotice(appVersion);
  if (notice) {
    process.stdout.write(
      `Update available: v${notice.latestVersion} — ${notice.upgradeCommand}\n`
    );
  }
}

async function runChat(options: SharedOptions): Promise<void> {
  const appConfig = await loadAppConfig();
  const savedConfig = await readGlobalConfig(appConfig.configDirectory);

  const startupProvider = resolveStartupProviderSelection(options, savedConfig);

  const runtime = await createRuntimeServices({
    ...(startupProvider.providerId
      ? { providerId: startupProvider.providerId }
      : {}),
    ...(startupProvider.allowDefaultProvider
      ? {}
      : { allowDefaultProvider: false }),
    configDirectory: appConfig.configDirectory,
    ...(savedConfig.cache?.maxReadLines
      ? { maxReadLines: savedConfig.cache.maxReadLines }
      : {}),
    // 0 is a valid value ("off"), so probe for presence rather than truthiness.
    ...(savedConfig.cache?.maxHistoryMessages !== undefined
      ? { maxHistoryMessages: savedConfig.cache.maxHistoryMessages }
      : {}),
  });

  // Merge into the persisted config so each write preserves the other fields.
  let currentConfig = savedConfig;
  const persistConfig = (patch: Partial<typeof savedConfig>): void => {
    currentConfig = { ...currentConfig, ...patch };
    void writeGlobalConfig(appConfig.configDirectory, currentConfig);
  };

  // Resolve chat modes (built-in + custom) and apply the active one's system
  // prompt to the runtime up front, so the first turn uses the right posture.
  let customModes = savedConfig.customModes ?? {};
  const modes = listModes(customModes);
  const initialMode = isKnownMode(savedConfig.mode ?? '', customModes)
    ? (savedConfig.mode as string)
    : BUILD_MODE_ID;
  const applyMode = (modeId: string): void => {
    runtime.setSystemPrompt(
      resolveModeSystemPrompt(modeId, {
        agentPrompt: savedConfig.systemPrompt,
        askPrompt: savedConfig.askSystemPrompt,
        planPrompt: savedConfig.planSystemPrompt,
        customModes,
      })
    );
    runtime.setEagerlyAdvertisedTools(eagerToolsForMode(modeId));
  };
  applyMode(initialMode);

  // Non-blocking notify-only update check: reads the cached result from a prior
  // run (fast file read) and refreshes the cache in the background for next time.
  const updateNotice = await getUpdateNotice(appVersion);

  // Discover installed skills once at startup so their commands appear in the
  // slash-command palette — the project's local `.justcode/skills` plus the
  // global scope, local shadowing global. Discovery is fast (local reads) and
  // fail-soft: a broken skill is skipped; any failure means no skill commands.
  const skillCommands = await (async () => {
    try {
      const { discoverAllSkills } = await import('@runtime/skills/skill-store');
      const { buildSkillCommandIndex } = await import('@core/domain/skill');
      const { COMMANDS } = await import('@cli/ui/commands');
      const { skills } = await discoverAllSkills({
        configDirectory: appConfig.configDirectory,
        workspaceRoot: process.cwd(),
      });
      return buildSkillCommandIndex(
        skills,
        COMMANDS.map((command) => command.name)
      );
    } catch {
      return undefined;
    }
  })();

  // Point OpenTUI at our embedded, self-contained tree-sitter worker before it
  // ever spawns one, so markdown highlights in the compiled binary (see
  // configure-tree-sitter.ts). Must run before the first <markdown> renders.
  const { configureTreeSitterWorker } =
    await import('@cli/bootstrap/configure-tree-sitter');
  configureTreeSitterWorker();

  // Lazily load the OpenTUI renderer + UI so the `models` command (and unit tests
  // that import createCli) never pull the native FFI renderer into their module graph.
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { ChatApp } = await import('@cli/ui/chat-app');

  const renderer = await createCliRenderer({
    // We arm/handle Ctrl+C ourselves (double-press to exit); mouse drives the
    // scrollback wheel in the chat view.
    exitOnCtrlC: false,
    useMouse: true,
  });
  // Paint a fixed dark background (the framebuffer clear color) so the UI —
  // which uses light-on-dark colors — stays readable on light/white terminal
  // themes instead of inheriting the terminal's background. Set explicitly
  // (not just via the config) so it reaches the native renderer, and it covers
  // every view including the full-screen pickers.
  renderer.setBackgroundColor('#24272D');
  const exit = (): void => {
    runtime.disposeMcp();
    renderer.destroy();
    process.exit(0);
  };

  createRoot(renderer).render(
    React.createElement(ChatApp, {
      onExit: exit,
      version: appVersion,
      updateNotice,
      providerId: runtime.providerId,
      savedConfig,
      configFilePath: join(appConfig.configDirectory, 'config.json'),
      configDirectory: appConfig.configDirectory,
      chatSessionService: runtime.chatSessionService,
      promptAttachmentService: runtime.promptAttachmentService,
      ...(skillCommands?.commands.length ? { skillCommands } : {}),
      sessionId: options.session ?? randomUUID(),
      requestedModel: options.model ?? savedConfig.lastModel,
      allProviders: runtime.allProviders,
      createProvider: runtime.createProvider,
      onConfigChange: (nextConfig) => {
        persistConfig(nextConfig);
      },
      // Reset replaces the config wholesale: discard the stale in-memory config
      // (which still holds connected providers) so persistConfig can't merge
      // them back on the next write.
      onConfigReset: (nextConfig) => {
        currentConfig = nextConfig;
        void writeGlobalConfig(appConfig.configDirectory, currentConfig);
      },
      // After a reset wipes mcp.json, reconnect from the (now empty) config so
      // the running servers are torn down and their tools leave the live registry.
      onReloadMcp: () => runtime.reloadMcp(),
      initialThinkingCollapsed: savedConfig.thinkingCollapsed ?? false,
      initialAutoApprove: savedConfig.autoApprove ?? false,
      initialLocalModelAutoRefresh: savedConfig.localModelAutoRefresh ?? true,
      initialModelAutoRefresh: savedConfig.modelAutoRefresh ?? true,
      initialLazyToolLoading: savedConfig.lazyToolLoading ?? true,
      manageableTools: runtime.manageableTools,
      initialDisabledTools: savedConfig.disabledTools ?? [],
      modes,
      initialMode,
      onModeChange: (modeId: string) => {
        applyMode(modeId);
        persistConfig({ mode: modeId });
      },
      onCreateMode: (name: string, systemPrompt?: string) => {
        const created = addCustomMode(name, systemPrompt, customModes);
        if (!created) return null;
        customModes = created.customModes;
        applyMode(created.id);
        persistConfig({ customModes, mode: created.id });
        return { modes: listModes(customModes), modeId: created.id };
      },
      initialExpandTools: savedConfig.expandTools ?? true,
      initialMaxReadLines:
        savedConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES,
      initialMaxHistoryMessages:
        savedConfig.cache?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
      initialAutoCompactThresholdPercent:
        savedConfig.autoCompactThresholdPercent ??
        DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT,
      ...(savedConfig.reasoningEffortByModel
        ? { initialReasoningEffortByModel: savedConfig.reasoningEffortByModel }
        : {}),
      onModelChange: (modelId: string, modelProviderId: string) => {
        persistConfig({ lastModel: modelId, lastProvider: modelProviderId });
      },
      onThinkingCollapsedChange: (collapsed: boolean) => {
        persistConfig({ thinkingCollapsed: collapsed });
      },
      onAutoApproveChange: (autoApply: boolean) => {
        persistConfig({ autoApprove: autoApply });
      },
      onLocalModelAutoRefreshChange: (enabled: boolean) => {
        runtime.setLocalModelAutoRefresh(enabled);
        persistConfig({ localModelAutoRefresh: enabled });
      },
      onModelAutoRefreshChange: (enabled: boolean) => {
        runtime.setModelAutoRefresh(enabled);
        persistConfig({ modelAutoRefresh: enabled });
      },
      onLazyToolLoadingChange: (enabled: boolean) => {
        runtime.setLazyToolLoading(enabled);
        persistConfig({ lazyToolLoading: enabled });
      },
      onDisabledToolsChange: (names: string[]) => {
        runtime.setDisabledTools(names);
        persistConfig({ disabledTools: names });
      },
      onExpandToolsChange: (expand: boolean) => {
        persistConfig({ expandTools: expand });
      },
      onMaxReadLinesChange: (lines: number) => {
        runtime.setMaxReadLines(lines);
        persistConfig({
          cache: { ...currentConfig.cache, maxReadLines: lines },
        });
      },
      onMaxHistoryMessagesChange: (count: number) => {
        runtime.setMaxHistoryMessages(count);
        persistConfig({
          cache: { ...currentConfig.cache, maxHistoryMessages: count },
        });
      },
      onAutoCompactThresholdChange: (percent: number) => {
        persistConfig({ autoCompactThresholdPercent: percent });
      },
      onReasoningEffortChange: (providerId, modelId, effort) => {
        persistConfig({
          reasoningEffortByModel: {
            ...currentConfig.reasoningEffortByModel,
            [providerId]: {
              ...currentConfig.reasoningEffortByModel?.[providerId],
              [modelId]: effort,
            },
          },
        });
      },
    })
  );
}

function resolveProviderId(
  provider: string | undefined
): ProviderId | undefined {
  return parseProviderId(provider);
}

export function resolveStartupProviderSelection(
  options: SharedOptions,
  savedConfig: {
    lastProvider?: string;
    providers?: Partial<Record<ProviderId, unknown>>;
  }
): StartupProviderSelection {
  const requestedProviderId = resolveProviderId(options.provider);

  if (options.provider) {
    if (
      requestedProviderId &&
      savedConfig.providers?.[requestedProviderId] !== undefined
    ) {
      return {
        providerId: requestedProviderId,
        allowDefaultProvider: false,
      };
    }

    return {
      providerId: undefined,
      allowDefaultProvider: false,
    };
  }

  return {
    providerId: parseProviderId(savedConfig.lastProvider),
    allowDefaultProvider: true,
  };
}

function getActionOptions<TOptions extends OptionValues>(
  args: unknown[]
): TOptions {
  const command = args.at(-1);
  if (!(command instanceof Command)) {
    throw new Error('Failed to resolve command options.');
  }

  return command.optsWithGlobals<TOptions>();
}
