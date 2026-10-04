import { build } from 'esbuild';

export async function bundlePdf(outfile) {
  await build({
    entryPoints: ['web/pdf-export.js'], outfile, bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    legalComments: 'linked',
  });
}
