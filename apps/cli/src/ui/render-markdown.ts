import chalk from 'chalk';

export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLang = '';

  for (const line of lines) {
    const codeBlockMatch = line.match(/^```(\w*)$/);

    if (codeBlockMatch) {
      if (inCodeBlock) {
        // close the code block
        const code = codeBlockLines.join('\n');
        const label = codeLang ? chalk.dim(`[${codeLang}]`) : '';
        output.push(label ? `  ${label}` : '');
        output.push(
          code
            .split('\n')
            .map((l) => `  ${chalk.greenBright(l)}`)
            .join('\n')
        );
        output.push('');
        codeBlockLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = codeBlockMatch[1] ?? '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    let processed = line;

    // Headers
    if (/^### /.test(processed)) {
      processed = chalk.bold.cyan(processed.slice(4));
    } else if (/^## /.test(processed)) {
      processed = chalk.bold.cyan(processed.slice(3));
    } else if (/^# /.test(processed)) {
      processed = chalk.bold.cyan(processed.slice(2));
    }

    // Bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, (_, m: string) =>
      chalk.bold(m)
    );

    // Italic
    processed = processed.replace(/\*(.+?)\*/g, (_, m: string) =>
      chalk.italic(m)
    );

    // Inline code
    processed = processed.replace(/`([^`]+)`/g, (_, m: string) =>
      chalk.yellow(m)
    );

    // Bullets
    processed = processed.replace(/^(\s*)[-*] /, (_, indent: string) =>
      `${indent}• `
    );

    output.push(processed);
  }

  // unclosed code block — flush as-is
  if (inCodeBlock && codeBlockLines.length) {
    output.push(
      codeBlockLines
        .map((l) => `  ${chalk.greenBright(l)}`)
        .join('\n')
    );
  }

  return output.join('\n');
}
