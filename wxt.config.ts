import { defineConfig } from 'wxt';

// WXT auto-generates the MV3 manifest from this config + entrypoints.
// Permissions strategy (plan §8): start narrow. `storage` + `activeTab` +
// `scripting` for the MVP skeleton. `declarativeNetRequest` and broad host
// permissions are added later as opt-in, so we keep them out of the install
// prompt for now.
export default defineConfig({
  manifest: {
    name: 'Fraud Watch',
    description:
      'Local-first fraud defense. Watches for high-risk moments, extracts minimal redacted evidence, runs local detectors, and warns before harm occurs.',
    permissions: ['storage', 'activeTab', 'scripting'],
    // Opt-in host access for the OPTIONAL AI-text detector. We do not request
    // any host at install; when the user configures a self-hosted sloptotal
    // endpoint, the popup requests permission for just that origin at runtime
    // (plan §8: optional host permissions, granted by explicit consent).
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // Host permissions are intentionally minimal for the skeleton. The content
    // script below declares <all_urls> so we can demonstrate end-to-end, but a
    // production build should move this behind optional_host_permissions and an
    // explicit "protect all sites" opt-in (plan §8, §15 Risk 1).
    action: {
      default_title: 'Fraud Watch',
    },
  },
});
