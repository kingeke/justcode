import { useCallback, useState } from 'react';

import { APP_NAME } from '@core/branding';

import emblemUrl from './assets/emblem.svg';
import {
  commands,
  extensionInstall,
  highlights,
  installCommands,
  marketplaceUrl,
  modes,
  privacyUrl,
  providers,
  repoUrl,
  surfaces,
  termsUrl,
  tools,
} from './content';
import { kofiUrl, wallets } from './support';

const NAV = [
  { href: '#why', label: 'Why' },
  { href: '#surfaces', label: 'VS Code' },
  { href: '#tools', label: 'Tools' },
  { href: '#commands', label: 'Commands' },
  { href: '#providers', label: 'Providers' },
  { href: '#support', label: 'Support' },
];

/** A small button that copies text and briefly confirms. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [value]);
  return (
    <button className="copy" onClick={copy} aria-label={label ?? 'Copy'}>
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  );
}

/** The VS Code "Extensions" glyph, used on the Marketplace button. */
function MarketplaceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2h4.2v4.2H2V2Zm7.8 0H14v4.2H9.8V2ZM2 9.8h4.2V14H2V9.8Z" />
      <path d="M12.6 9.8v1.6H14.2v1.2h-1.6V14.2h-1.2v-1.6H9.8v-1.2h1.6V9.8h1.2Z" />
    </svg>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="section">
      <div className="section-head">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function App() {
  const visibleWallets = wallets;

  return (
    <>
      <header className="nav">
        <a className="brand" href="#top">
          <img className="brand-mark" src={emblemUrl} alt="" width={26} height={26} />
          {APP_NAME}
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <a className="ghost-btn" href={repoUrl} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="hero">
          <img className="hero-mark" src={emblemUrl} alt={`${APP_NAME} logo`} width={96} height={96} />
          <p className="tag">Terminal · VS Code · v{__APP_VERSION__}</p>
          <h1>
            A lean, transparent coding assistant
            <br /> where <em>you</em> control every token.
          </h1>
          <p className="hero-lead">
            {APP_NAME} sends roughly <strong>550 tokens per request</strong> —
            most of it a system prompt you can read and edit. No hidden bloat, no
            wasted spend. Bring your own provider and your own rules.
          </p>

          <div className="stats">
            <div className="stat">
              <span className="num">~550</span>
              <span className="unit">tokens / request</span>
            </div>
            <div className="stat muted">
              <span className="num">~7k</span>
              <span className="unit">typical other tools</span>
            </div>
            <div className="stat muted">
              <span className="num">~27k</span>
              <span className="unit">Copilot on a “hey”</span>
            </div>
          </div>

          <div className="install">
            {installCommands.map((c) => (
              <div key={c.label} className="cmd">
                <span className="cmd-label">{c.label}</span>
                <code>{c.command}</code>
                <CopyButton value={c.command} />
              </div>
            ))}
            <div className="cmd">
              <span className="cmd-label">code</span>
              <code>{extensionInstall}</code>
              <CopyButton value={extensionInstall} />
              <a
                className="icon-btn"
                href={marketplaceUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in VS Code Marketplace"
                aria-label="Open in VS Code Marketplace"
              >
                <MarketplaceIcon />
              </a>
            </div>
          </div>

          <div className="cta">
            <a className="primary-btn" href={repoUrl} target="_blank" rel="noreferrer">
              Get started on GitHub
            </a>
            <a className="ghost-btn" href="#support">
              Support the dev
            </a>
          </div>
        </section>

        {/* Why */}
        <Section
          id="why"
          eyebrow="Why JustCode"
          title="Transparent by design"
          lead="No black-box prompts, no lock-in, no surprise token bills."
        >
          <div className="grid cards">
            {highlights.map((h) => (
              <article key={h.name} className="card">
                <h3>{h.name}</h3>
                <p>{h.description}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* Surfaces */}
        <Section
          id="surfaces"
          eyebrow="Terminal & VS Code"
          title="Use it where you work"
          lead="One lean engine, two front ends — the terminal TUI and a VS Code extension, both driving the same providers, tools, and modes."
        >
          <div className="grid surfaces">
            {surfaces.map((s) => (
              <article key={s.name} className="surface">
                <h3>{s.name}</h3>
                <p>{s.blurb}</p>
                <ul>
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="ext-install">
            <span className="ext-install-label">Install the VS Code extension</span>
            <div className="cmd">
              <span className="cmd-label">code</span>
              <code>{extensionInstall}</code>
              <CopyButton value={extensionInstall} />
            </div>
            <a
              className="ghost-btn"
              href={marketplaceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View on the Marketplace ↗
            </a>
            <p className="support-note dim">
              Or search “JustCode” in the VS Code Extensions panel.
            </p>
          </div>
        </Section>

        {/* Tools */}
        <Section
          id="tools"
          eyebrow="Built-in tools"
          title="A focused, capable toolset"
          lead="The model works with your project through these tools — and can load more on demand to keep requests lean."
        >
          <div className="grid tools">
            {tools.map((t) => (
              <article key={t.name} className="tool">
                <code className="tool-name">{t.name}</code>
                <p>{t.description}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* Modes */}
        <Section
          id="modes"
          eyebrow="Modes"
          title="Match the model's posture to the task"
        >
          <div className="grid modes">
            {modes.map((m) => (
              <article key={m.name} className="card">
                <h3>{m.name}</h3>
                <p>{m.description}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* Commands */}
        <Section
          id="commands"
          eyebrow="Slash commands"
          title="Drive everything from the prompt"
          lead="Type / in the chat to connect providers, switch models, manage sessions, tweak context, and more."
        >
          <div className="grid commands">
            {commands.map((c) => (
              <div key={c.name} className="command">
                <code>{c.name}</code>
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Providers */}
        <Section
          id="providers"
          eyebrow="Providers"
          title="Bring your own model"
          lead="Connect a hosted API or run everything locally — your keys, your spend."
        >
          <div className="grid providers">
            {providers.map((p) => (
              <article key={p.name} className="card">
                <h3>{p.name}</h3>
                <p>{p.description}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* Support */}
        <Section
          id="support"
          eyebrow="Support the developer"
          title="Say thanks for the tool"
          lead="JustCode is free and open. If it saved you time, a small tip is hugely appreciated — no pressure, no paywall."
        >
          <div className="support">
            <a
              className="kofi-btn"
              href={kofiUrl}
              target="_blank"
              rel="noreferrer"
            >
              ☕ Buy me a coffee on Ko-fi
            </a>
            <p className="support-note">
              Card, Apple Pay, Google Pay or PayPal — no account needed.
            </p>

            {visibleWallets.length > 0 ? (
              <div className="wallets">
                {visibleWallets.map((w) => (
                  <div key={w.ticker} className="wallet">
                    <div className="wallet-head">
                      <span className="wallet-name">
                        {w.name} <span className="ticker">{w.ticker}</span>
                      </span>
                      <span className="network">{w.network}</span>
                    </div>
                    <div className="wallet-addr">
                      <code>{w.address}</code>
                      <CopyButton value={w.address} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="support-note dim">
                Crypto tip addresses (BTC / USDT) coming soon.
              </p>
            )}
          </div>
        </Section>
      </main>

      <footer className="footer">
        <span>
          {APP_NAME} · MIT licensed · © {new Date().getFullYear()} Chinonso Eke
        </span>
        <nav className="footer-links">
          <a href={termsUrl} target="_blank" rel="noreferrer">
            Terms
          </a>
          <a href={privacyUrl} target="_blank" rel="noreferrer">
            Privacy
          </a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </nav>
      </footer>
    </>
  );
}
