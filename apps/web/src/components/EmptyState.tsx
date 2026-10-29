export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-stone-900">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm text-stone-600">{children}</div>
    </div>
  );
}
