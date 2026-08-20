import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PlanCard, copyPlanText } from '@ext/webview/components/PlanCard';

describe('PlanCard actions', () => {
  const plan = '# Plan\n\n1. Do the thing';

  it('offers copy alongside start and edit on the latest plan', () => {
    const markup = renderToStaticMarkup(
      <PlanCard plan={plan} showActions onStart={() => {}} onEdit={() => {}} />
    );

    expect(markup).toContain('plan-start-btn');
    expect(markup).toContain('plan-edit-btn');
    expect(markup).toContain('plan-copy-btn');
    expect(markup).toContain('Copy plan');
    expect(markup).toContain('Copy the plan as Markdown');
  });

  it('hides every action on older plans', () => {
    const markup = renderToStaticMarkup(
      <PlanCard
        plan={plan}
        showActions={false}
        onStart={() => {}}
        onEdit={() => {}}
      />
    );

    expect(markup).not.toContain('plan-copy-btn');
    expect(markup).not.toContain('plan-actions');
  });

  it('copies the plan markdown source as-is', async () => {
    const written: string[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText: (text: string) => {
            written.push(text);
            return Promise.resolve();
          },
        },
      },
      configurable: true,
    });

    await expect(copyPlanText(plan)).resolves.toBe(true);
    // The Markdown source, not rendered HTML.
    expect(written).toEqual([plan]);
  });

  it('reports failure when the webview has no clipboard access', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    await expect(copyPlanText(plan)).resolves.toBe(false);
  });
});
