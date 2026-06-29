import * as React from 'react';

import { MODIFIER_LABEL, hasOpenModifier } from '@ext/webview/platform';

/**
 * A tool card's title. When the call concerns a single file and an opener is
 * available, the title becomes ctrl/cmd-clickable to reveal that file in the
 * editor (mirroring the changes panel), with a link affordance on hover.
 */
export function ToolTitle({
  title,
  path,
  onOpenFile,
}: {
  title: string;
  path?: string | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}): React.JSX.Element {
  if (!path || !onOpenFile) {
    return <span className="tool-title">{title}</span>;
  }

  return (
    <span
      className="tool-title is-openable"
      title={`${path} — ${MODIFIER_LABEL}+click to open`}
      onClick={(event) => {
        if (hasOpenModifier(event)) onOpenFile(path);
      }}
    >
      {title}
    </span>
  );
}
