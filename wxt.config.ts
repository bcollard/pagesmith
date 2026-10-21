import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

/* Rolldown (Vite 8) annotates unminified chunks with `//#region <module id>`
   markers, and WXT's entrypoint ids carry the absolute path of the checkout.
   Left alone, every chunk would embed the builder's directory and the
   artifact would depend on where it was built, which breaks the
   reproducible-build check. Rewriting the root to a fixed token keeps the
   readable output; guard-build-paths.mjs asserts the result. */
const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

function normalizeBuildPaths() {
  return {
    name: 'pagesmith:normalize-build-paths',
    renderChunk(code: string) {
      return code.split(projectRoot).join('/pagesmith');
    },
  };
}

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  outDirTemplate: '{{browser}}',
  // Icons are generated into src/public by scripts/generate-icons.mjs, so the
  // shipped artifact is source-derived down to the toolbar icon.
  publicDir: 'src/public',
  vite: () => ({
    plugins: [normalizeBuildPaths()],
    build: {
      // Readable output is part of the provenance story: a reviewer can diff
      // the published bundle against the source.
      minify: false,
      sourcemap: false,
      // The modulepreload polyfill is the only fetch() Vite would add.
      // Chrome has supported modulepreload natively since 66.
      modulePreload: { polyfill: false },
    },
  }),
  manifest: {
    name: '__MSG_extName__',
    short_name: 'Pagesmith',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // OffscreenCanvas.convertToBlob and createImageBitmap in a service worker
    // are both well established by 116, and scroll behavior "instant" landed
    // in 113.
    minimum_chrome_version: '116',
    permissions: [
      // Temporary access to the tab the user is looking at, granted by the
      // toolbar click or shortcut. Covers captureVisibleTab and injecting the
      // page agent, with no host access at install.
      'activeTab',
      // Injects the page agent and its stylesheet into that one tab.
      'scripting',
      // Settings in storage.local, capture progress in storage.session.
      'storage',
    ],
    host_permissions: [],
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: '/icons/icon16.png',
        32: '/icons/icon32.png',
        48: '/icons/icon48.png',
        128: '/icons/icon128.png',
      },
    },
    icons: {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png',
    },
    commands: {
      // Opening the popup is what starts a capture, so the shortcut simply
      // opens it. Alt+Shift+P is avoided because GoFullPage, the most
      // installed extension of this kind, already suggests it.
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+S' },
      },
    },
  },
});
