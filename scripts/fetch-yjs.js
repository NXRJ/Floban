// One-time dev script: bundles Yjs into a single self-contained browser file
// at vendor/yjs.js, which is COMMITTED. Run: npm run yjs
//
// Why a bundling step exists here, in a project that prides itself on having
// no build step: yjs does not ship a standalone browser build. Its dist/yjs.mjs
// carries 19 bare `lib0/*` imports, so it cannot simply be downloaded and
// dropped in the way scripts/fetch-fonts.js handles fonts. The bundling happens
// ONCE, here, and the artifact is committed — so nobody running or contributing
// to the app ever needs a build step. esbuild is a devDependency used only when
// re-vendoring.
//
// Output format is IIFE with a `Y` global, deliberately: the app loads classic
// <script> tags, and ES modules are blocked by CORS on file:// — which the app
// supports. A classic script keeps offline and file:// use working unchanged.
//
// Deliberately NOT vendored: y-websocket. Its dist leaves lib0 and y-protocols
// external, and we host both ends of the connection, so wire compatibility with
// the reference server buys nothing. The provider speaks a minimal protocol
// over Yjs's own public update API instead.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'vendor');
const OUT_FILE = path.join(OUT_DIR, 'yjs.js');
const PKG = require(path.join(ROOT, 'node_modules', 'yjs', 'package.json'));

// A bundle that still contains a bare import would fail silently in the
// browser, so verify rather than trust.
function assertSelfContained(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) specifiers.add(m[1]);
  }
  const bare = [...specifiers].filter((s) => !s.startsWith('./') && !s.startsWith('../'));
  if (bare.length > 0) {
    throw new Error('Bundle is not self-contained; it still references: ' + bare.join(', '));
  }
}

async function main() {
  process.stdout.write('Bundling yjs@' + PKG.version + ' …\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'node_modules', 'yjs', 'dist', 'yjs.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'Y',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'silent'
  });

  const banner =
    '/* yjs v' + PKG.version + ' — MIT (Kevin Jahns). Bundled by scripts/fetch-yjs.js.\n' +
    '   Do not edit by hand; re-run `npm run yjs` to regenerate. */\n';
  const source = banner + result.outputFiles[0].text;
  assertSelfContained(result.outputFiles[0].text);

  fs.writeFileSync(OUT_FILE, source.replace(/\r\n/g, '\n'), 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(OUT_FILE)).digest('hex');
  process.stdout.write(
    'Wrote ' + path.relative(process.cwd(), OUT_FILE) + '\n' +
    '  version: ' + PKG.version + '\n' +
    '  bytes:   ' + fs.statSync(OUT_FILE).size + '\n' +
    '  sha256:  ' + sha + '\n' +
    '  global:  window.Y\n'
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.message ? err.message : err) + '\n');
  process.exit(1);
});
