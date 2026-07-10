import { describe, expect, it } from 'vitest';

import type { WebviewModel } from '@ext/shared/protocol';
import {
  sortModels,
  SortMode,
  SortDir,
} from '@ext/webview/components/ModelPickerView';

function model(id: string, fields: Partial<WebviewModel> = {}): WebviewModel {
  return {
    id,
    displayName: id,
    providerId: 'p',
    providerName: 'P',
    ...fields,
  };
}

const ids = (models: WebviewModel[]): string[] => models.map((m) => m.id);

describe('sortModels', () => {
  it('orders by context window and pushes models without one to the end', () => {
    const models = [
      model('local'), // no contextWindow
      model('small', { contextWindow: 8_000 }),
      model('big', { contextWindow: 200_000 }),
    ];

    // Descending: largest first, the local (missing) model last — not bunched
    // at the top as it was before.
    expect(
      ids(sortModels(models, SortMode.ContextWindow, SortDir.Desc))
    ).toEqual(['big', 'small', 'local']);

    // Ascending: smallest first, missing still last.
    expect(
      ids(sortModels(models, SortMode.ContextWindow, SortDir.Asc))
    ).toEqual(['small', 'big', 'local']);
  });

  it('keeps priced models ahead of unpriced ones for cost sorts', () => {
    const models = [
      model('free'), // no price (local)
      model('cheap', { inputCostPerM: 0.5 }),
      model('pricey', { inputCostPerM: 5 }),
    ];

    expect(ids(sortModels(models, SortMode.InputCost, SortDir.Asc))).toEqual([
      'cheap',
      'pricey',
      'free',
    ]);
    expect(ids(sortModels(models, SortMode.InputCost, SortDir.Desc))).toEqual([
      'pricey',
      'cheap',
      'free',
    ]);
  });
});
