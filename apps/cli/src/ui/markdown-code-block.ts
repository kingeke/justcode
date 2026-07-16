import { BoxRenderable, type MarkdownOptions } from '@opentui/core';

/**
 * The marked token discriminants the markdown render hook cares about. Tokens
 * come from OpenTUI's bundled `marked` lexer, so the raw value is mapped onto
 * this enum at that boundary.
 */
export enum MarkdownTokenType {
  Code = 'code',
  Paragraph = 'paragraph',
}

// Fenced code blocks render inside a tinted, rounded, padded container so they
// read like the VS Code extension's `pre` blocks instead of flat transcript
// text. Shades are relative to the app background (#24272D in chat-app).
export const CODE_BLOCK_BG = '#1E2126';
export const CODE_BLOCK_BORDER = '#3A404A';

type MarkdownRenderNode = NonNullable<MarkdownOptions['renderNode']>;

/**
 * OpenTUI disables prose coalescing whenever a `renderNode` is set unless the
 * hook is flagged as code-block-only (the flag `createMarkdownCodeBlockRenderer`
 * sets); keeping it preserves the default paragraph/list layout and spacing.
 */
export type CodeBlockRenderNode = MarkdownRenderNode & {
  codeBlockOnly: true;
};

/**
 * A `<markdown renderNode>` hook that wraps every fenced code block in a
 * bordered, tinted box (the default syntax-highlighted CodeRenderable stays as
 * the content). All other tokens keep OpenTUI's default rendering.
 *
 * Only meant for non-streaming markdown: a wrapped block can't be updated in
 * place, so OpenTUI would recreate it on every streamed chunk. Committed
 * messages render once, which is exactly where the boxed look is wanted.
 */
export function createCodeBlockRenderNode(): CodeBlockRenderNode {
  const renderNode: MarkdownRenderNode = (token, context) => {
    if ((token.type as string) !== MarkdownTokenType.Code) return undefined;
    const code = context.defaultRender();
    if (!code) return undefined;
    // The default renderable carries the inter-block margin; move it onto the
    // wrapper so the blank line sits outside the border, not inside it.
    const marginBottom =
      typeof code.marginBottom === 'number' ? code.marginBottom : 0;
    code.marginBottom = 0;
    const box = new BoxRenderable(code.ctx, {
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
      border: true,
      borderStyle: 'rounded',
      borderColor: CODE_BLOCK_BORDER,
      backgroundColor: CODE_BLOCK_BG,
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom,
    });
    box.add(code);
    return box;
  };
  return Object.assign(renderNode, { codeBlockOnly: true as const });
}
