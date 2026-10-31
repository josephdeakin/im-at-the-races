'use client';

import { useEffect, useRef, useState } from 'react';
import {
  isTerminalRunStatus,
  type Artifact,
  type Finding,
  type RepairAttempt,
  type Reproducer,
  type Run,
  type RunEvent,
  type VerificationCheck,
} from '@races/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { HStack } from '@astryxdesign/core/HStack';
import { Tab } from '@astryxdesign/core/TabList';
import { TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CancelRunButton } from './CancelRunButton';
import { RunMonitor } from './RunMonitor';
import { StatusBadge } from './StatusBadge';
import { TimelineView, type ExperimentWithTrials } from './TimelineView';
import { FindingsView } from './FindingsView';
import { PatchView } from './PatchView';
import { VerificationView } from './VerificationView';
import { RerunButton } from './RerunButton';

type Tab = 'timeline' | 'findings' | 'patch' | 'verification' | 'activity';

const TAB_LABELS: Record<Tab, string> = {
  timeline: 'Timeline',
  findings: 'Findings',
  patch: 'Patch',
  verification: 'Verification',
  activity: 'Activity',
};

export interface RepairSnapshot {
  reproducers: Reproducer[];
  attempts: RepairAttempt[];
  checks: VerificationCheck[];
  reproArtifacts: Artifact[];
}

const SNAPSHOT_POLL_INTERVAL_MS = 2000;

interface FindingsResponse {
  runId: string;
  findings: Finding[];
}

interface ExperimentsResponse {
  runId: string;
  experiments: ExperimentWithTrials[];
}

export function RunWorkspace({
  initialRun,
  initialEvents,
  initialNextAfter,
  initialExperiments,
  initialFindings,
  initialTrialId,
  initialRepair,
  repositoryPath,
}: {
  initialRun: Run;
  initialEvents: RunEvent[];
  initialNextAfter: number;
  initialExperiments: ExperimentWithTrials[];
  initialFindings: Finding[];
  initialTrialId: string | null;
  initialRepair: RepairSnapshot;
  repositoryPath: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialExperiments.length > 0 ? 'timeline' : 'activity');
  const [repair, setRepair] = useState<RepairSnapshot>(initialRepair);
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [liveExperiments, setLiveExperiments] =
    useState<ExperimentWithTrials[]>(initialExperiments);
  const [run, setRun] = useState<Run>(initialRun);
  const isTerminal = isTerminalRunStatus(run.status);
  const knownExperimentIdsRef = useRef<Set<string>>(
    new Set(initialExperiments.map((e) => e.id)),
  );

  // One snapshot poll keeps the shell and every tab live without a reload:
  // run status plus the repair, findings, and experiments snapshots.
  // Findings are small and fetched every tick; experiments ride along only
  // when a finding references one we have not seen (a finding's experiment
  // is immutable once recorded) or on the terminal tick, which refetches
  // everything once more because the status read and the snapshot reads
  // are separate requests and the run can finish between them.
  useEffect(() => {
    if (isTerminalRunStatus(run.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchExperiments = async (): Promise<void> => {
      const res = await fetch(`/api/runs/${initialRun.id}/experiments`, {
        cache: 'no-store',
      }).catch(() => null);
      if (!res?.ok || stopped) return;
      const data = (await res.json()) as ExperimentsResponse;
      for (const experiment of data.experiments) {
        knownExperimentIdsRef.current.add(experiment.id);
      }
      setLiveExperiments(data.experiments);
    };
    const poll = async () => {
      if (stopped) return;
      try {
        const [runRes, repairRes, findingsRes] = await Promise.all([
          fetch(`/api/runs/${initialRun.id}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/runs/${initialRun.id}/repair`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/runs/${initialRun.id}/findings`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (stopped) return;
        if (repairRes?.ok) setRepair((await repairRes.json()) as RepairSnapshot);
        let terminal = false;
        if (runRes?.ok) {
          const data = (await runRes.json()) as { run: Run };
          terminal = isTerminalRunStatus(data.run.status);
          setRun((prev) =>
            prev.status === data.run.status &&
            prev.phase === data.run.phase &&
            prev.finishedAt === data.run.finishedAt
              ? prev
              : data.run,
          );
        }
        if (findingsRes?.ok) {
          const fresh = ((await findingsRes.json()) as FindingsResponse).findings;
          setFindings(fresh);
          if (terminal || fresh.some((f) => !knownExperimentIdsRef.current.has(f.experimentId))) {
            await fetchExperiments().catch(() => {});
          }
        } else if (terminal) {
          await fetchExperiments().catch(() => {});
        }
      } catch {
        // Transient: retry on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, SNAPSHOT_POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, SNAPSHOT_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [initialRun.id, run.status]);
  const [focusRequest, setFocusRequest] = useState<{ trialId: string; nonce: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLElement>(null);

  // Cross-tab evidence jumps must not strand keyboard focus on the
  // unmounted source tab: move it to the newly shown panel.
  useEffect(() => {
    if (focusRequest) panelRef.current?.focus();
  }, [focusRequest]);

  const counts: Partial<Record<Tab, number>> = {
    findings: findings.length,
    patch: repair.attempts.length,
    verification: repair.checks.length,
  };

  return (
    <VStack gap={4}>
      <HStack gap={3} justify="between" wrap="wrap">
        <HStack gap={3}>
          <StatusBadge status={run.status} />
          <Text>
            Phase <Text type="code">{run.phase}</Text>
          </Text>
          {run.status === 'cancelled' && (
            <Text type="supporting">This run was cancelled.</Text>
          )}
        </HStack>
        <HStack gap={2}>
          {!isTerminal && (
            <CancelRunButton runId={initialRun.id} onCancelled={(updated) => setRun(updated)} />
          )}
          <RerunButton runId={initialRun.id} disabled={!isTerminal} />
        </HStack>
      </HStack>

      {run.status === 'queued' && (
        <Banner
          status="info"
          title="Waiting for a worker to claim this run"
          description={
            <>
              If this persists, the worker process is not running. Start it with{' '}
              <Text type="code">pnpm dev:worker</Text> (or <Text type="code">pnpm dev</Text> for
              web and worker together).
            </>
          }
        />
      )}

      <TabList
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        role="tablist"
        aria-label="Run views"
        hasDivider
      >
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
          <Tab
            key={key}
            value={key}
            label={TAB_LABELS[key]}
            panelId={`run-panel-${key}`}
            endContent={
              counts[key] ? <Badge variant="neutral" label={String(counts[key])} /> : undefined
            }
          />
        ))}
      </TabList>

      <section
        id={`run-panel-${tab}`}
        role="tabpanel"
        aria-label={TAB_LABELS[tab]}
        ref={panelRef}
        tabIndex={-1}
      >
        {tab === 'timeline' && (
          <TimelineView
            runId={initialRun.id}
            initialExperiments={initialExperiments}
            initialEvents={initialEvents}
            isTerminal={isTerminal}
            initialTrialId={initialTrialId}
            focusRequest={focusRequest}
          />
        )}
        {tab === 'findings' && (
          <FindingsView
            findings={findings}
            experiments={liveExperiments}
            runStatus={run.status}
            onOpenTrial={(trialId) => {
              setFocusRequest((prev) => ({ trialId, nonce: (prev?.nonce ?? 0) + 1 }));
              setTab('timeline');
            }}
          />
        )}
        {tab === 'patch' && (
          <PatchView
            runId={initialRun.id}
            repositoryPath={repositoryPath}
            attempts={repair.attempts}
            checks={repair.checks}
          />
        )}
        {tab === 'verification' && (
          <VerificationView
            runId={initialRun.id}
            reproducers={repair.reproducers}
            attempts={repair.attempts}
            checks={repair.checks}
            reproArtifacts={repair.reproArtifacts}
            findings={findings}
            experiments={liveExperiments}
            runMode={initialRun.mode}
            runStatus={run.status}
            onOpenTrial={(trialId) => {
              setFocusRequest((prev) => ({ trialId, nonce: (prev?.nonce ?? 0) + 1 }));
              setTab('timeline');
            }}
          />
        )}
        {tab === 'activity' && (
          <RunMonitor
            initialRun={initialRun}
            initialEvents={initialEvents}
            initialNextAfter={initialNextAfter}
          />
        )}
      </section>
    </VStack>
  );
}
