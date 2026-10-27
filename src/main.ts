import { Editor, MarkdownPostProcessorContext, MarkdownView, Menu, Plugin, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { DEFAULT_SETTINGS, SignifiersSettings, SignifiersSettingTab } from "./settings";
import { SignifierSuggest } from "./suggest";
import {
	glyphEl,
	isDone,
	SIGNIFIERS,
	taskChar,
	withoutSignifier,
	withSignifier,
} from "./signifiers";

/** A task line: in the open editor (Live Preview) or in the file (reading view). */
interface TaskLocation {
	file: TFile;
	line: number;
	editor?: Editor;
}

/** Obsidian's Editor exposes its CodeMirror view as `cm` (not in the public typings). */
type EditorWithCm = Editor & { cm?: EditorView };

const LONG_PRESS_MS = 450;
/** After a long press opened the menu, ignore the click and contextmenu that follow it. */
const AFTER_LONG_PRESS_MS = 700;

export default class SuliworldSignifiers extends Plugin {
	settings: SignifiersSettings = DEFAULT_SETTINGS;
	/** Reading view: each rendered block holding tasks, with its post-processor context. */
	private sectionContexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
	private suppressUntil = 0;
	private pressTimer: number | null = null;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SignifiersSettings>);

		this.registerWindow(window);
		this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => this.registerWindow(win)));

		this.registerMarkdownPostProcessor((el, ctx) => {
			if (el.querySelector(".task-list-item-checkbox")) this.sectionContexts.set(el, ctx);
		});

		this.registerEditorSuggest(new SignifierSuggest(this));

		for (const sig of SIGNIFIERS) {
			this.addCommand({
				id: `set-${sig.id}`,
				name: `Set signifier: ${sig.label} [${sig.char}]`,
				editorCallback: (editor) => this.mapSelectedLines(editor, (text) => withSignifier(text, sig.char)),
			});
		}
		this.addCommand({
			id: "cycle",
			name: "Cycle signifier",
			editorCallback: (editor) => {
				const current = taskChar(editor.getLine(editor.getCursor().line));
				const i = SIGNIFIERS.findIndex((s) => s.char === current);
				const next = SIGNIFIERS[(i + 1) % SIGNIFIERS.length];
				if (next) this.mapSelectedLines(editor, (text) => withSignifier(text, next.char));
			},
		});
		this.addCommand({
			id: "plain",
			name: "Remove signifier (plain bullet)",
			editorCallback: (editor) => this.mapSelectedLines(editor, withoutSignifier),
		});

		this.addSettingTab(new SignifiersSettingTab(this.app, this));
	}

	onunload(): void {
		for (const doc of this.documents()) doc.body.removeClasses(["sw-signifiers-plugin", "sws-draw"]);
		this.cancelPress();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Body classes and listeners for one window: the main one, and each popout window. */
	private registerWindow(win: Window): void {
		const doc = win.document;
		doc.body.addClass("sw-signifiers-plugin");
		doc.body.toggleClass("sws-draw", this.settings.drawSignifiers);
		// Capture phase, so Obsidian's own checkbox toggle never runs
		this.registerDomEvent(doc, "click", (evt) => void this.onClick(evt), { capture: true });
		this.registerDomEvent(doc, "contextmenu", (evt) => this.onContextMenu(evt), { capture: true });
		this.registerDomEvent(doc, "touchstart", (evt) => this.onTouchStart(evt), { capture: true, passive: true });
		this.registerDomEvent(doc, "touchend", () => this.cancelPress(), { capture: true });
		this.registerDomEvent(doc, "touchmove", () => this.cancelPress(), { capture: true, passive: true });
		// Enter is caught before CodeMirror: list plugins such as Outliner also bind Enter
		// at the highest precedence, so a CodeMirror keymap would lose.
		this.registerDomEvent(doc, "keydown", (evt) => this.onKeyDown(evt), { capture: true });
	}

	private documents(): Set<Document> {
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			docs.add(leaf.view.containerEl.ownerDocument);
		});
		return docs;
	}

	applyDrawing(): void {
		for (const doc of this.documents()) doc.body.toggleClass("sws-draw", this.settings.drawSignifiers);
	}

	// ------------------------------------------------------------------ locating a checkbox's line
	private checkboxFrom(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof Element)) return null;
		const cb = target.closest<HTMLElement>(".task-list-item-checkbox");
		return cb?.closest(".markdown-source-view, .markdown-preview-view") ? cb : null;
	}

	private locate(cb: HTMLElement): TaskLocation | null {
		const view = this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.containerEl.contains(cb));
		if (!view?.file) return null;

		if (cb.closest(".markdown-source-view")) {
			const cm = (view.editor as EditorWithCm).cm;
			if (!cm) return null;
			const line = cm.state.doc.lineAt(cm.posAtDOM(cb)).number - 1;
			return { file: view.file, line, editor: view.editor };
		}

		// Reading view: the post-processor context of the rendered block, plus the item's line in it
		let block = cb.parentElement;
		while (block && !this.sectionContexts.has(block)) block = block.parentElement;
		const item = cb.closest<HTMLElement>("li[data-line]");
		const ctx = block ? this.sectionContexts.get(block) : undefined;
		const info = block && ctx ? ctx.getSectionInfo(block) : null;
		if (!info || !item) return null;
		return { file: view.file, line: info.lineStart + Number(item.dataset.line) };
	}

	private async lineText(loc: TaskLocation): Promise<string | undefined> {
		if (loc.editor) return loc.editor.getLine(loc.line);
		return (await this.app.vault.cachedRead(loc.file)).split("\n")[loc.line];
	}

	private async applyToLine(loc: TaskLocation, transform: (text: string) => string): Promise<void> {
		if (loc.editor) {
			const text = loc.editor.getLine(loc.line);
			const next = transform(text);
			if (next !== text) loc.editor.replaceRange(next, { line: loc.line, ch: 0 }, { line: loc.line, ch: text.length });
			return;
		}
		await this.app.vault.process(loc.file, (data) => {
			const lines = data.split("\n");
			const text = lines[loc.line];
			if (text !== undefined) lines[loc.line] = transform(text);
			return lines.join("\n");
		});
	}

	// ------------------------------------------------------------------ click: done / not done
	private async onClick(evt: MouseEvent): Promise<void> {
		const cb = this.checkboxFrom(evt.target);
		if (!cb) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (Date.now() < this.suppressUntil) return; // the click that ends a long press
		const loc = this.locate(cb);
		if (!loc) return;
		const done = isDone(taskChar(await this.lineText(loc)));
		await this.applyToLine(loc, (text) => withSignifier(text, done ? " " : "x"));
	}

	// ------------------------------------------------------------------ right-click / long-press: the menu
	private onContextMenu(evt: MouseEvent): void {
		const cb = this.checkboxFrom(evt.target);
		if (!cb) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (Date.now() < this.suppressUntil) return; // the long press already opened the menu
		void this.openMenu(cb, { x: evt.clientX, y: evt.clientY });
	}

	private onTouchStart(evt: TouchEvent): void {
		const cb = this.checkboxFrom(evt.target);
		const touch = evt.touches[0];
		if (!cb || !touch || evt.touches.length !== 1) return;
		const pos = { x: touch.clientX, y: touch.clientY };
		this.cancelPress();
		this.pressTimer = window.setTimeout(() => {
			this.pressTimer = null;
			this.suppressUntil = Date.now() + AFTER_LONG_PRESS_MS;
			void this.openMenu(cb, pos);
		}, LONG_PRESS_MS);
	}

	private cancelPress(): void {
		if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
		this.pressTimer = null;
	}

	private async openMenu(cb: HTMLElement, pos: { x: number; y: number }): Promise<void> {
		const loc = this.locate(cb);
		if (!loc) return;
		const current = taskChar(await this.lineText(loc));
		const done = isDone(current);
		const doc = cb.ownerDocument;
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle(done ? "Mark not done" : "Mark done")
				.setIcon(done ? "circle" : "check")
				.onClick(() => void this.applyToLine(loc, (text) => withSignifier(text, done ? " " : "x"))),
		);
		menu.addSeparator();
		for (const sig of SIGNIFIERS) {
			menu.addItem((item) =>
				item
					.setTitle(
						createFragment((f) => {
							f.appendChild(glyphEl(sig, doc));
							f.createSpan({ text: ` ${sig.label}` });
							f.createSpan({ text: `  [${sig.char}]`, cls: "sws-hint" });
						}),
					)
					.setChecked(current === sig.char)
					.onClick(() => void this.applyToLine(loc, (text) => withSignifier(text, sig.char))),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Plain bullet")
				.setIcon("dot")
				.onClick(() => void this.applyToLine(loc, withoutSignifier)),
		);
		menu.showAtPosition(pos, doc);
	}

	// ------------------------------------------------------------------ commands
	private mapSelectedLines(editor: Editor, transform: (text: string) => string): void {
		const from = editor.getCursor("from").line;
		const to = editor.getCursor("to").line;
		for (let line = from; line <= to; line++) {
			const text = editor.getLine(line);
			if (!text.trim() && from !== to) continue;
			const next = transform(text);
			if (next !== text) editor.replaceRange(next, { line, ch: 0 }, { line, ch: text.length });
		}
	}

	// ------------------------------------------------------------------ Enter keeps the signifier
	private onKeyDown(evt: KeyboardEvent): void {
		if (evt.key !== "Enter" || evt.shiftKey || evt.altKey || evt.metaKey || evt.ctrlKey || evt.isComposing) return;
		const target = evt.target;
		if (!(target instanceof Element) || !target.closest(".markdown-source-view .cm-content")) return;
		if (target.ownerDocument.querySelector(".suggestion-container")) return; // a suggestion list owns Enter
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view ? (view.editor as EditorWithCm).cm : undefined;
		if (!cm || !cm.contentDOM.contains(target)) return;
		if (this.continueSignifier(cm)) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	private continueSignifier(view: EditorView): boolean {
		if (!this.settings.keepOnEnter) return false;
		const { state } = view;
		const sel = state.selection.main;
		if (!sel.empty || state.selection.ranges.length > 1) return false;
		const line = state.doc.lineAt(sel.head);
		if (sel.head !== line.to) return false;
		const m = line.text.match(/^(\s*)([-*+])(\s+)\[(.)\]\s(.*)$/);
		if (!m) return false;
		const [, indent = "", marker = "-", space = " ", char = " ", rest = ""] = m;
		if (char === " " || isDone(char)) return false; // tasks: Obsidian's own behavior
		if (!rest.trim()) {
			// An empty signifier line ends the list, as an empty task does
			view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from }, userEvent: "input" });
			return true;
		}
		const insert = `\n${indent}${marker}${space}[${char}] `;
		view.dispatch({
			changes: { from: sel.head, insert },
			selection: { anchor: sel.head + insert.length },
			scrollIntoView: true,
			userEvent: "input",
		});
		return true;
	}
}
