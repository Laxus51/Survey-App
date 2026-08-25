import { Plus, X } from "lucide-react";
import type { AttributeRow } from "../../utils/attributeRows";
import { createEmptyAttributeRow, findDuplicateKeys } from "../../utils/attributeRows";

interface CustomAttributesEditorProps {
  rows: AttributeRow[];
  onChange: (rows: AttributeRow[]) => void;
  disabled?: boolean;
}

export function CustomAttributesEditor({ rows, onChange, disabled }: CustomAttributesEditorProps) {
  const duplicateKeys = findDuplicateKeys(rows);

  function addRow() {
    onChange([...rows, createEmptyAttributeRow()]);
  }

  function updateRow(rowId: string, field: "key" | "value", value: string) {
    onChange(rows.map((row) => (row.rowId === rowId ? { ...row, [field]: value } : row)));
  }

  function removeRow(rowId: string) {
    onChange(rows.filter((row) => row.rowId !== rowId));
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-base-content">Custom fields</h2>
      {rows.length === 0 && <p className="text-sm text-base-content/60">No custom fields added.</p>}

      {rows.map((row) => {
        const trimmedKey = row.key.trim();
        const isDuplicate = trimmedKey !== "" && duplicateKeys.has(trimmedKey);
        const isMissingKey = trimmedKey === "" && row.value.trim() !== "";

        return (
          <div className="flex flex-col gap-1" key={row.rowId}>
            <div className="flex items-center gap-2">
              <input
                placeholder="Field name"
                value={row.key}
                onChange={(event) => updateRow(row.rowId, "key", event.target.value)}
                disabled={disabled}
                aria-invalid={isDuplicate || isMissingKey}
                aria-label="Custom field name"
                className="input input-sm min-h-11 flex-1"
              />
              <input
                placeholder="Value"
                value={row.value}
                onChange={(event) => updateRow(row.rowId, "value", event.target.value)}
                disabled={disabled}
                aria-label="Custom field value"
                className="input input-sm min-h-11 flex-1"
              />
              <button
                type="button"
                onClick={() => removeRow(row.rowId)}
                disabled={disabled}
                aria-label="Remove custom field"
                className="btn btn-ghost btn-square min-h-11"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {isDuplicate && <p className="text-xs text-error">Field name already used.</p>}
            {isMissingKey && <p className="text-xs text-error">Enter a field name for this value.</p>}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="btn btn-outline btn-sm min-h-11 self-start gap-1.5"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add custom field
      </button>
    </div>
  );
}
