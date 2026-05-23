'use strict';
// Build script: produces SuccubusStats.exe via nw-builder.
// Run: npm install && npm run build
(async () => {
  const mod = await import('nw-builder');
  const nwbuild = mod.default || mod.nwbuild || mod;
  await nwbuild({
    srcDir: './{app.js,index.html,dashboard.css,package.json,vendor/**,icon.png,succubus.png}',
    mode: 'build',
    version: '0.82.0',
    flavor: 'normal',
    platform: 'win',
    arch: 'x64',
    outDir: './dist',
    glob: true,
    app: {
      name: 'SuccubusStats',
      version: '1.0.0',
      comments: 'Live owner dashboard for Succubus Games telemetry.'
    }
  });
  console.log('Build done. See ./dist');
})().catch((e) => { console.error(e); process.exit(1); });
