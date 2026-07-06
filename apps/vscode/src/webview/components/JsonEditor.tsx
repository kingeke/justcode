import * as React from 'react';

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * Maps JSON syntax to the same VS Code theme variables the old regex
 * highlighter used, so the editor matches the active color theme.
 */
const jsonHighlightStyle = HighlightStyle.define([
  {
    tag: tags.propertyName,
    color: 'var(--vscode-symbolIcon-propertyForeground, #9cdcfe)',
  },
  {
    tag: tags.string,
    color: 'var(--vscode-debugTokenExpression-string, #ce9178)',
  },
  {
    tag: tags.number,
    color: 'var(--vscode-debugTokenExpression-number, #b5cea8)',
  },
  {
    tag: [tags.bool, tags.null],
    color: 'var(--vscode-debugTokenExpression-boolean, #569cd6)',
  },
]);

/**
 * Chrome (gutters, selection, cursor, fold widgets, lint UI) themed via VS
 * Code CSS variables, so light/dark/high-contrast all follow the editor theme.
 */
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border:
      '1px solid var(--vscode-input-border, var(--vscode-panel-border, #555))',
    borderRadius: '6px',
    fontSize: '12px',
    height: '320px',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--vscode-focusBorder)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    lineHeight: '1.5',
  },
  '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)' },
  '.cm-cursor': {
    borderLeftColor: 'var(--vscode-editorCursor-foreground)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor:
      'var(--vscode-editor-selectionBackground, rgba(90, 120, 200, 0.35)) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editorLineNumber-foreground, #858585)',
    border: 'none',
    borderRight:
      '1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c))',
  },
  '.cm-activeLine': {
    backgroundColor:
      'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.04))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editorLineNumber-activeForeground, #c6c6c6)',
  },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--vscode-badge-background, #4d4d4d)',
    color: 'var(--vscode-badge-foreground, #fff)',
    border: 'none',
    borderRadius: '3px',
    padding: '0 6px',
    margin: '0 3px',
  },
  '.cm-matchingBracket': {
    backgroundColor:
      'var(--vscode-editorBracketMatch-background, rgba(0,100,0,0.25))',
    outline: '1px solid var(--vscode-editorBracketMatch-border, transparent)',
  },
  '.cm-placeholder': {
    color: 'var(--vscode-input-placeholderForeground, #888)',
  },
  '.cm-lintRange-error': {
    textDecoration:
      'underline wavy var(--vscode-editorError-foreground, #f48771)',
    textUnderlineOffset: '2px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--vscode-editorHoverWidget-background, #252526)',
    color: 'var(--vscode-editorHoverWidget-foreground, #ccc)',
    border: '1px solid var(--vscode-editorHoverWidget-border, #454545)',
  },
});

export interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Ghost text shown while the document is empty. */
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * A real JSON code editor (CodeMirror 6): line numbers, fold/collapse gutters
 * on objects and arrays, bracket matching, auto-indent, undo history, and
 * inline squiggles + gutter markers for JSON syntax errors. Controlled: the
 * document follows `value` and every edit reports through `onChange`.
 */
export function JsonEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: JsonEditorProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  // Read by the CodeMirror update listener (created once); a ref keeps it
  // current without rebuilding the editor per render.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    // The placeholder lives in a compartment so a prop change could
    // reconfigure it without rebuilding; in practice it's static per mount.
    const placeholderCompartment = new Compartment();

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        codeFolding(),
        foldGutter({
          openText: '▾',
          closedText: '▸',
        }),
        indentOnInput(),
        bracketMatching(),
        json(),
        syntaxHighlighting(jsonHighlightStyle),
        linter(jsonParseLinter()),
        lintGutter(),
        placeholderCompartment.of(
          placeholder ? cmPlaceholder(placeholder) : []
        ),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorState.tabSize.of(2),
      ],
    });

    const view = new EditorView({ state, parent: container });
    if (ariaLabel) {
      view.contentDOM.setAttribute('aria-label', ariaLabel);
    }
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Mount once: `value` seeds the initial doc; later external values sync
    // through the effect below, and callbacks flow through onChangeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value pushes (host reload, Format button) into the document
  // without disturbing typing: only dispatch when the text actually differs.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="mcp-editor-cm" ref={containerRef} />;
}
