'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { CreateProjectResponseSchema } from '@races/contracts';
import { extractApiMessage } from '@/lib/format';
import { FormError } from './form';

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
      const parsed = CreateProjectResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError('Server returned an unexpected response.');
        return;
      }
      router.push(`/projects/${parsed.data.project.id}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Is the web app running?');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <VStack gap={4}>
        <Heading level={2}>New project</Heading>
        <form onSubmit={onSubmit}>
          <VStack gap={4}>
            <FormLayout defaultOptionality="required">
              <TextInput
                label="Name"
                placeholder="e.g. Checkout app"
                value={name}
                onChange={setName}
                htmlName="name"
                autoComplete="off"
                isDisabled={saving}
                isRequired
              />
              <TextInput
                label="Local repository path"
                description="An absolute path on the machine running this tool."
                placeholder="/absolute/path/to/repo"
                value={repositoryPath}
                onChange={setRepositoryPath}
                htmlName="repositoryPath"
                autoComplete="off"
                isDisabled={saving}
                isRequired
              />
              <TextInput
                label="Target URL"
                description="The running app under investigation. Must be an http(s) URL."
                placeholder="http://127.0.0.1:3000"
                value={targetUrl}
                onChange={setTargetUrl}
                htmlName="targetUrl"
                autoComplete="off"
                isDisabled={saving}
                isRequired
              />
            </FormLayout>
            <FormError message={error} />
            <HStack>
              <Button
                type="submit"
                variant="primary"
                label={saving ? 'Creating project' : 'Create project'}
                isLoading={saving}
              />
            </HStack>
          </VStack>
        </form>
      </VStack>
    </Card>
  );
}
