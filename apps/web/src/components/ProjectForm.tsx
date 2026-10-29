'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { extractApiMessage } from '@/lib/format';
import { FormError, hintClassName, inputClassName, labelClassName, primaryButtonClassName } from './form';

export function ProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, repositoryPath, targetUrl }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(extractApiMessage(body, 'Could not create the project.'));
        return;
      }
      const id = (body as { project?: { id?: string } }).project?.id;
      if (!id) {
        setError('Server returned an unexpected response.');
        return;
      }
      router.push(`/projects/${id}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Is the web app running?');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">New project</h2>
      <div>
        <label htmlFor="project-name" className={labelClassName}>
          Name
        </label>
        <input
          id="project-name"
          name="name"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          className={`${inputClassName} mt-1`}
          placeholder="e.g. Checkout app"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
        />
      </div>
      <div>
        <label htmlFor="project-repo" className={labelClassName}>
          Local repository path
        </label>
        <input
          id="project-repo"
          name="repositoryPath"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          className={`${inputClassName} mt-1 font-mono`}
          placeholder="/absolute/path/to/repo"
          value={repositoryPath}
          onChange={(e) => setRepositoryPath(e.target.value)}
          disabled={saving}
        />
        <p className={hintClassName}>
          Must be an absolute path on the machine running this tool — the same machine that serves
          this page.
        </p>
      </div>
      <div>
        <label htmlFor="project-url" className={labelClassName}>
          Target URL
        </label>
        <input
          id="project-url"
          name="targetUrl"
          type="url"
          required
          autoComplete="off"
          spellCheck={false}
          className={`${inputClassName} mt-1 font-mono`}
          placeholder="http://127.0.0.1:3000"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          disabled={saving}
        />
        <p className={hintClassName}>The running app under investigation. Must be an http(s) URL.</p>
      </div>
      <FormError message={error} />
      <button type="submit" className={primaryButtonClassName} disabled={saving}>
        {saving ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}
