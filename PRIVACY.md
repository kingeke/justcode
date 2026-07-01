# Privacy Policy

**Last updated: 1 July 2026**

This Privacy Policy explains how **JustCode** (the command-line interface, the
Visual Studio Code extension, and the website) handles information. JustCode is
free, open-source software provided by **Chinonso Eke** ("Developer", "we",
"us").

**Short version: JustCode runs on your machine and we do not collect, store, or
receive your data.** JustCode has no backend server of ours, no user accounts,
and no analytics or telemetry. The only data that leaves your device is data
**you** direct it to send to third parties you have chosen.

## 1. We do not collect your data

We do not operate a server that receives your prompts, code, files, keystrokes,
or usage. We do not track you, profile you, run analytics, or place advertising.
There are no JustCode accounts and no sign-in.

## 2. Data stored on your own device

JustCode stores data locally on your computer so it can work, including:

- **Configuration** (e.g. `config.json`) — your settings, connected providers,
  and the API keys or tokens you enter. Configuration is stored in plain text in
  your user directory and is written with owner-only file permissions. **Keeping
  this device and these files secure is your responsibility.**
- **Session history** — your conversations, saved under your local JustCode
  directory (e.g. `~/.justcode/sessions`) so you can resume them.
- **Caches** — such as the provider model list and update-check results.

This data stays on your device. You can delete it at any time (for example with
the in-app reset, or by removing the files), which is irreversible.

## 3. Data sent to third parties you choose

To do its job, JustCode sends data to services **you** configure with **your
own** credentials. We do not control these services and are not responsible for
how they handle your data. Their own privacy policies apply. This includes:

- **AI model providers** (e.g. OpenAI, Anthropic, OpenRouter, Alibaba/Qwen,
  Ollama, LM Studio, other OpenAI-compatible endpoints). To answer your
  requests, JustCode sends your prompts and the file/workspace context you
  include to the provider you selected. Local providers (such as Ollama or LM
  Studio) keep this on your own machine or network.
- **MCP servers and tools** you add. Data is sent to them as you direct.
- **Web fetch/search tools**, when you use them, contact the relevant web
  endpoints.

Review the privacy policy and terms of any provider or tool before connecting
it. **Do not send data you are not permitted to share.**

## 4. Update checks

To let you know when a newer version exists, JustCode may make an anonymous
request to the public GitHub Releases API. This request contains no personal
information about you beyond what any ordinary HTTPS request necessarily reveals
to the server (such as your IP address, handled by GitHub under GitHub's own
privacy policy). You can disable update checks by setting the
`JUSTCODE_NO_UPDATE_CHECK` environment variable.

## 5. The website and donations

The JustCode website is hosted on **GitHub Pages**; GitHub may collect standard
server logs (such as IP addresses) as described in GitHub's privacy statement.
The site itself sets no tracking cookies and runs no analytics.

If you choose to support the project, payments are handled entirely by the
third-party service you use (for example **Ko-fi**) or by public blockchain
networks (for cryptocurrency). We never receive your card details. Any
information you provide during a donation is handled by that provider under its
own privacy policy. Cryptocurrency transactions are public and recorded on their
respective blockchains.

## 6. Children

JustCode is a developer tool and is not directed to children. We do not
knowingly collect information from anyone, including children.

## 7. Security

We design JustCode to keep your data on your device, but no software or system is
perfectly secure. You are responsible for securing your device, your files, and
your credentials. We are not liable for unauthorized access to data on your
system (see the [Terms of Use](TERMS.md)).

## 8. Changes

We may update this Privacy Policy by posting a revised version in the project
repository. Changes take effect when posted.

## 9. Contact

Questions about privacy? Open an issue at
<https://github.com/kingeke/justcode/issues> or contact <chinonsoeke@gmail.com>.
