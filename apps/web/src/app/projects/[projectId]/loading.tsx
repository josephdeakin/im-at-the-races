export default function ProjectLoading() {
  return (
    <div aria-label="Loading project" className="space-y-8">
      <div className="h-7 w-56 animate-pulse rounded-md bg-stone-200" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="h-96 animate-pulse rounded-lg border border-stone-200 bg-white lg:col-span-2" />
        <div className="space-y-3 lg:col-span-3">
          {[0, 1].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-lg border border-stone-200 bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}
