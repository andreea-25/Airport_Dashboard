export default function RequestPayload({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const labels: Record<string, string> = {
    details: "Detalii", reason: "Motiv", from: "De la", to: "Până la", topic: "Subiect", shiftDate: "Data turei",
    withColleague: "Cu colegul", summary: "Rezumat", shiftId: "Tura",
  };
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {Object.entries(payload as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{labels[k] ?? k}</dt>
          <dd className="text-slate-800">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
