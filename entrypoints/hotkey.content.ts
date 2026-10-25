import { DEFAULT_SETTINGS, domainDisabled, matchesHotkey } from '@/lib/settings';

// Always-on, tiny: only listens for the palette shortcut (⌘K / Ctrl+K by default). The palette is injected on demand.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const isMac = navigator.userAgent.includes('Mac');
    let { hotkey, disabledDomains } = DEFAULT_SETTINGS;
    const apply = (value: unknown) => {
      const s = value as Partial<typeof DEFAULT_SETTINGS> | undefined;
      hotkey = s?.hotkey ?? DEFAULT_SETTINGS.hotkey;
      disabledDomains = s?.disabledDomains ?? [];
    };
    browser.storage.sync.get('settings').then((r) => apply(r.settings));
    browser.storage.sync.onChanged.addListener((c) => c.settings && apply(c.settings.newValue));
    addEventListener(
      'keydown',
      (e) => {
        if (!matchesHotkey(e, hotkey, isMac) || domainDisabled(location.hostname, disabledDomains)) return;
        if (!browser.runtime?.id) return; // orphaned after an extension reload; let the fresh copy handle it
        e.preventDefault();
        e.stopPropagation();
        browser.runtime.sendMessage({ type: 'toggle' }).catch(() => {});
      },
      true,
    );
  },
});
