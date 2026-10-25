import { mount, unmount } from 'svelte';
import Palette from '@/components/Palette.svelte';
import { loadSettings } from '@/lib/settings';

type Ui = { remove: () => void };
const g = globalThis as { __tabkitUi?: Ui | null };

// Injected by the background on each ⌘K; a second injection closes the open palette.
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  cssInjectionMode: 'ui',
  async main(ctx) {
    if (g.__tabkitUi) {
      g.__tabkitUi.remove();
      g.__tabkitUi = null;
      return;
    }
    const settings = await loadSettings();
    const close = () => {
      ui.remove();
      g.__tabkitUi = null;
    };
    const ui = await createShadowRootUi(ctx, {
      name: 'tabkit-palette',
      position: 'inline',
      anchor: 'html',
      isolateEvents: true,
      onMount: (target) => mount(Palette, { target, props: { onClose: close, settings } }),
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();
    g.__tabkitUi = ui;
  },
});
