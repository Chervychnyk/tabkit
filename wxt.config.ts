import { defineConfig } from 'wxt';

// `npm run build:e2e`: browser tests can't click Chrome's permission prompt, so grant the data sources up front.
const E2E = !!process.env.WXT_E2E;
const DATA_SOURCE_PERMISSIONS = ['bookmarks', 'history', 'downloads', 'downloads.open', 'sessions', 'tabGroups'] as const;

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Tabkit',
    // Pins the extension id (mfkkblanhdohfjjhffnpfdcbbgbhmmbd) so it no longer depends on this folder's path. Public key only;
    // the Chrome Web Store ignores it and assigns its own id.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyUWWfnYO1dsU7ZbhUiKW4CENnNyiUuplFMI/lEJvFKKtDZBss07CMf5CwwP2HGwxER7J2bqExBIhJn4taYVmu4Jqii3O20R5oY5bn4YjKubFucXrfzO6xot0Z8V25JLTDPPYwY6z65KB9eeR2iOhnbCX+WyL1Onk3Uo4OuWykQW8i0vwq/MW1UOZ2FmHmMisxDC4/hDp9pckYecgpcPVcKJNlHI+2yuhKYODTVfFQ64uKK3dFl/wf4hw/nRRE1YvINMwPbwKp2xhgxWzFGGUCLlBoeQqD8VSXZhxc217k6KJ4tBoTmkRu8UrQEJnxsIQPckYHkgGJMxDhADXiEsb3wIDAQAB',
    description: 'Command palette for tabs, bookmarks, history and more.',
    // e2e builds carry their build time, so a test can tell whether the browser runs this build or a stale one.
    ...(E2E && { version_name: new Date().toISOString() }),
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
