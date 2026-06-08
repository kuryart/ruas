import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	pushHistory, undoLast, redoNext, clearHistory,
	canUndo, canRedo, undoDescription, redoDescription,
} from './historyStore';

beforeEach(() => clearHistory());

// ── Initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
	it('canUndo is false', () => expect(canUndo()).toBe(false));
	it('canRedo is false', () => expect(canRedo()).toBe(false));
	it('undoDescription is undefined', () => expect(undoDescription()).toBeUndefined());
	it('redoDescription is undefined', () => expect(redoDescription()).toBeUndefined());
});

// ── pushHistory ───────────────────────────────────────────────────────────────

describe('pushHistory', () => {
	it('enables undo', () => {
		pushHistory({ description: 'cmd', undo: vi.fn(), redo: vi.fn() });
		expect(canUndo()).toBe(true);
		expect(canRedo()).toBe(false);
	});

	it('exposes undoDescription for the last command', () => {
		pushHistory({ description: 'Create note', undo: vi.fn(), redo: vi.fn() });
		pushHistory({ description: 'Delete contact', undo: vi.fn(), redo: vi.fn() });
		expect(undoDescription()).toBe('Delete contact');
	});

	it('clears the redo stack', async () => {
		pushHistory({ description: 'A', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		expect(canRedo()).toBe(true);

		pushHistory({ description: 'B', undo: vi.fn(), redo: vi.fn() });
		expect(canRedo()).toBe(false);
	});
});

// ── undoLast ──────────────────────────────────────────────────────────────────

describe('undoLast', () => {
	it('calls the undo function', async () => {
		const undo = vi.fn();
		pushHistory({ description: 'cmd', undo, redo: vi.fn() });
		await undoLast();
		expect(undo).toHaveBeenCalledOnce();
	});

	it('moves the command to the redo stack', async () => {
		pushHistory({ description: 'cmd', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		expect(canUndo()).toBe(false);
		expect(canRedo()).toBe(true);
	});

	it('does nothing when the stack is empty', async () => {
		await expect(undoLast()).resolves.toBeUndefined();
	});

	it('undoes in LIFO order', async () => {
		const order: string[] = [];
		pushHistory({ description: 'A', undo: () => { order.push('A'); }, redo: vi.fn() });
		pushHistory({ description: 'B', undo: () => { order.push('B'); }, redo: vi.fn() });
		pushHistory({ description: 'C', undo: () => { order.push('C'); }, redo: vi.fn() });
		await undoLast();
		await undoLast();
		await undoLast();
		expect(order).toEqual(['C', 'B', 'A']);
	});

	it('awaits async undo functions', async () => {
		let done = false;
		const undo = () => new Promise<void>(resolve => setTimeout(() => { done = true; resolve(); }, 0));
		pushHistory({ description: 'async', undo, redo: vi.fn() });
		await undoLast();
		expect(done).toBe(true);
	});
});

// ── redoNext ──────────────────────────────────────────────────────────────────

describe('redoNext', () => {
	it('calls the redo function', async () => {
		const redo = vi.fn();
		pushHistory({ description: 'cmd', undo: vi.fn(), redo });
		await undoLast();
		await redoNext();
		expect(redo).toHaveBeenCalledOnce();
	});

	it('moves the command back to the past stack', async () => {
		pushHistory({ description: 'cmd', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		await redoNext();
		expect(canRedo()).toBe(false);
		expect(canUndo()).toBe(true);
	});

	it('does nothing when the future stack is empty', async () => {
		await expect(redoNext()).resolves.toBeUndefined();
	});

	it('exposes redoDescription after undo', async () => {
		pushHistory({ description: 'Create contact', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		expect(redoDescription()).toBe('Create contact');
	});

	it('redoes in FIFO order', async () => {
		const order: string[] = [];
		pushHistory({ description: 'A', undo: vi.fn(), redo: () => { order.push('A'); } });
		pushHistory({ description: 'B', undo: vi.fn(), redo: () => { order.push('B'); } });
		await undoLast();
		await undoLast();
		await redoNext();
		await redoNext();
		expect(order).toEqual(['A', 'B']);
	});
});

// ── Full undo-redo cycle ──────────────────────────────────────────────────────

describe('full undo-redo cycle', () => {
	it('undo then redo restores canUndo=true, canRedo=false', async () => {
		pushHistory({ description: 'X', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		await redoNext();
		expect(canUndo()).toBe(true);
		expect(canRedo()).toBe(false);
	});

	it('multiple commands undo and redo in order', async () => {
		const calls: string[] = [];
		pushHistory({ description: 'A', undo: () => calls.push('undoA'), redo: () => calls.push('redoA') });
		pushHistory({ description: 'B', undo: () => calls.push('undoB'), redo: () => calls.push('redoB') });
		await undoLast(); // undoB
		await undoLast(); // undoA
		await redoNext(); // redoA
		await redoNext(); // redoB
		expect(calls).toEqual(['undoB', 'undoA', 'redoA', 'redoB']);
	});
});

// ── clearHistory ──────────────────────────────────────────────────────────────

describe('clearHistory', () => {
	it('resets both stacks', async () => {
		pushHistory({ description: 'A', undo: vi.fn(), redo: vi.fn() });
		pushHistory({ description: 'B', undo: vi.fn(), redo: vi.fn() });
		await undoLast();
		clearHistory();
		expect(canUndo()).toBe(false);
		expect(canRedo()).toBe(false);
	});
});
