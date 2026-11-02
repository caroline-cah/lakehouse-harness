// Compiles the Markdown data model (data-model/*.md: front matter = contract, body = meaning) into
// src/data-model.generated.ts for the TypeScript packages and data-model/data-model.json for Terraform.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = `${here}/../../../data-model`;

function read(file) {
  const text = readFileSync(`${dir}/${file}`, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: missing front matter`);
  return { meta: parse(m[1]), doc: m[2].trim() };
}

const index = read("README.md").meta;
const tables = {};
for (const name of index.tables) {
  const { meta, doc } = read(`${name}.md`);
  for (const key of ["description", "grain", "columns", "joins"]) if (meta[key] === undefined) throw new Error(`${name}.md: missing ${key}`);
  // An unquoted comma inside a flow mapping (`description: a, b`) silently becomes an extra key: refuse it.
  for (const c of meta.columns) {
    const extra = Object.keys(c).filter((k) => !["name", "type", "description", "pii"].includes(k));
    if (extra.length) throw new Error(`${name}.md: column ${c.name} has unknown keys ${extra.join(", ")}; quote descriptions that contain commas`);
  }
  tables[name] = { ...meta, doc };
}
const model = { database: index.database, forbidden_columns: index.forbidden_columns ?? [], tables, metrics: read("metrics.md").meta.metrics, examples: index.examples };

const json = JSON.stringify(model, null, 2);
writeFileSync(`${dir}/data-model.json`, json + "\n");
writeFileSync(`${here}/../src/data-model.generated.ts`, `// GENERATED from data-model/*.md by scripts/gen-data-model.mjs. Do not edit.\nexport const DATA_MODEL = ${json};\n`);
