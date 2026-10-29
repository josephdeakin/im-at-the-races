import Link from 'next/link';

export function SiteNav() {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-6 px-4 sm:px-6">
        <Link href="/projects" className="text-sm font-semibold tracking-tight text-stone-900">
          I&apos;m at the Races
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          <Link
            href="/projects"
            className="text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Projects
          </Link>
        </nav>
        <span className="ml-auto hidden font-mono text-xs text-stone-400 sm:inline">
          local dev tool
        </span>
      </div>
    </header>
  );
}
