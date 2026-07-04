import { describe, expect, it } from 'vitest';
import {
  COMPACT_CONTINUATION_HEADER,
  buildCompactSummaryContent,
  extractCompactSummary,
} from '@core/application/compact-prompt';

describe('extractCompactSummary', () => {
  it('returns a bare markdown reply trimmed as-is', () => {
    const reply = '\n## Primary Request and Intent\nBuild a timer.\n';
    expect(extractCompactSummary(reply)).toBe(
      '## Primary Request and Intent\nBuild a timer.'
    );
  });

  it('unwraps a <summary> block and drops the <analysis> scratch work', () => {
    const reply = [
      '<analysis>',
      'Chronological review: the user asked for a timer...',
      '</analysis>',
      '',
      '<summary>',
      '## Primary Request and Intent',
      'Build a timer.',
      '</summary>',
    ].join('\n');
    expect(extractCompactSummary(reply)).toBe(
      '## Primary Request and Intent\nBuild a timer.'
    );
  });

  it('drops <analysis> even when no <summary> block follows', () => {
    const reply =
      '<analysis>scratch notes</analysis>\n## Current Work\nEditing app.js.';
    expect(extractCompactSummary(reply)).toBe(
      '## Current Work\nEditing app.js.'
    );
  });

  it('returns empty for a reply that is only analysis scratch', () => {
    expect(extractCompactSummary('<analysis>only scratch</analysis>')).toBe('');
  });
});

describe('buildCompactSummaryContent', () => {
  it('prefixes the summary with the continuation header', () => {
    expect(buildCompactSummaryContent('the summary')).toBe(
      `${COMPACT_CONTINUATION_HEADER}\n\nthe summary`
    );
  });
});
