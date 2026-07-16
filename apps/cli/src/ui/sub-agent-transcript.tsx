import React, { useEffect, useRef, useState } from 'react';
import {
  StyledText,
  SyntaxStyle,
  type ScrollBoxRenderable,
  type TextChunk,
  createTextAttributes,
  parseColor,
} from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { formatCost } from '@core/domain/format-cost';
import { MessageRole } from '@core/domain/message';
import { SubAgentRunStatus, type SubAgentRun } from '@core/domain/sub-agent';
import {
  summarizeToolArgs,
  toolResultSummary,
  transcriptMessages,
} from '@cli/ui/sub-agent-transcript-helpers.js';
import { KeyName } from '@cli/ui/key-name.js';
import { prepareMarkdown } from '@cli/ui/markdown.js';
import {
  createCodeBlockRenderNode,
  type CodeBlockRenderNode,
} from '@cli/ui/markdown-code-block.js';
import { MARKDOWN_SYNTAX_STYLES } from '@cli/ui/markdown-theme.js';
import { formatTime } from '@cli/ui/format-message-timing.js';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

// Own lazy SyntaxStyle (mirrors chat-app's getSyntaxStyle): created on first
// use so it isn't constructed before the native renderer is initialised.
let syntaxStyle: SyntaxStyle | null = null;
function getSyntaxStyle(): SyntaxStyle {
  if (!syntaxStyle) {
    syntaxStyle = SyntaxStyle.fromStyles(MARKDOWN_SYNTAX_STYLES);
  }
  return syntaxStyle;
}

// Lazy render hook (mirrors chat-app's): boxes fenced code blocks so the
// transcript matches the main chat's extension-style code containers.
let codeBlockRenderNode: CodeBlockRenderNode | null = null;
function getCodeBlockRenderNode(): CodeBlockRenderNode {
  if (!codeBlockRenderNode) {
    codeBlockRenderNode = createCodeBlockRenderNode();
  }
  return codeBlockRenderNode;
}

function tc(
  text: string,
  opts: { fg?: string; bold?: boolean } = {}
): TextChunk {
  const chunk: TextChunk = { __isChunk: true, text };
  if (opts.fg) chunk.fg = parseColor(opts.fg);
  if (opts.bold) chunk.attributes = BOLD;
  return chunk;
}

function statusGlyph(status: SubAgentRunStatus): string {
  switch (status) {
    case SubAgentRunStatus.Running:
      return '◐';
    case SubAgentRunStatus.Completed:
      return '✓';
    case SubAgentRunStatus.Failed:
      return '✗';
    case SubAgentRunStatus.Aborted:
      return '◼';
  }
}

function statusColor(status: SubAgentRunStatus): string {
  switch (status) {
    case SubAgentRunStatus.Running:
      return 'yellow';
    case SubAgentRunStatus.Completed:
      return 'green';
    case SubAgentRunStatus.Failed:
      return 'red';
    case SubAgentRunStatus.Aborted:
      return MUTED;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}

/**
 * The run's own footer: ctx/in/cached/out/cost plus TTFT and avg toks/s —
 * scoped to this sub agent, mirroring the main session footer. Returns null
 * until the run has reported any usage.
 */
function runMetricsContent(run: SubAgentRun): StyledText {
  const usage = run.usage;
  const stats = run.stats;

  const chunks: TextChunk[] = [
    tc('ctx ', { fg: MUTED }),
    tc((stats?.lastInputTokens ?? 0).toLocaleString(), { fg: 'white' }),
    tc(' in ', { fg: MUTED }),
    tc((usage?.inputTokens ?? 0).toLocaleString(), { fg: 'white' }),
    tc(' cached ', { fg: MUTED }),
    tc((usage?.cachedTokens ?? 0).toLocaleString(), { fg: 'white' }),
    tc(' out ', { fg: MUTED }),
    tc((usage?.outputTokens ?? 0).toLocaleString(), { fg: 'white' }),
  ];

  if (usage?.cost != null && usage.cost > 0) {
    chunks.push(
      tc(' $', { fg: MUTED }),
      tc(formatCost(usage.cost), { fg: 'white' })
    );
  }

  if (stats?.ttftMs !== undefined) {
    chunks.push(tc(`  TTFT ${formatDuration(stats.ttftMs)}`, { fg: MUTED }));
  }
  if (stats?.tokensPerSecond !== undefined) {
    chunks.push(
      tc(' · ', { fg: MUTED }),
      tc(stats.tokensPerSecond.toFixed(1), { fg: 'white' }),
      tc(' tok/s', { fg: MUTED })
    );
  }
  if (stats?.avgTokensPerSecond !== undefined) {
    chunks.push(
      tc(' · AVG ', { fg: MUTED }),
      tc(stats.avgTokensPerSecond.toFixed(1), { fg: 'white' })
    );
  }

  return new StyledText(chunks);
}

interface SubAgentTranscriptProps {
  run: SubAgentRun;
  /**
   * The run's current status. Passed separately because a live run object
   * mutates in place: the panel entry (not the run) carries the fresh status
   * while the run executes.
   */
  status: SubAgentRunStatus;
  onClose: () => void;
}

/**
 * Full-screen viewer for one sub agent run's transcript — the CLI counterpart
 * of the extension's sub agent modal. While the run is still executing, its
 * `messages` array mutates in place, so a timer tick re-renders to show new
 * activity as it lands.
 */
export function SubAgentTranscript({
  run,
  status,
  onClose,
}: SubAgentTranscriptProps): React.ReactNode {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  // The live run mutates in place, so React won't re-render on its own; while
  // running, tick every 500ms to pick up newly appended messages.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== SubAgentRunStatus.Running) return;
    const interval = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(interval);
  }, [status]);

  const scrollBy = (delta: number): void => {
    const scroll = scrollRef.current;
    if (scroll && !scroll.isDestroyed) {
      scroll.scrollTo(scroll.scrollTop + delta);
    }
  };

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      onClose();
      return;
    }
    if (key.name === KeyName.Up) {
      scrollBy(-1);
      return;
    }
    if (key.name === KeyName.Down) {
      scrollBy(1);
      return;
    }
    if (key.name === KeyName.PageUp) {
      scrollBy(-(scrollRef.current?.height ?? 10));
      return;
    }
    if (key.name === KeyName.PageDown) {
      scrollBy(scrollRef.current?.height ?? 10);
      return;
    }
  });

  const messages = transcriptMessages(run);
  const toolUseCount = messages.filter(
    (message) => message.role === MessageRole.Tool
  ).length;
  const metricsLine = runMetricsContent(run);

  // Follow new activity as it lands: scrollbox stickyScroll only holds the
  // bottom while already there, so pin to the bottom whenever the transcript
  // grows (the 500ms tick above surfaces the appended messages).
  const messageCount = messages.length;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && !scroll.isDestroyed) {
      scroll.scrollTo(scroll.scrollHeight);
    }
  }, [messageCount]);

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="cyan"
      paddingX={1}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        marginTop={1}
        marginBottom={1}
        flexShrink={0}
      >
        <text
          content={
            new StyledText([
              tc(`${statusGlyph(status)} `, { fg: statusColor(status) }),
              tc('sub agent · ', { fg: MUTED }),
              tc(`${run.agentType} · `, { fg: MUTED }),
              tc(run.description, { fg: 'white', bold: true }),
              tc(
                run.model
                  ? `  ${run.providerId ? `${run.providerId} · ` : ''}${run.model}`
                  : '',
                { fg: MUTED }
              ),
              tc(
                toolUseCount > 0
                  ? `  ${toolUseCount} tool use${toolUseCount === 1 ? '' : 's'}`
                  : '',
                { fg: MUTED }
              ),
            ])
          }
        />
        <text fg={MUTED}>↑/↓ scroll · esc back</text>
      </box>
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        marginTop={1}
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: 'column' }}
      >
        {messages.map((message) =>
          message.role === MessageRole.User ? (
            <box
              key={message.id}
              flexDirection="column"
              alignItems="flex-end"
              paddingRight={2}
            >
              <box
                flexDirection="column"
                alignItems="flex-end"
                border={['right']}
                borderStyle="rounded"
                borderColor="cyan"
                paddingRight={1}
                marginY={1}
              >
                {message.content ? (
                  <text fg="white" attributes={BOLD}>
                    {message.content}
                  </text>
                ) : null}
                <text fg={MUTED}>{formatTime(message.createdAt)}</text>
              </box>
            </box>
          ) : message.role === MessageRole.Assistant ? (
            <box key={message.id} flexDirection="column">
              {message.content ? (
                <markdown
                  content={prepareMarkdown(message.content)}
                  syntaxStyle={getSyntaxStyle()}
                  tableOptions={{ style: 'grid' }}
                  flexShrink={0}
                  renderNode={getCodeBlockRenderNode()}
                />
              ) : null}
              {message.toolCalls?.map((call) => (
                <text key={call.id} fg="magenta">
                  ⚙ {call.name}({summarizeToolArgs(call.arguments)})
                </text>
              ))}
            </box>
          ) : (
            <text key={message.id} fg={message.isError ? 'red' : MUTED}>
              {`  ${message.isError ? '✗' : '→'} ${toolResultSummary(
                message.content
              )}`}
            </text>
          )
        )}
      </scrollbox>
      <box flexShrink={0} marginTop={1}>
        <text content={metricsLine} />
      </box>
    </box>
  );
}
