import { classifyField, looksProtected } from "./fields.js";
import type { SchemaColumn, SourceFile } from "./types.js";

const SQL_NON_COLUMN = /^(primary|foreign|constraint|unique|check|key|index|references|like|exclude|period)$/i;

function column(file: SourceFile, table: string, name: string, type: string, line: number, extraProtected = false): SchemaColumn {
  return {
    table,
    column: name,
    type,
    path: file.path,
    line,
    dataClass: classifyField(name),
    protected: extraProtected || looksProtected(name, type),
  };
}

function sqlColumns(file: SourceFile): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  let table: string | null = null;
  let depth = 0;
  file.lines.forEach((raw, index) => {
    const line = raw.replace(/--.*$/, "");
    if (table === null) {
      const create = line.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?(?:\w+["`\]]?\.["`[]?)?(\w+)["`\]]?\s*\(?/i);
      if (create) {
        table = create[1]!;
        depth = 0;
        const rest = line.slice((create.index ?? 0) + create[0].length);
        depth += create[0].endsWith("(") ? 1 : 0;
        depth += (rest.match(/\(/g) ?? []).length - (rest.match(/\)/g) ?? []).length;
        return;
      }
      const alter = line.match(/alter\s+table\s+(?:only\s+)?["`[]?(?:\w+["`\]]?\.["`[]?)?(\w+)["`\]]?\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?["`[]?(\w+)["`\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/i);
      if (alter) out.push(column(file, alter[1]!, alter[2]!, alter[3]!, index + 1));
      return;
    }
    if (depth === 1) {
      const col = line.match(/^\s*["`[]?(\w+)["`\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/);
      if (col && !SQL_NON_COLUMN.test(col[1]!)) out.push(column(file, table, col[1]!, col[2]!, index + 1));
    }
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    if (depth <= 0 && /[);]/.test(line)) table = null;
  });
  return out;
}

function prismaColumns(file: SourceFile): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  let model: string | null = null;
  file.lines.forEach((line, index) => {
    const start = line.match(/^\s*model\s+(\w+)\s*\{/);
    if (start) {
      model = start[1]!;
      return;
    }
    if (model === null) return;
    if (/^\s*\}/.test(line)) {
      model = null;
      return;
    }
    const field = line.match(/^\s*(\w+)\s+(\w+)(\[\])?[?!]?/);
    if (!field || /^\s*(\/\/|@@)/.test(line) || field[3]) return;
    if (/^[A-Z]/.test(field[2]!) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(field[2]!)) return;
    out.push(column(file, model, field[1]!, field[2]!, index + 1, /@encrypted/i.test(line)));
  });
  return out;
}

function jpaColumns(file: SourceFile): SchemaColumn[] {
  if (!/@Entity\b/.test(file.text)) return [];
  const out: SchemaColumn[] = [];
  let entity: string | null = null;
  file.lines.forEach((line, index) => {
    const cls = line.match(/\bclass\s+(\w+)/);
    if (cls) {
      const before = file.lines.slice(Math.max(0, index - 6), index + 1).join("\n");
      entity = /@Entity\b/.test(before) ? cls[1]! : null;
      return;
    }
    if (entity === null) return;
    const java = line.match(/^\s*(?:private|protected|public)\s+(?!static)(?:final\s+)?([\w<>,.\s[\]]+?)\s+(\w+)\s*(?:;|=)/);
    const kotlin = line.match(/^\s*(?:(?:private|protected|internal|open|lateinit)\s+)*va[lr]\s+(\w+)\s*:\s*([\w<>?.]+)/);
    const name = java?.[2] ?? kotlin?.[1];
    const type = java?.[1] ?? kotlin?.[2];
    if (!name || !type) return;
    const annotations = file.lines.slice(Math.max(0, index - 3), index + 1).join("\n");
    out.push(column(file, entity, name, type.trim(), index + 1, /@(Convert|ColumnTransformer|Encrypted)\b/.test(annotations)));
  });
  return out;
}

function pythonColumns(file: SourceFile): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  let model: string | null = null;
  file.lines.forEach((line, index) => {
    const cls = line.match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/);
    if (cls) {
      model = /\b(models\.Model|Base|DeclarativeBase|SQLModel|db\.Model)\b/.test(cls[2]!) ? cls[1]! : null;
      return;
    }
    if (model === null) return;
    if (/^\S/.test(line) && line.trim()) {
      model = null;
      return;
    }
    const field = line.match(/^\s+(\w+)\s*(?::\s*[^=]+)?=\s*((?:models\.\w+|db\.Column|Column|mapped_column|Field)\s*\([^\n]*)/);
    if (field) out.push(column(file, model, field[1]!, field[2]!, index + 1, /Encrypted|encrypt/i.test(field[2]!)));
  });
  return out;
}

/** Extract table and column definitions from SQL, Prisma, JPA entities, and Python ORM models. */
export function extractSchema(files: SourceFile[]): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  for (const file of files) {
    if (/\.sql$/i.test(file.path)) out.push(...sqlColumns(file));
    else if (/\.prisma$/i.test(file.path)) out.push(...prismaColumns(file));
    else if (/\.(java|kt)$/i.test(file.path)) out.push(...jpaColumns(file));
    else if (/\.py$/i.test(file.path)) out.push(...pythonColumns(file));
  }
  return out;
}
