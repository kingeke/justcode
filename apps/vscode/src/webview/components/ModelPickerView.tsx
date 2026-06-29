import * as React from 'react';

import type { WebviewModel } from '@ext/shared/protocol';
import { PlusIcon } from '@ext/webview/components/Icons';

// ── Sort ─────────────────────────────────────────────────────────────────────

type SortMode = 'provider' | 'input-cost' | 'output-cost' | 'context-window';
type SortDir = 'asc' | 'desc';

const SORT_MODES: SortMode[] = [
  'provider',
  'input-cost',
  'output-cost',
  'context-window',
];
const SORT_LABELS: Record<SortMode, string> = {
  provider: 'Provider',
  'input-cost': 'Input cost',
  'output-cost': 'Output cost',
  'context-window': 'Context',
};

function nextSort(
  mode: SortMode,
  dir: SortDir
): { mode: SortMode; dir: SortDir } {
  if (dir === 'asc') return { mode, dir: 'desc' };
  const idx = SORT_MODES.indexOf(mode);
  const nextMode = SORT_MODES[(idx + 1) % SORT_MODES.length]!;
  return { mode: nextMode, dir: 'asc' };
}

function sortModels(
  models: WebviewModel[],
  mode: SortMode,
  dir: SortDir
): WebviewModel[] {
  return [...models].sort((a, b) => {
    if (mode === 'provider') {
      const cmp = a.providerName.localeCompare(b.providerName);
      return dir === 'asc' ? cmp : -cmp;
    }
    if (mode === 'context-window') {
      const av = a.contextWindow ?? (dir === 'asc' ? -Infinity : Infinity);
      const bv = b.contextWindow ?? (dir === 'asc' ? -Infinity : Infinity);
      return dir === 'asc' ? av - bv : bv - av;
    }
    const key = mode === 'input-cost' ? 'inputCostPerM' : 'outputCostPerM';
    const av = a[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    const bv = b[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    return dir === 'asc' ? av - bv : bv - av;
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtCost(perM: number): string {
  if (perM === 0) return 'free';
  return `$${perM.toFixed(perM < 1 ? 3 : 2)}/M`;
}

function fmtCtx(n: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

function modelMeta(m: WebviewModel): string {
  const parts: string[] = [];
  if (m.local) {
    parts.push('local');
  } else if (m.inputCostPerM != null && m.outputCostPerM != null) {
    if (m.inputCostPerM === 0 && m.outputCostPerM === 0) {
      parts.push('free');
    } else {
      parts.push(
        `${fmtCost(m.inputCostPerM)} in`,
        `${fmtCost(m.outputCostPerM)} out`
      );
    }
  }
  if (m.contextWindow != null) parts.push(`${fmtCtx(m.contextWindow)} ctx`);
  return parts.join(' · ');
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ModelPickerViewProps {
  models: WebviewModel[];
  activeModel: string | undefined;
  activeProviderId: string | undefined;
  onSelect: (model: WebviewModel) => void;
  onClose: () => void;
  onConnectProvider: () => void;
}

export function ModelPickerView({
  models,
  activeModel,
  activeProviderId,
  onSelect,
  onClose,
  onConnectProvider,
}: ModelPickerViewProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [sortMode, setSortMode] = React.useState<SortMode>('provider');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query.trim()
    ? models.filter((m) => {
        const q = query.toLowerCase();
        return (
          m.displayName.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.providerName.toLowerCase().includes(q)
        );
      })
    : models;

  const sorted = sortModels(filtered, sortMode, sortDir);

  // Group only when sorting by provider.
  const byProvider = sortMode === 'provider';
  const groups: {
    providerId: string;
    providerName: string;
    models: WebviewModel[];
  }[] = [];
  if (byProvider) {
    for (const model of sorted) {
      const existing = groups.find((g) => g.providerId === model.providerId);
      if (existing) {
        existing.models.push(model);
      } else {
        groups.push({
          providerId: model.providerId,
          providerName: model.providerName,
          models: [model],
        });
      }
    }
  }

  const cycleSort = (): void => {
    const next = nextSort(sortMode, sortDir);
    setSortMode(next.mode);
    setSortDir(next.dir);
  };

  return (
    <div className="model-picker-view">
      <div className="model-picker-header">
        <button
          type="button"
          className="chat-back-btn"
          title="Back"
          onClick={onClose}
        >
          ← Back
        </button>
        <span className="sessions-title" style={{ flex: 1 }}>
          Select Model
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Connect a new provider"
          onClick={onConnectProvider}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="model-picker-search">
        <input
          ref={inputRef}
          className="model-search-input"
          type="text"
          placeholder="Search models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
      </div>

      <div className="model-picker-sort-bar">
        <span className="model-sort-label">Sort:</span>
        <button
          type="button"
          className="model-sort-btn"
          title="Cycle sort mode"
          onClick={cycleSort}
        >
          {SORT_LABELS[sortMode]} {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      <div className="model-picker-list">
        {sorted.length === 0 ? (
          <div className="sessions-empty">No models match.</div>
        ) : byProvider ? (
          groups.map((group) => (
            <div key={group.providerId} className="model-group">
              <div className="model-group-header">{group.providerName}</div>
              {group.models.map((model) => (
                <ModelRow
                  key={`${model.providerId}:${model.id}`}
                  model={model}
                  active={
                    model.id === activeModel &&
                    model.providerId === activeProviderId
                  }
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        ) : (
          sorted.map((model) => (
            <ModelRow
              key={`${model.providerId}:${model.id}`}
              model={model}
              active={
                model.id === activeModel &&
                model.providerId === activeProviderId
              }
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  active,
  onSelect,
}: {
  model: WebviewModel;
  active: boolean;
  onSelect: (model: WebviewModel) => void;
}): React.JSX.Element {
  const meta = modelMeta(model);
  return (
    <button
      type="button"
      className={`model-item ${active ? 'model-item-active' : ''}`}
      onClick={() => onSelect(model)}
    >
      <div className="model-item-left">
        <span className="model-item-name">{model.displayName}</span>
        {meta ? <span className="model-item-meta">{meta}</span> : null}
      </div>
      {active ? <span className="model-item-check">✓</span> : null}
    </button>
  );
}
