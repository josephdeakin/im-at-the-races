'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList } from '@astryxdesign/core/RadioList';
import { RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import {
  CreateRunResponseSchema,
  DEFAULT_RUN_LIMITS,
  DEFAULT_RUN_TASK,
  type RunMode,
} from '@races/contracts';
import { extractApiMessage } from '@/lib/format';
import { FormError } from './form';

const MODES: { value: RunMode; title: string; description: string }[] = [
  {
    value: 'investigate',
    title: 'Investigate only',
    description: 'Find and reproduce race conditions without changing source.',
  },
  {
    value: 'investigate-repair',
    title: 'Investigate with repair',
    description: 'Additionally propose source patches for confirmed races.',
  },
];

export function RunForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<RunMode>('investigate');
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_RUN_LIMITS.durationMs / 60_000);
  const [modelCalls, setModelCalls] = useState(DEFAULT_RUN_LIMITS.modelCalls);
  const [experiments, setExperiments] = useState(DEFAULT_RUN_LIMITS.experiments);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task,
          mode,
          limits: {
            durationMs: Math.round(durationMinutes * 60_000),
            modelCalls,
            experiments,
          },
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(extractApiMessage(body, 'Could not create the run.'));
        return;
      }
      const parsed = CreateRunResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError('Server returned an unexpected response.');
        return;
      }
      router.push(`/runs/${parsed.data.runId}`);
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
        <Heading level={2}>New investigation</Heading>
        <form onSubmit={onSubmit}>
          <VStack gap={4}>
            <FormLayout>
              <TextArea
                label="Task"
                description="Leave blank for a broad investigation across the whole project."
                placeholder={DEFAULT_RUN_TASK}
                rows={3}
                maxLength={4000}
                value={task}
                onChange={setTask}
                htmlName="task"
                isDisabled={saving}
                isOptional
              />
            </FormLayout>
            <RadioList
              label="Mode"
              value={mode}
              onChange={(value) => setMode(value as RunMode)}
              htmlName="mode"
              isDisabled={saving}
            >
              {MODES.map((option) => (
                <RadioListItem
                  key={option.value}
                  label={option.title}
                  value={option.value}
                  description={option.description}
                />
              ))}
            </RadioList>
            <FormLayout direction="horizontal">
              <NumberInput
                label="Duration"
                value={durationMinutes}
                onChange={setDurationMinutes}
                htmlName="durationMinutes"
                min={1}
                max={1440}
                description="minutes"
                isDisabled={saving}
              />
              <NumberInput
                label="Model calls"
                value={modelCalls}
                onChange={setModelCalls}
                htmlName="modelCalls"
                min={0}
                max={100000}
                description="calls per run"
                isDisabled={saving}
              />
              <NumberInput
                label="Experiments"
                value={experiments}
                onChange={setExperiments}
                htmlName="experiments"
                min={0}
                max={1000}
                description="plans per run"
                isDisabled={saving}
              />
            </FormLayout>
            <Text type="supporting">
              All limits are required and bound the investigation: wall-clock budget in
              minutes, model calls, and timing experiments per run.
            </Text>
            <FormError message={error} />
            <HStack>
              <Button
                type="submit"
                variant="primary"
                label={saving ? 'Creating investigation' : 'Create investigation'}
                isLoading={saving}
              />
            </HStack>
          </VStack>
        </form>
      </VStack>
    </Card>
  );
}
