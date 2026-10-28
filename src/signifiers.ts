/** The bullet journal signifiers and the Markdown edits that set them. */

export interface Signifier {
	/** The character between the task's brackets. */
	char: string;
	/** Stable across edits, for command ids and CSS hooks. */
	id: string;
	label: string;
	glyph: string;
	/** Empty colors inherit Obsidian's palette. */
	colorLight: string;
	colorDark: string;
	disc: boolean;
}

const PRESETS = [
	{ char: " ", id: "todo", label: "Task", glyph: "•" },
	{ char: "x", id: "done", label: "Done", glyph: "×" },
	{ char: "*", id: "event", label: "Event", glyph: "✱" },
	{ char: "n", id: "note", label: "Note", glyph: "■" },
	{ char: ">", id: "migrated", label: "Migrated", glyph: "›" },
	{ char: "<", id: "scheduled", label: "Scheduled", glyph: "‹" },
	{ char: "!", id: "important", label: "Important", glyph: "!" },
];

export const DEFAULT_SIGNIFIERS: readonly Signifier[] = PRESETS.map((sig) => ({
	...sig, colorLight: "", colorDark: "", disc: sig.id === "important",
}));

/** "- [c] text" or "1. [c] text": indent and marker with "[", the character, "]". */
export const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;
/** "- text": a list item that isn't a task yet. */
const LIST_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)(?!\[.\])/;
/** "- [c] " at the start of a list item, to remove it. */
const TASK_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[.\]\s?/;

export function isDone(char: string | null): boolean {
	return char === "x" || char === "X";
}

/** The task character of a line, or null when the line isn't a task. */
export function taskChar(text: string | undefined): string | null {
	const m = text?.match(TASK_RE);
	return m?.[2] ?? null;
}

/** The line with its task character set to `char`, turning a list item or plain text into a task. */
export function withSignifier(text: string, char: string): string {
	if (TASK_RE.test(text)) return text.replace(TASK_RE, (_m, start: string, _c: string, end: string) => start + char + end);
	if (LIST_RE.test(text)) return text.replace(LIST_RE, (prefix) => `${prefix}[${char}] `);
	const indent = text.match(/^\s*/)?.[0] ?? "";
	return `${indent}- [${char}] ${text.slice(indent.length)}`;
}

/** The line with its "[c] " removed: back to a plain bullet. */
export function withoutSignifier(text: string): string {
	return text.replace(TASK_PREFIX_RE, "$1");
}

/** The configured symbol as real text, including in native menus. */
export function glyphEl(sig: Signifier, doc: Document = activeDocument): HTMLSpanElement {
	const span = doc.adoptNode(createSpan());
	span.className = "sws-glyph";
	span.textContent = sig.glyph;
	span.dataset.sig = sig.id;
	return span;
}
