# Fixtures

Controlled race-condition demos. Each has a buggy `/` route and a guarded
`/fixed` control in the same component; the control is an authored
comparison only — generated repairs must patch the buggy path, never swap
to the control. All data is synthetic.

- `stale-search/` — stale search results over HTTP (buggy `/` + guarded
  `/fixed`). Target: `http://127.0.0.1:4100/`.
- `stale-bank/` — stale bank balance over HTTP; the canonical demo
  (two $30 transfers, $70 resurrection). Target: `http://127.0.0.1:4100/`.
- `stale-odds/` — stale streamed price over WebSocket (buggy `/` +
  guarded `/fixed`). Target: `http://127.0.0.1:4130/`.

See each fixture's README for start commands and manual reproduction.
Each fixture suite has one labelled `FAIL_TO_PASS` test that is expected
red on the vulnerable code by design.
