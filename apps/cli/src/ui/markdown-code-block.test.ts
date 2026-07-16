import { describe, expect, it, vi } from 'vitest';

// The native renderer's FFI isn't available under vitest, so constructing a
// real BoxRenderable is impossible here; a minimal stand-in records the options
// and children the render hook produces instead.
vi.mock('@opentui/core', () => {
  class FakeBoxRenderable {
    public readonly children: unknown[] = [];
    public marginBottom: number;

    constructor(
      public readonly ctx: unknown,
      public readonly options: Record<string, unknown>
    ) {
      this.marginBottom = (options.marginBottom as number) ?? 0;
    }

    add(child: unknown): void {
      this.children.push(child);
    }
  }
  return { BoxRenderable: FakeBoxRenderable };
});

import {
  CODE_BLOCK_BG,
  CODE_BLOCK_BORDER,
  createCodeBlockRenderNode,
  MarkdownTokenType,
} from '@cli/ui/markdown-code-block.js';

interface FakeCode {
  ctx: unknown;
  marginBottom: number;
}

function makeContext(code: FakeCode | null): {
  context: Parameters<ReturnType<typeof createCodeBlockRenderNode>>[1];
  defaultRender: ReturnType<typeof vi.fn>;
} {
  const defaultRender = vi.fn(() => code);
  return {
    context: { defaultRender } as never,
    defaultRender,
  };
}

describe('createCodeBlockRenderNode', () => {
  it('is flagged code-block-only so OpenTUI keeps prose coalesced', () => {
    expect(createCodeBlockRenderNode().codeBlockOnly).toBe(true);
  });

  it('leaves non-code tokens to the default renderer', () => {
    const renderNode = createCodeBlockRenderNode();
    const { context, defaultRender } = makeContext({
      ctx: {},
      marginBottom: 0,
    });

    const result = renderNode(
      { type: MarkdownTokenType.Paragraph } as never,
      context
    );

    expect(result).toBeUndefined();
    expect(defaultRender).not.toHaveBeenCalled();
  });

  it('returns undefined when the default code renderable is missing', () => {
    const renderNode = createCodeBlockRenderNode();
    const { context } = makeContext(null);

    const result = renderNode(
      { type: MarkdownTokenType.Code } as never,
      context
    );

    expect(result).toBeUndefined();
  });

  it('wraps code blocks in a tinted, rounded, padded container', () => {
    const renderNode = createCodeBlockRenderNode();
    const ctx = { marker: true };
    const code: FakeCode = { ctx, marginBottom: 1 };
    const { context } = makeContext(code);

    const box = renderNode(
      { type: MarkdownTokenType.Code } as never,
      context
    ) as unknown as {
      ctx: unknown;
      children: unknown[];
      options: Record<string, unknown>;
    };

    expect(box.ctx).toBe(ctx);
    expect(box.children).toEqual([code]);
    expect(box.options.border).toBe(true);
    expect(box.options.borderStyle).toBe('rounded');
    expect(box.options.borderColor).toBe(CODE_BLOCK_BORDER);
    expect(box.options.backgroundColor).toBe(CODE_BLOCK_BG);
    expect(box.options.paddingLeft).toBe(1);
    expect(box.options.paddingRight).toBe(1);
  });

  it('moves the inter-block margin from the code renderable onto the box', () => {
    const renderNode = createCodeBlockRenderNode();
    const code: FakeCode = { ctx: {}, marginBottom: 1 };
    const { context } = makeContext(code);

    const box = renderNode(
      { type: MarkdownTokenType.Code } as never,
      context
    ) as unknown as { options: Record<string, unknown> };

    expect(box.options.marginBottom).toBe(1);
    expect(code.marginBottom).toBe(0);
  });
});
