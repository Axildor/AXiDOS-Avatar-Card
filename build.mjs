import { build } from 'esbuild';
import { statSync, readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: false,
  outfile: 'axidos-card.js',
  legalComments: 'none',
  logLevel: 'info',
});

const size = statSync('axidos-card.js').size;
const kb = (size / 1024).toFixed(1);
console.log(`\nBuilt axidos-card.js (${kb} KB)`);
if (size > 120 * 1024) {
  console.warn('WARNING: bundle exceeds 120 KB — check for accidental dependency inclusion');
}

// ---- Standalone demo generation -------------------------------------------
// demo.template.html contains a single-line marker inside its inline
// <script type="module"> block. The marker LINE is replaced wholesale with
// the built bundle, producing a demo.html that runs offline via file://
// (inline module scripts are not CORS-blocked; external src fetches are).
const MARKER_LINE = '/* __AXIDOS_BUNDLE__ */';
const template = readFileSync('demo.template.html', 'utf8');
const lines = template.split('\n');
const markerLineIdx = lines.findIndex((l) => l.trim() === MARKER_LINE);
if (markerLineIdx === -1) {
  throw new Error('demo.template.html: __AXIDOS_BUNDLE__ marker line not found');
}
const bundle = readFileSync('axidos-card.js', 'utf8');
lines[markerLineIdx] = bundle;
writeFileSync('demo.html', lines.join('\n'));
const demoKb = (statSync('demo.html').size / 1024).toFixed(1);
console.log(`Built demo.html (${demoKb} KB, standalone — bundle inlined)`);