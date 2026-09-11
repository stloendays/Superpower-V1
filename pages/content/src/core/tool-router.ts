export interface RoutableTool {
  name: string;
  description?: string;
  schema?: string;
}

export interface ToolRouterOptions {
  maxTools?: number;
  minScore?: number;
  /** Tool names that should always survive routing when present. */
  alwaysInclude?: string[];
}

export interface RankedTool<T extends RoutableTool> {
  tool: T;
  score: number;
  matchedTerms: string[];
}

export interface ToolRouteResult<T extends RoutableTool> {
  tools: T[];
  ranked: RankedTool<T>[];
  omitted: number;
  queryUsed: boolean;
}

const splitTerms = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9_]+/i)
    .map(term => term.trim())
    .filter(term => term.length >= 2);

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

const getSchemaSearchText = (schema?: string): string => {
  if (!schema) return '';

  try {
    const parsed = JSON.parse(schema);
    const names: string[] = [];

    const visit = (value: unknown, depth = 0): void => {
      if (!value || typeof value !== 'object' || depth > 3) return;
      const objectValue = value as Record<string, unknown>;
      const properties = objectValue.properties;

      if (properties && typeof properties === 'object') {
        Object.keys(properties as Record<string, unknown>).forEach(name => names.push(name));
        Object.values(properties as Record<string, unknown>).forEach(child => visit(child, depth + 1));
      }

      if (objectValue.items) visit(objectValue.items, depth + 1);
    };

    visit(parsed);
    return names.join(' ');
  } catch {
    // A malformed schema should never make routing fail. Search a bounded prefix only.
    return schema.slice(0, 2_000);
  }
};

/**
 * Lightweight lexical router for local, zero-latency tool selection.
 *
 * It intentionally avoids an embedding/model dependency. The goal is not to replace
 * semantic retrieval forever; it is to provide a deterministic first-stage router
 * that can safely reduce large tool catalogs before prompt injection.
 */
export const routeTools = <T extends RoutableTool>(
  tools: T[],
  query: string,
  options: ToolRouterOptions = {},
): ToolRouteResult<T> => {
  const maxTools = Math.max(1, options.maxTools ?? 12);
  const minScore = options.minScore ?? 1;
  const normalizedQuery = query.trim().toLowerCase();
  const queryTerms = unique(splitTerms(normalizedQuery));
  const alwaysInclude = new Set((options.alwaysInclude ?? []).map(name => name.toLowerCase()));

  // With no task context, preserve server/user ordering rather than pretending a
  // relevance score exists. ContextBudgetManager still applies a deterministic cap.
  if (!normalizedQuery || queryTerms.length === 0) {
    const selected = tools.slice(0, maxTools);
    return {
      tools: selected,
      ranked: selected.map(tool => ({ tool, score: 0, matchedTerms: [] })),
      omitted: Math.max(0, tools.length - selected.length),
      queryUsed: false,
    };
  }

  const ranked = tools.map((tool, index): RankedTool<T> & { index: number } => {
    const name = tool.name.toLowerCase();
    const nameTerms = new Set(splitTerms(tool.name));
    const descriptionTerms = new Set(splitTerms(tool.description ?? ''));
    const schemaTerms = new Set(splitTerms(getSchemaSearchText(tool.schema)));
    const matchedTerms: string[] = [];
    let score = 0;

    if (alwaysInclude.has(name)) score += 1_000;
    if (normalizedQuery.includes(name) && name.length >= 3) score += 120;

    queryTerms.forEach(term => {
      let matched = false;
      if (nameTerms.has(term) || name.includes(term)) {
        score += 24;
        matched = true;
      }
      if (descriptionTerms.has(term)) {
        score += 7;
        matched = true;
      }
      if (schemaTerms.has(term)) {
        score += 3;
        matched = true;
      }
      if (matched) matchedTerms.push(term);
    });

    return { tool, score, matchedTerms: unique(matchedTerms), index };
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);

  let selected = ranked.filter(item => item.score >= minScore).slice(0, maxTools);

  // Avoid an empty catalog on vague queries. A small ordered fallback is safer than
  // silently giving the assistant no tools at all.
  if (selected.length === 0) {
    selected = ranked.slice(0, Math.min(maxTools, 4));
  }

  return {
    tools: selected.map(item => item.tool),
    ranked: selected.map(({ tool, score, matchedTerms }) => ({ tool, score, matchedTerms })),
    omitted: Math.max(0, tools.length - selected.length),
    queryUsed: true,
  };
};
