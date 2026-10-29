export default function RunLoading() {
  return (
    <div aria-label="Loading run" className="space-y-8">
      <div className="h-7 w-48 animate-pulse rounded-md bg-stone-200" />
      <div className="h-56 animate-pulse rounded-lg border border-stone-200 bg-white" />
      <div className="space-y-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-16 animate-pulse rounded-lg border border-stone-200 bg-white" />
        ))}
      </div>
    </div>
  );
}
