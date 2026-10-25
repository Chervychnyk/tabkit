import { defineConfig } from 'wxt';

// `npm run build:e2e`: browser tests can't click Chrome's permission prompt, so grant the data sources up front.
const E2E = !!process.env.WXT_E2E;
const DATA_SOURCE_PERMISSIONS = ['bookmarks', 'history', 'downloads', 'downloads.open', 'sessions', 'tabGroups'] as const;

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'TabCmdr (personal)',
    description: 'Command palette for tabs, bookmarks, history and more.',
    permissions: ['tabs', 'scripting', 'activeTab', 'storage', 'favicon', 'declarativeNetRequestWithHostAccess', ...(E2E ? DATA_SOURCE_PERMISSIONS : [])],
    // Data sources the user switches on in Settings (Data sources).
    optional_permissions: E2E ? [] : [...DATA_SOURCE_PERMISSIONS],
    // RSS feeds are fetched from the background, which needs host access to read cross-origin responses.
    host_permissions: ['<all_urls>'],
    action: {},
    commands: {
      'open-palette': {
        suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
        description: 'Open the command palette',
      },
    },
    web_accessible_resources: [{ resources: ['_favicon/*'], matches: ['<all_urls>'] }],
  },
});
