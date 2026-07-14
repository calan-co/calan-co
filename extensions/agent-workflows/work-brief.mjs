function toText(value) {
  return String(value ?? "").trim();
}

function linesFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(toText).filter(Boolean);
  return [toText(value)].filter(Boolean);
}

function renderSection(title, bodyLines) {
  const lines = linesFrom(bodyLines);
  if (!lines.length) return [];
  return [`## ${title}`, "", ...lines, ""];
}

function renderBulletSection(title, values) {
  const lines = linesFrom(values);
  if (!lines.length) return [];
  return [`## ${title}`, "", ...lines.map((line) => `- ${line}`), ""];
}

export function renderWorkBrief(workItem) {
  const id = toText(workItem?.id || workItem?.itemId);
  const title = toText(workItem?.title);
  if (!id) throw new Error("Work Brief requires a Work Item id.");
  if (!title) throw new Error("Work Brief requires a Work Item title.");

  const source = workItem?.source || {};
  const sourceRef = toText(workItem?.sourcePath || workItem?.detailRef || source.path || source.url || source.id);
  const sourceBody = toText(workItem?.sourceBody || source.body || source.text || workItem?.body);

  return [
    `# Work Item ${id}: ${title}`,
    "",
    ...renderSection("Summary", workItem.summary),
    ...renderSection("Source", sourceRef),
    ...renderBulletSection("Tags", workItem.tags),
    ...renderBulletSection("Acceptance Criteria", workItem.acceptanceCriteria),
    ...renderBulletSection("Dependencies", workItem.dependencies || workItem.dependsOn),
    ...renderSection("Preserved Source", sourceBody),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
