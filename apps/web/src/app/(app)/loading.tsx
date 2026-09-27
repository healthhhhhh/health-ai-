export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-6">
      <div className="h-8 w-64 rounded-md bg-separator" />
      <div className="h-48 rounded-lg bg-card shadow-card" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-lg bg-card shadow-card" />
        ))}
      </div>
    </div>
  );
}
