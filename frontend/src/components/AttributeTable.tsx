interface AttributeTableProps {
  attributes: Record<string, string>;
}

// A survey's custom attributes are its actual data record - a plain
// label/value list (like Location/Status/Captured use) made them read as
// minor page metadata instead. A bordered table with a header row is the
// GIS-attribute-table convention this is modeling, and is structurally
// honest: these genuinely are field/value pairs, not decoration.
export function AttributeTable({ attributes }: AttributeTableProps) {
  return (
    <div className="overflow-x-auto rounded-box border border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            <th className="border-r border-r-base-300">Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(attributes).map(([key, value]) => (
            <tr key={key}>
              <td className="border-r border-r-base-300">{key}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
