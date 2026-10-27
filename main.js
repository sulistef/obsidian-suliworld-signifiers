/* Suliworld Signifiers: bullet journal signifiers for Obsidian tasks.
 *
 * - Click on a task's checkbox: mark done / not done, the same for every signifier.
 * - Right-click or long-press: a menu to pick the signifier.
 * - Typing "- [" opens a list of signifiers (no need to type inside the brackets).
 * - Commands to set or cycle the signifier of the current lines.
 * - Enter on an event or a note continues with the same signifier.
 * - Draws the signifiers in notes (styles.css), so they work with any theme.
 *
 * Plain CommonJS, no build step: Obsidian provides "obsidian" and "@codemirror/*".
 */
const { Plugin, Menu, MarkdownView, EditorSuggest, PluginSettingTab, Setting, Platform } = require("obsidian");

const SIGNIFIERS = [
  { char: " ", id: "todo", label: "Task", glyph: "•" },
  { char: "x", id: "done", label: "Done", glyph: "×" },
  { char: "*", id: "event", label: "Event", glyph: "✱" },
  { char: "n", id: "note", label: "Note", glyph: "■" },
  { char: ">", id: "migrated", label: "Migrated", glyph: "›" },
  { char: "<", id: "scheduled", label: "Scheduled", glyph: "‹" },
  { char: "!", id: "important", label: "Important", glyph: "!" },
];

// "- [c] text", "1. [c] text" (indent, marker, spaces, "[", char, "]")
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;
// "- text" (a list item that is not a task yet)
const LIST_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)(?!\[.\])/;

const DEFAULT_SETTINGS = {
  drawSignifiers: true,
  keepOnEnter: true,
  autocomplete: true,
};

const LONG_PRESS_MS = 450;

function bySignifier(char) {
  return SIGNIFIERS.find((s) => s.char === char) || null;
}

/** The line text with its task character set to `char` (or turned into a task). */
function withSignifier(text, char) {
  if (TASK_RE.test(text)) return text.replace(TASK_RE, (_, a, _c, b) => a + char + b);
  if (LIST_RE.test(text)) return text.replace(LIST_RE, (m) => `${m}[${char}] `);
  const indent = text.match(/^\s*/)[0];
  return `${indent}- [${char}] ${text.slice(indent.length)}`;
}

/** The line text with its "[c] " removed (back to a plain bullet). */
function withoutSignifier(text) {
  return text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[.\]\s?/, "$1");
}

/** The symbol in use: the Suliworld theme's Style Settings value when set, else the default. */
function glyphText(sig, doc = document) {
  const v = getComputedStyle(doc.body).getPropertyValue(`--sw-bujo-${sig.id}-glyph`).trim();
  const unquoted = v.replace(/^["']|["']$/g, "");
  return unquoted || sig.glyph;
}

/** The symbol as real text (so native menus show it too), colored by CSS like the theme. */
function glyphEl(sig) {
  const span = createSpan({ cls: "sws-glyph", text: glyphText(sig) });
  span.dataset.sig = sig.id;
  return span;
}

class SignifierSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor, editor) {
    if (!this.plugin.settings.autocomplete) return null;
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const m = before.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[$/);
    if (!m) return null;
    // Obsidian may have auto-closed the bracket: replace it too
    const endCh = line[cursor.ch] === "]" ? cursor.ch + 1 : cursor.ch;
    return { start: { line: cursor.line, ch: m[1].length }, end: { line: cursor.line, ch: endCh }, query: "" };
  }

  getSuggestions() {
    return SIGNIFIERS;
  }

  renderSuggestion(sig, el) {
    el.addClass("sws-suggestion");
    el.appendChild(glyphEl(sig));
    el.createSpan({ text: sig.label, cls: "sws-label" });
    el.createSpan({ text: `[${sig.char}]`, cls: "sws-hint" });
  }

  selectSuggestion(sig) {
    if (!this.context) return;
    const { editor, start, end } = this.context;
    const text = `[${sig.char}] `;
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
  }
}

class SignifiersSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Draw signifiers")
      .setDesc("Show each signifier as its symbol (•, ×, ✱, ■, ›, ‹, !) in your notes. Turn it off if your theme already draws them. The Suliworld theme draws them itself, with your Style Settings.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.drawSignifiers).onChange(async (v) => {
          this.plugin.settings.drawSignifiers = v;
          this.plugin.applyDrawing();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Keep the signifier on a new line")
      .setDesc("Enter at the end of an event, a note or any other signifier starts a new line with the same signifier. Tasks keep Obsidian's behavior.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.keepOnEnter).onChange(async (v) => {
          this.plugin.settings.keepOnEnter = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Suggest signifiers after \"- [\"")
      .setDesc("Typing \"- [\" opens a list of signifiers to pick from.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autocomplete).onChange(async (v) => {
          this.plugin.settings.autocomplete = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}

module.exports = class SuliworldSignifiers extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.sectionContexts = new WeakMap(); // reading view: rendered block -> post-processor context
    this.suppressClickUntil = 0;
    this.pressTimer = null;

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
        editorCallback: (editor) => this.setOnSelection(editor, sig.char),
      });
    }
    this.addCommand({
      id: "cycle",
      name: "Cycle signifier",
      editorCallback: (editor) => {
        const line = editor.getLine(editor.getCursor().line);
        const m = line.match(TASK_RE);
        const i = m ? SIGNIFIERS.findIndex((s) => s.char === m[2]) : -1;
        this.setOnSelection(editor, SIGNIFIERS[(i + 1) % SIGNIFIERS.length].char);
      },
    });
    this.addCommand({
      id: "plain",
      name: "Remove signifier (plain bullet)",
      editorCallback: (editor) => this.mapSelectedLines(editor, withoutSignifier),
    });

    this.addSettingTab(new SignifiersSettingTab(this.app, this));
  }

  onunload() {
    for (const doc of this.documents()) doc.body.classList.remove("sw-signifiers-plugin", "sws-draw");
    this.cancelPress();
  }

  /** Listeners and body classes for one window (the main one, and each popout window). */
  registerWindow(win) {
    const doc = win.document;
    doc.body.classList.add("sw-signifiers-plugin");
    doc.body.classList.toggle("sws-draw", this.settings.drawSignifiers);
    // Capture phase, so Obsidian's own checkbox toggle never runs
    this.registerDomEvent(doc, "click", (evt) => this.onClick(evt), { capture: true });
    this.registerDomEvent(doc, "contextmenu", (evt) => this.onContextMenu(evt), { capture: true });
    this.registerDomEvent(doc, "touchstart", (evt) => this.onTouchStart(evt), { capture: true, passive: true });
    this.registerDomEvent(doc, "touchend", () => this.cancelPress(), { capture: true });
    this.registerDomEvent(doc, "touchmove", () => this.cancelPress(), { capture: true, passive: true });
    // Enter is caught before CodeMirror (capture phase): list plugins such as Outliner
    // also bind Enter at the highest precedence, so a CodeMirror keymap would lose.
    this.registerDomEvent(doc, "keydown", (evt) => this.onKeyDown(evt), { capture: true });
  }

  documents() {
    const docs = new Set([document]);
    this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return docs;
  }

  applyDrawing() {
    for (const doc of this.documents()) doc.body.classList.toggle("sws-draw", this.settings.drawSignifiers);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ------------------------------------------------------------ locating a checkbox's line
  checkboxFrom(target) {
    const cb = target && target.closest ? target.closest(".task-list-item-checkbox") : null;
    return cb && cb.closest(".markdown-source-view, .markdown-preview-view") ? cb : null;
  }

  /** { file, line, editor? } for a checkbox, in Live Preview or in reading view. */
  locate(cb) {
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view instanceof MarkdownView && l.view.containerEl.contains(cb));
    if (!leaf) return null;
    const view = leaf.view;

    if (cb.closest(".markdown-source-view")) {
      const cm = view.editor && view.editor.cm;
      if (!cm) return null;
      const line = cm.state.doc.lineAt(cm.posAtDOM(cb)).number - 1;
      return { file: view.file, line, editor: view.editor };
    }

    // Reading view: the post-processor context of the rendered block + the item's line offset
    let block = cb.parentElement;
    while (block && !this.sectionContexts.has(block)) block = block.parentElement;
    const li = cb.closest("li[data-line]");
    if (!block || !li) return null;
    const info = this.sectionContexts.get(block).getSectionInfo(block);
    if (!info) return null;
    return { file: view.file, line: info.lineStart + Number(li.dataset.line) };
  }

  async currentChar(loc) {
    const text = loc.editor ? loc.editor.getLine(loc.line) : (await this.app.vault.cachedRead(loc.file)).split("\n")[loc.line];
    const m = text && text.match(TASK_RE);
    return m ? m[2] : null;
  }

  async applyToLine(loc, transform) {
    if (loc.editor) {
      const text = loc.editor.getLine(loc.line);
      const next = transform(text);
      if (next !== text) loc.editor.replaceRange(next, { line: loc.line, ch: 0 }, { line: loc.line, ch: text.length });
      return;
    }
    await this.app.vault.process(loc.file, (data) => {
      const lines = data.split("\n");
      if (loc.line < lines.length) lines[loc.line] = transform(lines[loc.line]);
      return lines.join("\n");
    });
  }

  // ------------------------------------------------------------ click: done / not done
  async onClick(evt) {
    const cb = this.checkboxFrom(evt.target);
    if (!cb) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (Date.now() < this.suppressClickUntil) return; // the click that ends a long press
    const loc = this.locate(cb);
    if (!loc) return;
    const char = await this.currentChar(loc);
    await this.applyToLine(loc, (t) => withSignifier(t, char === "x" || char === "X" ? " " : "x"));
  }

  // ------------------------------------------------------------ right-click / long-press: the menu
  onContextMenu(evt) {
    const cb = this.checkboxFrom(evt.target);
    if (!cb) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (Date.now() < this.suppressClickUntil) return; // the long press already opened the menu
    this.openMenu(cb, { x: evt.clientX, y: evt.clientY });
  }

  onTouchStart(evt) {
    const cb = this.checkboxFrom(evt.target);
    if (!cb || evt.touches.length !== 1) return;
    const t = evt.touches[0];
    this.cancelPress();
    this.pressTimer = activeWindow.setTimeout(() => {
      this.pressTimer = null;
      this.suppressClickUntil = Date.now() + 700;
      this.openMenu(cb, { x: t.clientX, y: t.clientY });
    }, LONG_PRESS_MS);
  }

  cancelPress() {
    if (this.pressTimer) activeWindow.clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  async openMenu(cb, pos) {
    const loc = this.locate(cb);
    if (!loc) return;
    const current = await this.currentChar(loc);
    const done = current === "x" || current === "X";
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(done ? "Mark not done" : "Mark done")
        .setIcon(done ? "circle" : "check")
        .onClick(() => this.applyToLine(loc, (t) => withSignifier(t, done ? " " : "x"))),
    );
    menu.addSeparator();
    for (const sig of SIGNIFIERS) {
      menu.addItem((item) => {
        const title = createFragment((f) => {
          f.appendChild(glyphEl(sig));
          f.createSpan({ text: ` ${sig.label}` });
          f.createSpan({ text: `  [${sig.char}]`, cls: "sws-hint" });
        });
        item
          .setTitle(title)
          .setChecked(current === sig.char)
          .onClick(() => this.applyToLine(loc, (t) => withSignifier(t, sig.char)));
      });
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Plain bullet")
        .setIcon("dot")
        .onClick(() => this.applyToLine(loc, withoutSignifier)),
    );
    menu.showAtPosition(pos, cb.ownerDocument);
  }

  // ------------------------------------------------------------ commands
  mapSelectedLines(editor, transform) {
    const from = editor.getCursor("from").line;
    const to = editor.getCursor("to").line;
    for (let l = from; l <= to; l++) {
      const text = editor.getLine(l);
      if (!text.trim() && from !== to) continue;
      const next = transform(text);
      if (next !== text) editor.replaceRange(next, { line: l, ch: 0 }, { line: l, ch: text.length });
    }
  }

  setOnSelection(editor, char) {
    this.mapSelectedLines(editor, (t) => withSignifier(t, char));
  }

  // ------------------------------------------------------------ Enter keeps the signifier
  onKeyDown(evt) {
    if (evt.key !== "Enter" || evt.shiftKey || evt.altKey || evt.metaKey || evt.ctrlKey || evt.isComposing) return;
    if (!evt.target || !evt.target.closest || !evt.target.closest(".markdown-source-view .cm-content")) return;
    if (evt.target.ownerDocument.querySelector(".suggestion-container")) return; // a suggestion list owns Enter
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = view && view.editor && view.editor.cm;
    if (!cm || !cm.contentDOM.contains(evt.target)) return;
    if (this.continueSignifier(cm)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  continueSignifier(view) {
    if (!this.settings.keepOnEnter) return false;
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(sel.head);
    if (sel.head !== line.to) return false;
    const m = line.text.match(/^(\s*)([-*+])(\s+)\[(.)\]\s(.*)$/);
    if (!m) return false;
    const [, indent, marker, space, char, rest] = m;
    if (char === " " || char === "x" || char === "X") return false; // tasks: Obsidian's own behavior
    if (!rest.trim()) {
      // An empty signifier line ends the list, as an empty task does in Obsidian
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
};
