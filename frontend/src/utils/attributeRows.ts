export interface AttributeRow {
  rowId: string;
  key: string;
  value: string;
}

let rowIdCounter = 0;
export function createEmptyAttributeRow(): AttributeRow {
  rowIdCounter += 1;
  return { rowId: `attr-${rowIdCounter}-${Date.now()}`, key: "", value: "" };
}

export function findDuplicateKeys(rows: AttributeRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

// A value with no field name is ambiguous - flag it rather than silently
// dropping it (the surveyor likely meant to name it).
export function hasMissingKeyWithValue(rows: AttributeRow[]): boolean {
  return rows.some((row) => row.key.trim() === "" && row.value.trim() !== "");
}

export function attributeRowsAreValid(rows: AttributeRow[]): boolean {
  return findDuplicateKeys(rows).size === 0 && !hasMissingKeyWithValue(rows);
}

// Fully-empty rows (no key, no value) are just unused blank slots the
// surveyor added and didn't fill in - dropped silently rather than errored.
export function attributeRowsToRecord(rows: AttributeRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    result[key] = value;
  }
  return result;
}
