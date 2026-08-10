/**
 * Gap left above a message the transcript jumps to (find bar match, message
 * outline pick). Without it the target lands flush against the viewport's top
 * edge, tucked under the floating find bar and with no context above it.
 */
export const SCROLL_JUMP_OFFSET = 48;

export interface JumpScrollTopInput {
  /** The transcript viewport's current scrollTop. */
  containerScrollTop: number;
  /** Viewport-relative top of the scroll container (getBoundingClientRect). */
  containerTop: number;
  /** Viewport-relative top of the message being jumped to. */
  nodeTop: number;
  /** Gap to leave above the message; defaults to {@link SCROLL_JUMP_OFFSET}. */
  offset?: number;
}

/**
 * The scrollTop that puts a message at the top of the transcript, `offset`
 * pixels short of the edge. Clamped at 0 so a target near the head of the
 * conversation doesn't ask for a negative scroll. Pure so the arithmetic can be
 * unit-tested without a DOM.
 */
export function jumpScrollTop({
  containerScrollTop,
  containerTop,
  nodeTop,
  offset = SCROLL_JUMP_OFFSET,
}: JumpScrollTopInput): number {
  return Math.max(0, containerScrollTop + (nodeTop - containerTop) - offset);
}

/**
 * Smoothly scrolls the transcript so `node` sits {@link SCROLL_JUMP_OFFSET}
 * pixels below the top edge. Scrolls the container itself rather than using
 * `scrollIntoView({ block: 'start' })`, which has no way to leave a gap and so
 * parks the target under the floating find bar. Falls back to `scrollIntoView`
 * when there's no container to measure against.
 */
export function scrollMessageIntoView(
  container: HTMLElement | null,
  node: HTMLElement,
  offset = SCROLL_JUMP_OFFSET
): void {
  if (!container) {
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  container.scrollTo({
    top: jumpScrollTop({
      containerScrollTop: container.scrollTop,
      containerTop: container.getBoundingClientRect().top,
      nodeTop: node.getBoundingClientRect().top,
      offset,
    }),
    behavior: 'smooth',
  });
}
