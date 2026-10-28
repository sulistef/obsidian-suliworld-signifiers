import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'sws-tests-'));
try {
    await build({ entryPoints: ['src/config.ts', 'src/drawing.ts', 'src/signifiers.ts'], outdir: directory, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
    const { defaultSettings, loadSettings, importLegacy, characterError } = await import(pathToFileURL(join(directory, 'config.mjs')));
    const { drawingCss } = await import(pathToFileURL(join(directory, 'drawing.mjs')));
    const { withSignifier, withoutSignifier, taskChar } = await import(pathToFileURL(join(directory, 'signifiers.mjs')));
    let count = 0;
    const test = (name, run) => { run(); count++; process.stdout.write(`✓ ${name}\n`); };
    test('Defaults are independent between plugin instances', () => {
        const first = defaultSettings();
        first.signifiers[0].glyph = 'test';
        assert.equal(defaultSettings().signifiers[0].glyph, '•');
    });
    test('Imports old symbols, themed colors, size and enablement', () => {
        const settings = defaultSettings();
        importLegacy(settings, {
            'suliworld@@sw-bujo': false,
            'suliworld@@sw-bujo-size': 1.3,
            'suliworld@@sw-bujo-event-glyph': '☀',
            'suliworld@@sw-bujo-event-color@@light': '#0190DA',
            'suliworld@@sw-bujo-event-color@@dark': '#2FD9DE',
        }, null);
        assert.equal(settings.drawSignifiers, false);
        assert.equal(settings.size, 1.3);
        assert.deepEqual(settings.signifiers.find(s => s.id === 'event'), {
            id: 'event', char: '*', label: 'Event', glyph: '☀', colorLight: '#0190DA', colorDark: '#2FD9DE', disc: false,
        });
    });
    test('Migration preserves existing plugin choices and never reimports a new configuration', () => {
        const settings = defaultSettings();
        importLegacy(settings, { 'suliworld@@sw-bujo': false }, { drawSignifiers: true });
        assert.equal(settings.drawSignifiers, true);
        settings.signifiers[0].glyph = '○';
        importLegacy(settings, { 'suliworld@@sw-bujo-todo-glyph': 'old' }, settings);
        assert.equal(settings.signifiers[0].glyph, '○');
    });
    test('Custom definitions and removed presets survive a reload', () => {
        const settings = defaultSettings();
        settings.signifiers = settings.signifiers.filter(s => s.id !== 'note');
        settings.signifiers.push({ id: 'custom-test', char: '?', label: 'Question', glyph: '❓', colorLight: '#123456', colorDark: '', disc: true });
        assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
    });
    test('Rejects duplicate, reserved, multiline and unsupported task characters', () => {
        for (const char of ['*', 'x', 'X', ' ', '[', ']', '\n', 'ab', '😀']) assert.ok(characterError(char, 'custom-test', defaultSettings().signifiers));
        assert.equal(characterError('?', 'custom-test', defaultSettings().signifiers), undefined);
    });
    test('Repairs corrupt saved data and reserves the standard task states', () => {
        const settings = loadSettings({ size: Infinity, signifiers: [
            { id: 'todo', char: '?' }, { id: 'custom-a', char: 'x' },
            { id: 'custom-b', char: '?', colorLight: 'red; } body { display: none' },
            { id: 'custom-c', char: '?' }, { id: 'bad"]{}', char: '!' },
        ] });
        assert.deepEqual(settings.signifiers.map(s => [s.id, s.char]), [['todo', ' '], ['done', 'x'], ['custom-b', '?']]);
        assert.equal(settings.signifiers[2].colorLight, '');
        assert.equal(settings.size, 1.1);
        assert.equal(loadSettings({ size: 999 }).size, 1.6);
    });
    test('CSS uses only plugin variables, handles uppercase done and escapes custom glyphs', () => {
        const settings = defaultSettings();
        settings.signifiers[2].glyph = '"; } body { display: none; /*';
        settings.signifiers.push({ id: 'custom-test', char: '"', label: 'Quote', glyph: '\\', colorLight: '', colorDark: '', disc: false });
        const css = drawingCss(settings);
        assert.ok(css.includes('[data-task="X"]'));
        assert.ok(css.includes('\\22 '));
        assert.ok(css.includes('\\5c '));
        assert.ok(!css.includes('--sw-bujo'));
        assert.ok(!css.includes('var(--sw-'));
        assert.ok(!css.includes('--sws-glyph: ""; } body'));
    });
    test('Markdown transformations preserve indentation, ordered markers and content', () => {
        assert.equal(withSignifier('  2. [n] Text', '?'), '  2. [?] Text');
        assert.equal(withSignifier('  + Text', '?'), '  + [?] Text');
        assert.equal(withSignifier('Text', '?'), '- [?] Text');
        assert.equal(withoutSignifier('  - [?] Text'), '  - Text');
        assert.equal(taskChar('3. [X] Text'), 'X');
    });
    process.stdout.write(`${count} checks passed.\n`);
} finally {
    await rm(directory, { recursive: true, force: true });
}
