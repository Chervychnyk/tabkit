import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatTargets, DEFAULT_SETTINGS, domainDisabled, hotkeyLabel, hotkeyOf, matchesHotkey, themeStyle, type Settings } from './settings.ts';

const keys = (o: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) =>
  ({ code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });

test('hotkeys', () => {
  assert.equal(hotkeyOf(keys({ metaKey: true }), true), 'Mod+KeyK');
  assert.equal(hotkeyOf(keys({ ctrlKey: true }), false), 'Mod+KeyK');
  assert.equal(hotkeyOf(keys({ ctrlKey: true, altKey: true, code: 'Space' }), true), 'Ctrl+Alt+Space');
  assert.ok(matchesHotkey(keys({ metaKey: true }), 'Mod+KeyK', true));
  assert.ok(!matchesHotkey(keys({ metaKey: true, shiftKey: true }), 'Mod+KeyK', true));
  assert.ok(!matchesHotkey(keys({ ctrlKey: true }), 'Mod+KeyK', true)); // Ctrl+K on a Mac is not ⌘K
  assert.equal(hotkeyLabel('Mod+Shift+KeyP', true), '⌘⇧P');
  assert.equal(hotkeyLabel('Mod+Digit1', false), 'Ctrl+1');
});

test('domainDisabled matches subdomains, not suffixes', () => {
  assert.ok(domainDisabled('github.com', ['github.com']));
  assert.ok(domainDisabled('gist.github.com', ['github.com']));
  assert.ok(!domainDisabled('notgithub.com', ['github.com']));
});

test('themeStyle', () => {
  assert.equal(themeStyle('system'), '');
  assert.match(themeStyle('nord'), /--bg:#2e3440;.*--on-accent:#111111;color-scheme:dark/);
  assert.equal(themeStyle('system', '#ffd60a'), '--accent:#ffd60a;--on-accent:#111111');
  assert.match(themeStyle('dark', '#5b21b6'), /color-scheme:dark;--accent:#5b21b6;--on-accent:#ffffff$/);
  assert.equal(themeStyle('nord', '#5b21b6'), themeStyle('nord')); // named themes keep their accent
});

test('chatTargets: keys, keyless opt-in, presets', () => {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ai: {
      default: '',
      providers: { ollama: { enabled: true, model: 'gemma' }, openai: { model: 'gpt-x' } },
      presets: [
        { id: 'p1', name: 'Translator', provider: 'ollama', system: 'Translate' },
        { id: 'p2', name: 'Orphan', provider: 'grok', system: '' }, // grok has no key
      ],
    },
  };
  const t = chatTargets(s, { openai: 'sk-1' });
  assert.deepEqual(t.map((x) => [x.id, x.model]), [['openai', 'gpt-x'], ['ollama', 'gemma'], ['preset:p1', 'gemma']]);
  assert.equal(t[2]!.system, 'Translate');
  // Ollama without a chosen model is not usable yet.
  assert.deepEqual(chatTargets({ ...s, ai: { ...s.ai, providers: { ollama: { enabled: true } }, presets: [] } }, {}), []);
});
