import { Command, Editor, MarkdownPostProcessorContext, MarkdownView, Menu, Notice, Plugin, requireApiVersion, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { defaultSettings, importLegacy, loadSettings, type SignifiersSettings } from "./config";
import { drawingCss } from "./drawing";
import { SignifiersSettingTab } from "./settings";
import { SignifierSuggest } from "./suggest";
import {
	glyphEl,
	isDone,
	type Signifier,
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
	settings: SignifiersSettings = defaultSettings();
	private drawingWindows = new Map<Document, { style: HTMLStyleElement; observer: MutationObserver; legacy: boolean }>();
	private signifierCommands = new Map<string, Command>();
	private saveQueue: Promise<void> = Promise.resolve();
	/** Reading view: each rendered block holding tasks, with its post-processor context. */
	private sectionContexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
	private suppressUntil = 0;
	private pressTimer: number | null = null;

	async onload(): Promise<void> {
		const raw = await this.loadData() as Partial<SignifiersSettings> | null;
		this.settings = loadSettings(raw);
		if (!Array.isArray(raw?.signifiers) && raw?.schemaVersion !== 1) {
			const path = `${this.app.vault.configDir}/plugins/obsidian-style-settings/data.json`;
			try {
				const legacy: unknown = await this.app.vault.adapter.exists(path)
					? JSON.parse(await this.app.vault.adapter.read(path)) : {};
				importLegacy(this.settings, legacy, raw);
				await this.saveData(this.settings);
			} catch {
				// Leave migration pending if the legacy file could not be read.
				new Notice("Could not import old signifier settings. The plugin will use defaults and retry on its next load.");
			}
		}

		this.registerWindow(window);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const win = leaf.view.containerEl.ownerDocument.defaultView;
			if (win) this.registerWindow(win);
		});
		this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => this.registerWindow(win)));

		this.registerMarkdownPostProcessor((el, ctx) => {
			if (el.querySelector(".task-list-item-checkbox")) this.sectionContexts.set(el, ctx);
		});

		this.registerEditorSuggest(new SignifierSuggest(this));

		this.syncSignifierCommands();
		this.addCommand({
			id: "cycle",
			name: "Cycle signifier",
			editorCallback: (editor) => {
				const current = taskChar(editor.getLine(editor.getCursor().line));
				const signifiers = this.settings.signifiers;
				const i = signifiers.findIndex((s) => s.char === (current === "X" ? "x" : current));
				const next = signifiers[(i + 1) % signifiers.length];
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
		for (const [doc, drawing] of this.drawingWindows) {
			drawing.observer.disconnect();
			drawing.style.remove();
			doc.body.removeClasses(["sw-signifiers-plugin", "sws-draw"]);
			if (drawing.legacy) doc.body.addClass("sw-bujo");
		}
		this.drawingWindows.clear();
		this.cancelPress();
	}

	async saveSettings(): Promise<void> {
		this.applyDrawing();
		this.syncSignifierCommands();
		const snapshot = structuredClone(this.settings);
		this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
		await this.saveQueue;
	}

	/** Body classes and listeners for one window: the main one, and each popout window. */
	private registerWindow(win: Window): void {
		const doc = win.document;
		if (this.drawingWindows.has(doc)) return;
		// Dynamic selectors follow user-defined Markdown characters, so they cannot live in static styles.css.
		const style = doc.createElement("style");
		style.dataset.sws = "signifiers";
		doc.head.appendChild(style);
		// Compatibility with pre-separation Suliworld releases. Restore the legacy
		// class on unload; never mutate Style Settings' saved data.
		const drawing = { style, legacy: doc.body.hasClass("sw-bujo"), observer: new MutationObserver(() => {
			if (doc.body.hasClass("sw-bujo")) {
				drawing.legacy = true;
				doc.body.removeClass("sw-bujo");
			}
		}) };
		doc.body.removeClass("sw-bujo");
		drawing.observer.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
		this.drawingWindows.set(doc, drawing);
		doc.body.addClass("sw-signifiers-plugin");
		this.applyDrawing();
		this.registerDomEvent(win, "unload", () => {
			drawing.observer.disconnect();
			this.drawingWindows.delete(doc);
		});
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

	applyDrawing(): void {
		const css = drawingCss(this.settings);
		for (const [doc, drawing] of this.drawingWindows) {
			doc.body.toggleClass("sws-draw", this.settings.drawSignifiers);
			drawing.style.textContent = css;
			for (const element of Array.from(doc.querySelectorAll<HTMLElement>(".sws-glyph[data-sig]"))) {
				const sig = this.settings.signifiers.find((item) => item.id === element.dataset.sig);
				if (sig) element.textContent = sig.glyph;
			}
		}
	}

	/** Settings can live in a separate window that isn't a workspace Markdown leaf. */
	preparePreview(doc: Document): void {
		if (doc.defaultView) this.registerWindow(doc.defaultView);
	}

	previewColor(sig: Signifier, mode: "light" | "dark", doc: Document): string {
		const probe = glyphEl(sig, doc);
		const container = doc.adoptNode(createDiv());
		container.addClasses(["sw-signifiers-plugin", `theme-${mode}`]);
		// Color rules use the body theme, so resolve inherited automatic colors in
		// the current theme; explicit light/dark colors are shown by the picker.
		container.appendChild(probe);
		doc.body.appendChild(container);
		const rgb = doc.defaultView?.getComputedStyle(probe).color.match(/\d+/g);
		container.remove();
		return rgb && rgb.length >= 3 ? `#${rgb.slice(0, 3).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}` : "#808080";
	}

	private syncSignifierCommands(): void {
		for (const [id, command] of this.signifierCommands) {
			if (this.settings.signifiers.some((sig) => sig.id === id)) continue;
			if (requireApiVersion("1.7.2")) {
				this.removeCommand(`set-${id}`);
				this.signifierCommands.delete(id);
			} else command.name = "Removed signifier";
		}
		for (const sig of this.settings.signifiers) {
			const name = `Set signifier: ${sig.label} [${sig.char}]`;
			const command = this.signifierCommands.get(sig.id);
			if (command) { command.name = `${this.manifest.name}: ${name}`; continue; }
			const id = sig.id;
			this.signifierCommands.set(id, this.addCommand({
				id: `set-${id}`, name,
				editorCheckCallback: (checking, editor) => {
					const current = this.settings.signifiers.find((item) => item.id === id);
					if (!current) return false;
					if (!checking) this.mapSelectedLines(editor, (text) => withSignifier(text, current.char));
					return true;
				},
			}));
		}
	}

	// ------------------------------------------------------------------ locating a checkbox's line
	private checkboxFrom(target: EventTarget | null): HTMLElement | null {
		if (!target || !(target as Element).closest) return null;
		const cb = (target as Element).closest<HTMLElement>(".task-list-item-checkbox");
		const char = cb?.closest(".HyperMD-task-line, li[data-task]")?.getAttribute("data-task");
		if (char === null || char === undefined || !this.settings.signifiers.some((sig) => sig.char === (char === "" ? " " : char) || (sig.id === "done" && char === "X"))) return null;
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
		const loc = this.locate(cb);
		if (!loc) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (Date.now() < this.suppressUntil) return; // the click that ends a long press
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
		for (const sig of this.settings.signifiers) {
			menu.addItem((item) =>
				item
					.setTitle(
						createFragment((f) => {
							f.appendChild(glyphEl(sig, doc));
							f.createSpan({ text: ` ${sig.label}` });
							f.createSpan({ text: `  [${sig.char}]`, cls: "sws-hint" });
						}),
					)
					.setChecked(current === sig.char || (sig.id === "done" && isDone(current)))
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
		if (!target || !(target as Element).closest?.(".markdown-source-view .cm-content")) return;
		const element = target as Element;
		if (element.ownerDocument.querySelector(".suggestion-container")) return; // a suggestion list owns Enter
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view ? (view.editor as EditorWithCm).cm : undefined;
		if (!cm || !cm.contentDOM.contains(element)) return;
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
		if (char === " " || isDone(char) || !this.settings.signifiers.some((sig) => sig.char === char)) return false; // tasks: Obsidian's own behavior
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
