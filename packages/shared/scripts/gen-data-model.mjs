// Embeds data-model.yaml as a TS string constant so vitest, tsc and esbuild all consume plain TypeScript.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const yaml = readFileSync(`${here}/../src/data-model.yaml`, "utf8");
const out = `// GENERATED from data-model.yaml by scripts/gen-data-model.mjs. Do not edit.\nexport const DATA_MODEL_YAML = ${JSON.stringify(yaml)};\n`;
writeFileSync(`${here}/../src/data-model.generated.ts`, out);
