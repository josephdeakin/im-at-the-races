import { Odds } from './Odds';

export function App({ pathname }: { pathname: string }) {
  const fixed = pathname.startsWith('/fixed');
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '2rem auto' }}>
      <h1>Stale odds fixture</h1>
      <nav>
        <a href="/">Buggy</a> | <a href="/fixed">Fixed control</a>
      </nav>
      <Odds mode={fixed ? 'fixed' : 'buggy'} />
    </main>
  );
}
