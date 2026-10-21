import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

/** Host loaders load a single UMD script, so styles must travel with that script. */
function inlineCss(pluginId: string): Plugin {
  return { name: 'kimpo-im-next-inline-css', apply: 'build', enforce: 'post', generateBundle(_, bundle) {
    let css = '';
    for (const [name, asset] of Object.entries(bundle)) {
      if (asset.type === 'asset' && name.endsWith('.css')) { css += String(asset.source); delete bundle[name]; }
    }
    if (!css) return;
    const marker = `kimpo-plugin-style-${pluginId}`;
    const code = `(function(){try{if(typeof document==='undefined'||document.querySelector('style[data-marker="${marker}"]'))return;var s=document.createElement('style');s.dataset.marker='${marker}';s.textContent=${JSON.stringify(css)};document.head.appendChild(s)}catch(_){}})();`;
    Object.values(bundle).forEach(chunk => { if (chunk.type === 'chunk' && chunk.isEntry) chunk.code += code; });
  }};
}

export default defineConfig({
  plugins: [vue(), inlineCss('im-next')],
  build: {
    lib: { entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)), name: 'KimpoPlugins.imNext', fileName: () => 'plugin.umd.js', formats: ['umd'] },
    rollupOptions: { external: ['vue'], output: { globals: { vue: 'Vue' } } }
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
