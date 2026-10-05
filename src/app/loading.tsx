export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-72 animate-pulse rounded-xl" style={{ background: "var(--surface-track)" }} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: "var(--surface-track)" }} />)}
      </div>
      <div className="h-80 animate-pulse rounded-3xl" style={{ background: "var(--surface-track)" }} />
    </div>
  );
}
