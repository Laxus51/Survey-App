interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

// One label/value pair for a definition-list block, used across
// SurveyDetailsPage's Location/Status/Captured rows so it doesn't
// independently invent the same layout per field. Rendered inside a parent
// `<dl className="grid grid-cols-[auto_1fr] ...">`.
export function DetailRow({ label, children }: DetailRowProps) {
  return (
    <>
      <dt className="text-sm font-medium text-base-content/60">{label}</dt>
      <dd className="text-sm text-base-content">{children}</dd>
    </>
  );
}
