import { describe, it, expect } from 'vitest';
import { dumpYaml, loadYaml, splitFrontmatter, joinFrontmatter, buildDocument } from './frontmatter';

// ── loadYaml ──────────────────────────────────────────────────────────────────

describe('loadYaml', () => {
	it('parses a simple object', () => {
		expect(loadYaml('key: value')).toEqual({ key: 'value' });
	});

	it('parses nested objects', () => {
		expect(loadYaml('a:\n  b: 1')).toEqual({ a: { b: 1 } });
	});

	it('returns null for invalid YAML', () => {
		expect(loadYaml('{')).toBeNull();
	});

	it('returns null for YAML arrays', () => {
		expect(loadYaml('- a\n- b')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(loadYaml('')).toBeNull();
	});

	it('returns null for null literal', () => {
		expect(loadYaml('~')).toBeNull();
	});

	it('returns null for bare string', () => {
		expect(loadYaml('just a string')).toBeNull();
	});
});

// ── dumpYaml ──────────────────────────────────────────────────────────────────

describe('dumpYaml', () => {
	it('serializes a simple object', () => {
		const result = dumpYaml({ title: 'Hello' });
		expect(result).toContain('title:');
		expect(result).toContain('Hello');
	});

	it('round-trips a flat object with loadYaml', () => {
		const obj = { title: 'Test', uid: 'abc-123', count: 42 };
		expect(loadYaml(dumpYaml(obj))).toEqual(obj);
	});

	it('round-trips an object with arrays', () => {
		const obj = { tags: ['rust', 'tauri'], numbers: [1, 2, 3] };
		expect(loadYaml(dumpYaml(obj))).toEqual(obj);
	});

	it('handles special characters without crashing', () => {
		expect(() => dumpYaml({ note: 'colon: and "quotes"' })).not.toThrow();
	});
});

// ── splitFrontmatter ──────────────────────────────────────────────────────────

describe('splitFrontmatter', () => {
	it('splits a standard document', () => {
		const result = splitFrontmatter('---\ntitle: Hello\n---\n\nBody text');
		expect(result).toEqual({ fmYaml: 'title: Hello', body: 'Body text' });
	});

	it('returns null when no opening delimiter', () => {
		expect(splitFrontmatter('Just body text')).toBeNull();
	});

	it('returns null for unclosed frontmatter', () => {
		expect(splitFrontmatter('---\ntitle: Hello\n')).toBeNull();
	});

	it('returns empty body when document ends at delimiter', () => {
		const result = splitFrontmatter('---\ntitle: Hello\n---\n');
		expect(result).not.toBeNull();
		expect(result!.body).toBe('');
	});

	it('handles CRLF line endings', () => {
		const result = splitFrontmatter('---\r\ntitle: Hello\r\n---\r\n\r\nBody');
		expect(result).not.toBeNull();
		expect(result!.body).toBe('Body');
	});

	it('handles multi-line body', () => {
		const result = splitFrontmatter('---\ntitle: A\n---\n\nLine 1\nLine 2\n');
		expect(result!.body).toBe('Line 1\nLine 2\n');
	});

	it('handles empty frontmatter section', () => {
		const result = splitFrontmatter('---\n\n---\n\nBody');
		expect(result).not.toBeNull();
		expect(result!.fmYaml).toBe('');
	});
});

// ── joinFrontmatter ───────────────────────────────────────────────────────────

describe('joinFrontmatter', () => {
	it('builds the expected format', () => {
		expect(joinFrontmatter('title: Hello\n', 'Body')).toBe('---\ntitle: Hello\n---\n\nBody');
	});

	it('round-trips with splitFrontmatter', () => {
		const fmYaml = 'title: Test\nuid: 123\n';
		const body = 'Some content.';
		const doc = joinFrontmatter(fmYaml, body);
		const split = splitFrontmatter(doc);
		expect(split).not.toBeNull();
		expect(split!.fmYaml).toBe(fmYaml.trimEnd());
		expect(split!.body).toBe(body);
	});
});

// ── buildDocument ─────────────────────────────────────────────────────────────

describe('buildDocument', () => {
	it('strips null values', () => {
		const doc = buildDocument({ title: 'Hello', nothing: null }, 'Body');
		expect(doc).toContain('title: Hello');
		expect(doc).not.toContain('nothing');
	});

	it('strips undefined values', () => {
		const doc = buildDocument({ title: 'Hello', gone: undefined }, 'Body');
		expect(doc).not.toContain('gone');
	});

	it('strips empty string values', () => {
		const doc = buildDocument({ title: 'Hello', empty: '' }, 'Body');
		expect(doc).not.toContain('empty');
	});

	it('keeps falsy-but-valid values like 0', () => {
		const doc = buildDocument({ count: 0 }, 'Body');
		expect(loadYaml(splitFrontmatter(doc)!.fmYaml)).toMatchObject({ count: 0 });
	});

	it('full round-trip: buildDocument → splitFrontmatter → loadYaml', () => {
		const fm = { title: 'Round Trip', uid: 'xyz', tags: ['a', 'b'], modified: '2025-01-01' };
		const body = 'Content here.';
		const doc = buildDocument(fm, body);
		const split = splitFrontmatter(doc);
		expect(split).not.toBeNull();
		expect(loadYaml(split!.fmYaml)).toEqual(fm);
		expect(split!.body).toBe(body);
	});
});
