import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface JsonTreeProps {
  data: unknown;
}

function isCollapsible(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  if (value === undefined) return <span className="italic text-muted-foreground">undefined</span>;
  if (typeof value === "string") return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === "number") return <span className="text-primary">{value}</span>;
  if (typeof value === "boolean") return <span className="text-warning">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({ label, value, depth }: { label?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(true);

  if (!isCollapsible(value)) {
    return (
      <div className="break-words" style={{ paddingLeft: depth * 12 }}>
        {label !== undefined && <span className="font-medium text-foreground">{label}: </span>}
        <Primitive value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  if (entries.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-1" style={{ paddingLeft: depth * 12 }}>
        {label !== undefined && <span className="font-medium text-foreground">{label}:</span>}
        <span className="text-muted-foreground">
          {openBracket}
          {closeBracket}
        </span>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label ?? "toggle"}
        className="flex items-center gap-1 break-words text-left hover:text-primary"
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        {label !== undefined && <span className="font-medium text-foreground">{label}:</span>}
        <span className="text-muted-foreground">
          {open ? openBracket : `${openBracket} ${entries.length} ${isArray ? "items" : "keys"} ${closeBracket}`}
        </span>
      </button>
      {open && (
        <div>
          {entries.map(([key, entryValue]) => (
            <JsonNode key={key} label={key} value={entryValue} depth={depth + 1} />
          ))}
          <div className="text-muted-foreground" style={{ paddingLeft: (depth + 1) * 12 }}>
            {closeBracket}
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonTree({ data }: JsonTreeProps) {
  return (
    <div className="font-mono text-xs">
      <JsonNode value={data} depth={0} />
    </div>
  );
}
