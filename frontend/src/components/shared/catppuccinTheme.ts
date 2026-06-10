import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const catppuccinTheme = EditorView.theme(
	{
		'&': {
			height: '100%',
			backgroundColor: 'var(--base)',
			color: 'var(--text)',
		},
		'.cm-scroller': {
			fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
			fontSize: '14px',
			lineHeight: '1.75',
			overflow: 'auto',
		},
		'.cm-content': {
			maxWidth: '800px',
			margin: '0 auto',
			padding: '32px 16px',
			caretColor: 'var(--accent)',
			minHeight: '100%',
		},
		'.cm-line': { padding: '0 2px' },
		'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
			backgroundColor: 'rgba(69,71,90,0.5)',
		},
		'&.cm-focused': { outline: 'none' },
		'.cm-activeLine': { backgroundColor: 'rgba(49,50,68,0.35)' },
		'.cm-gutters': {
			backgroundColor: 'transparent',
			color: 'var(--overlay0)',
			border: 'none',
			borderRight: 'none',
		},
		'.cm-lineNumbers .cm-gutterElement': {
			paddingLeft: '8px',
			paddingRight: '12px',
			minWidth: '2.5em',
			fontSize: '12px',
		},
	},
	{ dark: true },
);

export const catppuccinHighlight = syntaxHighlighting(
	HighlightStyle.define([
		{ tag: tags.heading1, color: '#89b4fa', fontWeight: '700', fontSize: '1.5em' },
		{ tag: tags.heading2, color: '#89b4fa', fontWeight: '600', fontSize: '1.25em' },
		{ tag: tags.heading3, color: '#89b4fa', fontWeight: '600', fontSize: '1.1em' },
		{ tag: tags.heading4, color: '#89b4fa', fontWeight: '600' },
		{ tag: tags.heading5, color: '#89b4fa', fontWeight: '500' },
		{ tag: tags.heading6, color: '#6c7086', fontWeight: '500' },
		{ tag: tags.strong, color: '#cdd6f4', fontWeight: '700' },
		{ tag: tags.emphasis, color: '#cdd6f4', fontStyle: 'italic' },
		{ tag: tags.strikethrough, textDecoration: 'line-through' },
		{ tag: tags.url, color: '#94e2d5' },
		{ tag: tags.link, color: '#89b4fa' },
		{ tag: tags.monospace, color: '#f38ba8' },
		{ tag: tags.comment, color: '#6c7086', fontStyle: 'italic' },
		{ tag: tags.meta, color: '#f9e2af' },
		{ tag: tags.punctuation, color: '#6c7086' },
		{ tag: tags.string, color: '#a6e3a1' },
		{ tag: tags.keyword, color: '#cba6f7' },
		{ tag: tags.invalid, color: '#f38ba8' },
	]),
);
