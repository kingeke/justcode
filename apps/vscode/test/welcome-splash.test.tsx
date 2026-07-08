import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WelcomeSplash } from '@ext/webview/components/WelcomeSplash';

describe('WelcomeSplash', () => {
  it('renders the brand logo with the invitation text below it', () => {
    const markup = renderToStaticMarkup(<WelcomeSplash />);

    expect(markup).toContain('welcome-splash');
    // The inlined emblem (gradient strokes) rather than an external image.
    expect(markup).toContain('welcome-splash-logo');
    expect(markup).toContain('welcome_grad_left');
    expect(markup).toContain('#9B5CF6');
    // The invitation copy.
    expect(markup).toContain('Ready when you are');
    // Logo renders before the text.
    expect(markup.indexOf('welcome-splash-logo')).toBeLessThan(
      markup.indexOf('Ready when you are')
    );
  });
});
