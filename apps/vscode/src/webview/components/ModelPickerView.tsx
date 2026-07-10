import * as React from 'react';

import type { WebviewModel, WebviewProviderError } from '@ext/shared/protocol';
import { PlusIcon, RefreshIcon } from '@ext/webview/components/Icons';

// ── Sort ─────────────────────────────────────────────────────────────────────

export enum SortMode {
  Provider = 'provider',
  InputCost = 'input-cost',
  OutputCost = 'output-cost',
  ContextWindow = 'context-window',
}
export enum SortDir {
  Asc = 'asc',
  Desc = 'desc',
}

const SORT_MODES: SortMode[] = Object.values(SortMode);
const SORT_LABELS: Record<SortMode, string> = {
  [SortMode.Provider]: 'Provider',
  [SortMode.InputCost]: 'Input cost',
  [SortMode.OutputCost]: 'Output cost',
  [SortMode.ContextWindow]: 'Context',
};

/**
 * Compares two numeric sort keys, always ordering a missing value (e.g. local
 * models that report no context window or price) last regardless of direction —
 * otherwise they'd bunch at the top of a descending sort instead of being
 * pushed out of the way.
 */
function compareNumeric(
  a: number | undefined,
  b: number | undefined,
  dir: SortDir
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === SortDir.Asc ? a - b : b - a;
}

export function sortModels(
  models: WebviewModel[],
  mode: SortMode,
  dir: SortDir
): WebviewModel[] {
  return [...models].sort((a, b) => {
    if (mode === SortMode.Provider) {
      const cmp = a.providerName.localeCompare(b.providerName);
      return dir === SortDir.Asc ? cmp : -cmp;
    }
    if (mode === SortMode.ContextWindow) {
      return compareNumeric(a.contextWindow, b.contextWindow, dir);
    }
    const key =
      mode === SortMode.InputCost ? 'inputCostPerM' : 'outputCostPerM';
    return compareNumeric(a[key], b[key], dir);
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
  /** Providers whose model list couldn't be fetched, shown inline as warnings. */
  providerErrors: WebviewProviderError[];
  activeModel: string | undefined;
  activeProviderId: string | undefined;
  /** Header title; defaults to "Select Model". Set when binding a default. */
  title?: string | undefined;
  onSelect: (model: WebviewModel) => void;
  onClose: () => void;
  onConnectProvider: () => void;
  /** Re-fetches every provider's model list (bypasses the cache). */
  onRefresh: () => void;
}

export function ModelPickerView({
  models,
  providerErrors,
  activeModel,
  activeProviderId,
  title,
  onSelect,
  onClose,
  onConnectProvider,
  onRefresh,
}: ModelPickerViewProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [sortMode, setSortMode] = React.useState<SortMode>(SortMode.Provider);
  const [sortDir, setSortDir] = React.useState<SortDir>(SortDir.Asc);
  const [refreshing, setRefreshing] = React.useState(false);
  const [collapsedProviders, setCollapsedProviders] = React.useState<
    Set<string>
  >(new Set());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Spin the refresh icon briefly on click; the new list arrives via a
  // ModelsUpdate that re-renders `models`, so this is a short visual cue only.
  React.useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setRefreshing(false), 1200);
    return () => clearTimeout(timer);
  }, [refreshing]);

  const handleRefresh = (): void => {
    setRefreshing(true);
    onRefresh();
  };

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
  const byProvider = sortMode === SortMode.Provider;
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

  // A live search overrides collapsing so matches are never hidden; the
  // collapsed set is kept and applies again once the query is cleared.
  const searching = query.trim().length > 0;
  const toggleProvider = (providerId: string): void => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  // Fold or unfold every provider group at once. "Collapse all" until every
  // visible group is collapsed, then it flips to "Expand all".
  const allCollapsed =
    groups.length > 0 &&
    groups.every((g) => collapsedProviders.has(g.providerId));
  const toggleAllProviders = (): void => {
    setCollapsedProviders(
      allCollapsed ? new Set() : new Set(groups.map((g) => g.providerId))
    );
  };

  // Clicking the active sort flips its direction; clicking another switches to
  // it ascending. Only one mode is ever active.
  const onSortClick = (mode: SortMode): void => {
    if (mode === sortMode) {
      setSortDir((dir) => (dir === SortDir.Asc ? SortDir.Desc : SortDir.Asc));
    } else {
      setSortMode(mode);
      setSortDir(SortDir.Asc);
    }
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
          {title ?? 'Select Model'}
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Connect a new provider"
          onClick={onConnectProvider}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={`icon-btn ${refreshing ? 'icon-btn-spinning' : ''}`}
          title="Refresh models"
          onClick={handleRefresh}
        >
          <RefreshIcon />
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
        {SORT_MODES.map((mode) => {
          const active = mode === sortMode;
          return (
            <button
              key={mode}
              type="button"
              className={`model-sort-btn ${active ? 'model-sort-btn-active' : ''}`}
              title={
                active
                  ? `Sorted by ${SORT_LABELS[mode].toLowerCase()} — click to reverse`
                  : `Sort by ${SORT_LABELS[mode].toLowerCase()}`
              }
              aria-pressed={active}
              onClick={() => onSortClick(mode)}
            >
              {SORT_LABELS[mode]}
              {active ? (sortDir === SortDir.Asc ? ' ↑' : ' ↓') : ''}
            </button>
          );
        })}
        {byProvider && !searching && groups.length > 0 ? (
          <button
            type="button"
            className="model-sort-btn model-collapse-all-btn"
            title={
              allCollapsed
                ? 'Expand every provider group'
                : 'Collapse every provider group'
            }
            onClick={toggleAllProviders}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        ) : null}
      </div>

      <div className="model-picker-list">
        {providerErrors.length > 0 ? (
          <div className="model-picker-errors">
            {providerErrors.map((err) => (
              <div key={err.providerId} className="model-picker-error">
                <span className="model-picker-error-provider">
                  {err.providerName}
                </span>
                <span className="model-picker-error-message">
                  {err.message}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {sorted.length === 0 ? (
          <div className="sessions-empty">
            {providerErrors.length > 0
              ? 'No models available from reachable providers.'
              : 'No models match.'}
          </div>
        ) : byProvider ? (
          groups.map((group) => {
            const collapsed =
              !searching && collapsedProviders.has(group.providerId);
            return (
              <div key={group.providerId} className="model-group">
                <button
                  type="button"
                  className="model-group-header"
                  title={collapsed ? 'Expand provider' : 'Collapse provider'}
                  aria-expanded={!collapsed}
                  onClick={() => toggleProvider(group.providerId)}
                >
                  <span className="model-group-chevron">
                    {collapsed ? '▸' : '▾'}
                  </span>
                  {group.providerName}
                  {collapsed ? (
                    <span className="model-group-count">
                      {group.models.length}
                    </span>
                  ) : null}
                </button>
                {collapsed
                  ? null
                  : group.models.map((model) => (
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
            );
          })
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
