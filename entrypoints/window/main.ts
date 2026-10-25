import { mount } from 'svelte';
import Palette from '@/components/Palette.svelte';
import { loadSettings } from '@/lib/settings';

// Standalone window used where content scripts can't run (chrome:// pages, Web Store).
const tabId = Number(new URLSearchParams(location.search).get('tab'));
addEventListener('blur', () => close());
loadSettings().then((settings) => mount(Palette, { target: document.body, props: { onClose: () => close(), tabId, standalone: true, settings } }));
