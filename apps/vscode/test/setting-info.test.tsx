import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  COMPOSER_SETTING_INFO,
  ComposerSettingId,
  SettingInfoButton,
  SettingInfoText,
} from '@ext/webview/components/SettingInfo';

describe('composer setting info', () => {
  it('has a non-empty description for every setting', () => {
    for (const id of Object.values(ComposerSettingId)) {
      expect(COMPOSER_SETTING_INFO[id]).toBeTruthy();
      expect(COMPOSER_SETTING_INFO[id].length).toBeGreaterThan(20);
    }
  });

  it('renders an accessible info button that reflects its open state', () => {
    const closed = renderToStaticMarkup(
      <SettingInfoButton
        id={ComposerSettingId.MaxFileRead}
        open={false}
        onToggle={() => {}}
      />
    );
    expect(closed).toContain('aria-label="What this setting does"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('<svg');
    expect(closed).not.toContain('settings-info-btn-active');

    const open = renderToStaticMarkup(
      <SettingInfoButton
        id={ComposerSettingId.MaxFileRead}
        open={true}
        onToggle={() => {}}
      />
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('settings-info-btn-active');
  });

  it('shows the description only while open', () => {
    const closed = renderToStaticMarkup(
      <SettingInfoText id={ComposerSettingId.AutoApprovals} open={false} />
    );
    expect(closed).toBe('');

    const open = renderToStaticMarkup(
      <SettingInfoText id={ComposerSettingId.AutoApprovals} open={true} />
    );
    expect(open).toContain('settings-popup-info');
    expect(open).toContain(
      COMPOSER_SETTING_INFO[ComposerSettingId.AutoApprovals]
    );
  });
});
