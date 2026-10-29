export const inputClassName =
  'block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-xs placeholder:text-stone-400 focus:border-sky-700 focus:outline-2 focus:outline-offset-0 focus:outline-sky-700 disabled:bg-stone-50 disabled:text-stone-500';

export const labelClassName = 'block text-sm font-medium text-stone-800';

export const hintClassName = 'mt-1 text-xs text-stone-500';

export const primaryButtonClassName =
  'inline-flex items-center justify-center rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClassName =
  'inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-60';

export const dangerButtonClassName =
  'inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
