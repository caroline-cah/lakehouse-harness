// Bundles Lambda entrypoints with esbuild. One script for every Lambda package, so the settings live in one place.
//
// Usage (from a package): node ../../tooling/bundle-lambda.mjs src/handlers/adapter.ts [src/handlers/worker.ts ...]
// Each entry `src/handlers/<name>.ts` becomes the folder `dist/<name>/` holding `index.mjs` and its source map.
// Terraform zips that folder (infra/modules/lambda) and the function's handler is Lambda's default, `index.handler`.
//
// Choices, and why:
// - ESM output and a Node 24 target match the `nodejs24.x` runtime.
// - The AWS SDK is bundled, not taken from the runtime: the bundle pins the version the code was tested with, tree
//   shaking keeps only the clients used, and newer clients (bedrock-agentcore) are not guaranteed to be on the runtime.
// - Minified, with a source map next to the bundle. The functions run with NODE_OPTIONS=--enable-source-maps, so
//   stack traces in CloudWatch point at the TypeScript source.
// - The createRequire banner lets the few CommonJS dependencies inside the SDK resolve `require` from an ESM bundle.
import { createRequire } from "node:module";
import { basename, join } from "node:path";

// esbuild is a devDependency of each Lambda package, so resolve it from the package that runs the build, not from here.
const { build } = await import(createRequire(join(process.cwd(), "package.json")).resolve("esbuild"));

const entries = process.argv.slice(2);
if (entries.length === 0) {
  console.error("usage: bundle-lambda.mjs <src/handlers/name.ts> [...]");
  process.exit(1);
}

for (const entry of entries) {
  const name = basename(entry).replace(/\.ts$/, "");
  const result = await build({
    entryPoints: { index: entry },
    outdir: join("dist", name),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    minify: true,
    keepNames: true,
    sourcemap: true,
    metafile: true,
    logLevel: "warning",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const bytes = Object.entries(result.metafile.outputs).find(([file]) => file.endsWith(".mjs"))?.[1].bytes ?? 0;
  console.log(`dist/${name}/index.mjs: ${(bytes / 1024).toFixed(0)} kB`);
}
