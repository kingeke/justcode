import type { TranscriptMatch } from '@ext/webview/transcript-search';

/**
 * Custom highlight names registered with `CSS.highlights`, styled by
 * `::highlight(...)` rules in webview.css.
 */
export enum HighlightName {
  Match = 'justcode-search-match',
  Active = 'justcode-search-active',
}

/** Which end of an occurrence {@link locateOffset} is resolving. */
export enum OffsetEdge {
  Start = 'start',
  End = 'end',
}

/** A half-open span of the searched text. */
export interface Occurrence {
  start: number;
  end: number;
}

/** A position inside a list of text nodes: which node, and how far into it. */
export interface NodePosition {
  /** Index into the text-node list. */
  index: number;
  /** Character offset within that node. */
  offset: number;
}

/**
 * Every case-insensitive occurrence of `query` in `text`, as character spans.
 * Pure so the offset arithmetic is unit-testable without a DOM.
 */
export function findOccurrences(text: string, query: string): Occurrence[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const haystack = text.toLowerCase();
  const occurrences: Occurrence[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    occurrences.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return occurrences;
}

/**
 * Maps a character offset in the concatenated text of a node list back onto the
 * node that holds it. `edge` decides what happens exactly on a node boundary: a
 * span's start belongs to the following node, its end to the preceding one, so a
 * match split across nodes still produces a valid Range.
 */
export function locateOffset(
  lengths: number[],
  offset: number,
  edge: OffsetEdge
): NodePosition | undefined {
  if (offset < 0) return undefined;
  let consumed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const end = consumed + length;
    const withinNode = edge === OffsetEdge.Start ? offset < end : offset <= end;
    if (withinNode) return { index, offset: offset - consumed };
    consumed = end;
  }
  return undefined;
}

/**
 * Which message holds the find bar's active occurrence, and its position within
 * that message — the pair needed to style one hit differently from the rest.
 */
export function activeOccurrence(
  matches: TranscriptMatch[],
  activeIndex: number
): { messageId: string; indexInMessage: number } | undefined {
  if (activeIndex < 0) return undefined;
  let remaining = activeIndex;
  for (const match of matches) {
    if (remaining < match.count) {
      return { messageId: match.messageId, indexInMessage: remaining };
    }
    remaining -= match.count;
  }
  return undefined;
}

/** The text nodes under `root`, in document order. */
function textNodesIn(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

/** Ranges covering every occurrence of `query` in `root`'s rendered text. */
function occurrenceRanges(root: Element, query: string): Range[] {
  const nodes = textNodesIn(root);
  if (nodes.length === 0) return [];
  const lengths = nodes.map((node) => node.data.length);
  const text = nodes.map((node) => node.data).join('');
  const ranges: Range[] = [];
  for (const occurrence of findOccurrences(text, query)) {
    const start = locateOffset(lengths, occurrence.start, OffsetEdge.Start);
    const end = locateOffset(lengths, occurrence.end, OffsetEdge.End);
    const startNode = start ? nodes[start.index] : undefined;
    const endNode = end ? nodes[end.index] : undefined;
    if (!start || !end || !startNode || !endNode) continue;
    const range = document.createRange();
    range.setStart(startNode, start.offset);
    range.setEnd(endNode, end.offset);
    ranges.push(range);
  }
  return ranges;
}

/** Removes both search highlights, e.g. when the find bar closes. */
export function clearSearchHighlights(): void {
  const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
  if (!registry) return;
  registry.delete(HighlightName.Match);
  registry.delete(HighlightName.Active);
}

/**
 * Paints the matched words themselves, using the CSS Custom Highlight API:
 * ranges are styled without touching the DOM, so the rendered Markdown (links,
 * code, inline HTML escaping) is left exactly as it was — wrapping hits in
 * `<mark>` elements would mean rewriting that HTML on every keystroke.
 *
 * Only the message bodies of matching messages are scanned (`.msg-content`), so
 * timestamps, attachment chips and tool cards can never light up. No-ops when
 * the API is unavailable; the active-message outline still shows the way.
 */
export function applySearchHighlights({
  container,
  matches,
  query,
  activeIndex,
}: {
  /** The transcript scroll container; null while the chat view isn't mounted. */
  container: HTMLElement | null;
  matches: TranscriptMatch[];
  query: string;
  activeIndex: number;
}): void {
  const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
  if (!registry) return;
  clearSearchHighlights();
  if (!container || query.trim() === '') return;

  const active = activeOccurrence(matches, activeIndex);
  const allRanges: Range[] = [];
  const activeRanges: Range[] = [];
  for (const match of matches) {
    // Messages hidden by the transcript window aren't mounted; skip them.
    const root = document.getElementById(`msg-${match.messageId}`);
    if (!root) continue;
    const ranges = Array.from(root.querySelectorAll('.msg-content')).flatMap(
      (body) => occurrenceRanges(body, query)
    );
    if (active?.messageId === match.messageId) {
      // The rendered text can differ slightly from the Markdown source (syntax
      // markers), so fall back to the message's first hit if the index is short.
      const hit = ranges[active.indexInMessage] ?? ranges[0];
      if (hit) activeRanges.push(hit);
    }
    allRanges.push(...ranges);
  }

  if (allRanges.length > 0) {
    registry.set(HighlightName.Match, new Highlight(...allRanges));
  }
  if (activeRanges.length > 0) {
    registry.set(HighlightName.Active, new Highlight(...activeRanges));
  }
}
