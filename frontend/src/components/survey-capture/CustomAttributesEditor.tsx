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
    <div className="attributes-editor">
      <h2>Custom fields</h2>
      {rows.length === 0 && <p className="muted">No custom fields added.</p>}

      {rows.map((row) => {
        const trimmedKey = row.key.trim();
        const isDuplicate = trimmedKey !== "" && duplicateKeys.has(trimmedKey);
        const isMissingKey = trimmedKey === "" && row.value.trim() !== "";

        return (
          <div className="attribute-row-editor" key={row.rowId}>
            <div className="attribute-row-inputs">
              <input
                placeholder="Field name"
                value={row.key}
                onChange={(event) => updateRow(row.rowId, "key", event.target.value)}
                disabled={disabled}
                aria-invalid={isDuplicate || isMissingKey}
                aria-label="Custom field name"
              />
              <input
                placeholder="Value"
                value={row.value}
                onChange={(event) => updateRow(row.rowId, "value", event.target.value)}
                disabled={disabled}
                aria-label="Custom field value"
              />
              <button
                type="button"
                onClick={() => removeRow(row.rowId)}
                disabled={disabled}
                aria-label="Remove custom field"
              >
                Remove
              </button>
            </div>
            {isDuplicate && <p className="form-error">Field name already used.</p>}
            {isMissingKey && <p className="form-error">Enter a field name for this value.</p>}
          </div>
        );
      })}

      <button type="button" onClick={addRow} disabled={disabled}>
        + Add custom field
      </button>
    </div>
  );
}
