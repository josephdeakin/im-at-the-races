/**
 * Convert the stored repair-attempt diff (evidence format from diffWorkspace)
 * into an applyable unified patch. Sections:
 * - `git diff HEAD` output passes through verbatim (already relative).
 * - `git diff --no-index` carried sections carry absolute paths and are
 *   relativized via the paths' common tail (repo-root-relative by
 *   construction: both sides end in <subpath>/<relpath>).
 * - `new file:` sections are synthesized into new-file diffs.
 * Anything unfaithful (truncated, binary, deleted-carried fallbacks) refuses
 * instead of producing a corrupt patch.
 */
export type PatchConversion =
  | { ok: true; patch: string }
  | { ok: false; error: string };

function isSectionStart(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('new file: ') ||
    line.startsWith('deleted carried file: ') ||
    line.startsWith('modified carried file: ')
  );
}

function commonTail(a: string, b: string): string {
  const aSegs = a.split('/').filter((s) => s !== '');
  const bSegs = b.split('/').filter((s) => s !== '');
  const tail: string[] = [];
  while (aSegs.length > 0 && bSegs.length > 0 && aSegs[aSegs.length - 1] === bSegs[bSegs.length - 1]) {
    tail.unshift(aSegs.pop() as string);
    bSegs.pop();
  }
  return tail.join('/');
}

function convertGitSection(lines: string[]): PatchConversion {
  const header = lines[0];
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(header);
  if (!match) return { ok: false, error: `Unrecognized diff header: ${header.slice(0, 80)}` };
  const [, aPath, bPath] = match;
  if (!aPath.startsWith('/') && !bPath.startsWith('/')) {
    return { ok: true, patch: lines.join('\n').trimEnd() };
  }
  // Carried-file --no-index section: both sides absolute.
  if (!aPath.startsWith('/') || !bPath.startsWith('/')) {
    return { ok: false, error: 'Mixed absolute/relative diff paths; refusing to guess.' };
  }
  const rel = commonTail(aPath, bPath);
  if (rel === '') {
    return { ok: false, error: 'Carried diff paths share no common tail; cannot relativize.' };
  }
  const rewritten = lines.map((line, index) => {
    if (index === 0) return `diff --git a/${rel} b/${rel}`;
    if (line === `--- a/${aPath}`) return `--- a/${rel}`;
    if (line === `+++ b/${bPath}`) return `+++ b/${rel}`;
    return line;
  });
  return { ok: true, patch: rewritten.join('\n').trimEnd() };
}

function convertNewFileSection(lines: string[]): PatchConversion {
  // Drop separator blanks absorbed from between sections; a '+'-only line
  // is real content (file ends with a newline) and is kept.
  const trimmed = [...lines];
  while (trimmed.length > 1 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  const header = trimmed[0];
  const rel = header.slice('new file: '.length).trim();
  if (rel.endsWith('(binary or unreadable)')) {
    return { ok: false, error: `New file is binary or unreadable: ${rel}` };
  }
  if (rel === '' || rel.includes('..') || rel.startsWith('/')) {
    return { ok: false, error: `Unsafe new-file path: ${rel}` };
  }
  const body = trimmed.slice(1);
  if (body.some((l) => l.includes('... (truncated)'))) {
    return { ok: false, error: `New file contents were truncated: ${rel}` };
  }
  for (const line of body) {
    if (!line.startsWith('+')) {
      return { ok: false, error: `Malformed new-file body for ${rel}` };
    }
  }
  const content = body.map((l) => l.slice(1)).join('\n');
  const out = [
    `diff --git a/${rel} b/${rel}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${rel}`,
  ];
  if (content !== '') {
    const parts = content.split('\n');
    const count = content.endsWith('\n') ? parts.length - 1 : parts.length;
    out.push(`@@ -0,0 +1,${count} @@`);
    out.push(...body);
    if (!content.endsWith('\n')) out.push('\\ No newline at end of file');
  }
  return { ok: true, patch: out.join('\n') };
}

export function storedDiffToPatch(diff: string): PatchConversion {
  if (diff.trim() === '') return { ok: false, error: 'The attempt produced no changes.' };
  const sections: string[][] = [];
  for (const line of diff.split('\n')) {
    if (isSectionStart(line)) {
      sections.push([line]);
    } else if (sections.length === 0) {
      if (line.trim() !== '') {
        return { ok: false, error: `Unrecognized diff content: ${line.slice(0, 80)}` };
      }
    } else {
      sections[sections.length - 1].push(line);
    }
  }
  const converted: string[] = [];
  for (const section of sections) {
    const [header] = section;
    if (header.startsWith('diff --git ')) {
      const result = convertGitSection(section);
      if (!result.ok) return result;
      converted.push(result.patch);
    } else if (header.startsWith('new file: ')) {
      const result = convertNewFileSection(section);
      if (!result.ok) return result;
      converted.push(result.patch);
    } else {
      return { ok: false, error: `Cannot reconstruct patch from: ${header.slice(0, 80)}` };
    }
  }
  if (converted.length === 0) return { ok: false, error: 'No convertible sections found.' };
  return { ok: true, patch: `${converted.join('\n')}\n` };
}
