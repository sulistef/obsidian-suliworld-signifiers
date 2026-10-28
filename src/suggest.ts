import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import type SuliworldSignifiers from "./main";
import { glyphEl, Signifier } from "./signifiers";

/** Typing "- [" lists the signifiers, so nothing has to be typed inside the brackets. */
export class SignifierSuggest extends EditorSuggest<Signifier> {
	constructor(private readonly plugin: SuliworldSignifiers) {
		super(plugin.app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.autocomplete) return null;
		const line = editor.getLine(cursor.line);
		const m = line.slice(0, cursor.ch).match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[$/);
		if (!m?.[1]) return null;
		// Obsidian may have auto-closed the bracket: replace it too
		const endCh = line[cursor.ch] === "]" ? cursor.ch + 1 : cursor.ch;
		return { start: { line: cursor.line, ch: m[1].length }, end: { line: cursor.line, ch: endCh }, query: "" };
	}

	getSuggestions(_context: EditorSuggestContext): Signifier[] {
		return [...this.plugin.settings.signifiers];
	}

	renderSuggestion(sig: Signifier, el: HTMLElement): void {
		el.addClass("sws-suggestion");
		el.appendChild(glyphEl(sig, el.doc));
		el.createSpan({ text: sig.label, cls: "sws-label" });
		el.createSpan({ text: `[${sig.char}]`, cls: "sws-hint" });
	}

	selectSuggestion(sig: Signifier, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		const text = `[${sig.char}] `;
		editor.replaceRange(text, start, end);
		editor.setCursor({ line: start.line, ch: start.ch + text.length });
	}
}
