'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { AttemptVerdict } from '@/lib/repair';

interface ApplySuccess {
  branch: string;
  baseBranch: string;
  baseSha: string;
  files: string[];
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? `Request failed (${res.status}).`;
}

export function PatchActions({
  runId,
  attemptId,
  attemptNumber,
  verdict,
  repositoryPath,
}: {
  runId: string;
  attemptId: string;
  attemptNumber: number;
  verdict: AttemptVerdict;
  repositoryPath: string | null;
}) {
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplySuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/runs/${runId}/repair/attempts/${attemptId}`;

  async function onDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/download`, { cache: 'no-store' });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `races-${runId.slice(0, 8)}-attempt-${attemptNumber}.patch`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setDownloading(false);
    }
  }

  async function onApply() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`${base}/apply`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as (ApplySuccess & { runId: string }) | null;
      if (!res.ok || !body?.branch) {
        setError(
          (body as unknown as { error?: { message?: string } } | null)?.error?.message ??
            `Apply failed (${res.status}).`,
        );
        return;
      }
      setResult(body);
      setConfirming(false);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setApplying(false);
    }
  }

  if (result) {
    return (
      <VStack gap={2}>
        <Text>
          Applied on branch <Text type="code">{result.branch}</Text> ({result.files.length}{' '}
          file{result.files.length === 1 ? '' : 's'}, uncommitted).
        </Text>
        <Text type="supporting">
          Branched from {result.baseBranch} ({result.baseSha.slice(0, 8)}); that branch is
          unchanged. Review with git diff, then commit.
        </Text>
      </VStack>
    );
  }

  if (confirming) {
    return (
      <VStack gap={2}>
        <Text>
          Apply attempt {attemptNumber} to <Text type="code">{repositoryPath}</Text> on a new
          branch <Text type="code">races/run-{runId.slice(0, 8)}-attempt-{attemptNumber}</Text>?
        </Text>
        {verdict !== 'verified' && (
          <Text type="supporting">
            This attempt is {verdict} — apply it for inspection, not as a trusted fix.
          </Text>
        )}
        <Text type="supporting">
          Requires a clean tree; the current branch is never touched and changes stay
          uncommitted for review.
        </Text>
        {error && (
          <Text type="supporting">
            <span role="alert">{error}</span>
          </Text>
        )}
        <HStack gap={2}>
          <Button
            variant="primary"
            label={applying ? 'Applying patch' : 'Apply patch'}
            onClick={onApply}
            isLoading={applying}
          />
          <Button
            variant="secondary"
            label="Cancel"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            isDisabled={applying}
          />
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap={2}>
      {error && (
        <Text type="supporting">
          <span role="alert">{error}</span>
        </Text>
      )}
      <HStack gap={2} wrap="wrap">
        <Button
          variant="secondary"
          label={downloading ? 'Preparing download' : 'Download .patch'}
          tooltip="Download this attempt as an applyable unified patch."
          onClick={onDownload}
          isLoading={downloading}
        />
        {repositoryPath ? (
          <Button
            variant="primary"
            label="Apply to my repo"
            tooltip={`Apply this attempt to ${repositoryPath} on a fresh branch.`}
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
          />
        ) : (
          <Text type="supporting">Apply is unavailable: the project record is missing.</Text>
        )}
      </HStack>
    </VStack>
  );
}
