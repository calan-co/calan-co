// Pure Pi session-tree helpers for the session-move split engine.
// No filesystem or Honcho side effects. Not wired into command execution yet.

export type PiSessionEntry = {
  type: string;
  id: string;
  parentId?: string | null;
  message?: { role?: string; content?: unknown };
  firstKeptEntryId?: string;
  targetId?: string;
  fromId?: string;
  [key: string]: unknown;
};

export type DroppedEntry = {
  id: string;
  type: string;
  reason: string;
};

export type SplitTreePlan = {
  sourceEntries: PiSessionEntry[];
  targetEntries: PiSessionEntry[];
  sourceActiveLeafBefore: string | null;
  sourceActiveLeafAfter: string | null;
  targetActiveLeafAfter: string | null;
  splitParentId: string | null;
  targetRootEntryId: string;
  sourceNeedsLeafMarker: boolean;
  targetNeedsLeafMarker: boolean;
  droppedEntries: DroppedEntry[];
  warnings: string[];
};

export function activeLeafId(entries: readonly PiSessionEntry[]): string | null {
  return entries.length === 0 ? null : entries[entries.length - 1]!.id;
}

export function indexEntries(entries: readonly PiSessionEntry[]): Map<string, PiSessionEntry> {
  const byId = new Map<string, PiSessionEntry>();
  for (const entry of entries) {
    if (!entry.id) throw new Error(`Session entry missing id: ${JSON.stringify(entry)}`);
    if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    byId.set(entry.id, entry);
  }
  return byId;
}

export function pathIdsToRoot(entries: readonly PiSessionEntry[], leafId: string | null = activeLeafId(entries)): string[] {
  if (leafId === null) return [];
  const byId = indexEntries(entries);
  const path: string[] = [];
  let current = byId.get(leafId);
  if (!current) throw new Error(`Leaf entry not found: ${leafId}`);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) throw new Error(`Cycle detected while walking path at entry: ${current.id}`);
    seen.add(current.id);
    path.push(current.id);
    const parentId = current.parentId ?? null;
    current = parentId === null ? undefined : byId.get(parentId);
    if (parentId !== null && !current) throw new Error(`Broken parent link: ${path[path.length - 1]} -> ${parentId}`);
  }
  return path.reverse();
}

export function descendantIds(entries: readonly PiSessionEntry[], rootId: string): Set<string> {
  const byId = indexEntries(entries);
  if (!byId.has(rootId)) throw new Error(`Root entry not found: ${rootId}`);
  const children = new Map<string | null, string[]>();
  for (const entry of entries) {
    const parentId = entry.parentId ?? null;
    const existing = children.get(parentId) ?? [];
    existing.push(entry.id);
    children.set(parentId, existing);
  }

  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

export function validateParentLinks(entries: readonly PiSessionEntry[]): void {
  const byId = indexEntries(entries);
  for (const entry of entries) {
    const parentId = entry.parentId ?? null;
    if (parentId !== null && !byId.has(parentId)) {
      throw new Error(`Broken parent link in output: ${entry.id} -> ${parentId}`);
    }
  }
}

function withoutExternalLabels(entries: readonly PiSessionEntry[], droppedEntries: DroppedEntry[]): PiSessionEntry[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.filter((entry) => {
    if (entry.type !== "label") return true;
    const targetId = typeof entry.targetId === "string" ? entry.targetId : undefined;
    if (targetId && ids.has(targetId)) return true;
    droppedEntries.push({
      id: entry.id,
      type: entry.type,
      reason: `label target is outside output slice: ${targetId ?? "<missing>"}`,
    });
    return false;
  });
}

function rejectBrokenCompactions(entries: readonly PiSessionEntry[], label: string): void {
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    if (entry.type !== "compaction") continue;
    if (typeof entry.firstKeptEntryId !== "string" || !ids.has(entry.firstKeptEntryId)) {
      throw new Error(`${label} compaction ${entry.id} has firstKeptEntryId outside output slice: ${String(entry.firstKeptEntryId)}`);
    }
  }
}

function warnExternalBranchSummaries(entries: readonly PiSessionEntry[], label: string, warnings: string[]): void {
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    if (entry.type !== "branch_summary") continue;
    if (typeof entry.fromId === "string" && entry.fromId !== "root" && !ids.has(entry.fromId)) {
      warnings.push(`${label} branch_summary ${entry.id} references fromId outside output slice: ${entry.fromId}`);
    }
  }
}

export function buildSplitTreePlan(entries: readonly PiSessionEntry[], splitEntryId: string): SplitTreePlan {
  const byId = indexEntries(entries);
  validateParentLinks(entries);

  const splitEntry = byId.get(splitEntryId);
  if (!splitEntry) throw new Error(`Split entry not found: ${splitEntryId}`);
  if (splitEntry.type !== "message" || splitEntry.message?.role !== "user") {
    throw new Error(`Split entry must be a user message: ${splitEntryId}`);
  }

  const sourceActiveLeafBefore = activeLeafId(entries);
  const activePath = new Set(pathIdsToRoot(entries, sourceActiveLeafBefore));
  if (!activePath.has(splitEntryId)) {
    throw new Error(`Split entry must be on the active path: ${splitEntryId}`);
  }

  const splitParentId = splitEntry.parentId ?? null;
  const targetIds = descendantIds(entries, splitEntryId);
  let sourceEntries = entries.filter((entry) => !targetIds.has(entry.id)).map((entry) => ({ ...entry }));
  let targetEntries = entries.filter((entry) => targetIds.has(entry.id)).map((entry) => (
    entry.id === splitEntryId ? { ...entry, parentId: null } : { ...entry }
  ));

  const droppedEntries: DroppedEntry[] = [];
  const warnings: string[] = [];
  sourceEntries = withoutExternalLabels(sourceEntries, droppedEntries);
  targetEntries = withoutExternalLabels(targetEntries, droppedEntries);

  validateParentLinks(sourceEntries);
  validateParentLinks(targetEntries);
  rejectBrokenCompactions(sourceEntries, "source");
  rejectBrokenCompactions(targetEntries, "target");
  warnExternalBranchSummaries(sourceEntries, "source", warnings);
  warnExternalBranchSummaries(targetEntries, "target", warnings);

  const sourceActiveLeafAfter = splitParentId;
  const targetActiveLeafAfter = sourceActiveLeafBefore;
  const sourceLast = activeLeafId(sourceEntries);
  const targetLast = activeLeafId(targetEntries);

  return {
    sourceEntries,
    targetEntries,
    sourceActiveLeafBefore,
    sourceActiveLeafAfter,
    targetActiveLeafAfter,
    splitParentId,
    targetRootEntryId: splitEntryId,
    sourceNeedsLeafMarker: sourceLast !== sourceActiveLeafAfter,
    targetNeedsLeafMarker: targetLast !== targetActiveLeafAfter,
    droppedEntries,
    warnings,
  };
}
