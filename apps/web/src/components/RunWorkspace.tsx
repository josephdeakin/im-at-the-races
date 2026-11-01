'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RUN_MODE_LABELS,
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
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Tab } from '@astryxdesign/core/TabList';
import { TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatDateTime, formatDurationMs } from '@/lib/format';
import { modelBadgeFromEvents, visionNotesFromEvents } from '@/lib/model-badge';
import { CancelRunButton } from './CancelRunButton';
import { RaceCelebration } from './RaceCelebration';
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

interface ArtifactsResponse {
  runId: string;
  artifacts: Artifact[];
}

export function RunWorkspace({
  initialRun,
  initialEvents,
  initialNextAfter,
  initialExperiments,
  initialFindings,
  initialTrialId,
  initialRepair,
  initialArtifacts,
  repositoryPath,
}: {
  initialRun: Run;
  initialEvents: RunEvent[];
  initialNextAfter: number;
  initialExperiments: ExperimentWithTrials[];
  initialFindings: Finding[];
  initialTrialId: string | null;
  initialRepair: RepairSnapshot;
  initialArtifacts: Artifact[];
  repositoryPath: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialExperiments.length > 0 ? 'timeline' : 'activity');
  const [repair, setRepair] = useState<RepairSnapshot>(initialRepair);
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [liveExperiments, setLiveExperiments] =
    useState<ExperimentWithTrials[]>(initialExperiments);
  const [run, setRun] = useState<Run>(initialRun);
  const isTerminal = isTerminalRunStatus(run.status);
  const knownExperimentIdsRef = useRef<Set<string>>(
    new Set(initialExperiments.map((e) => e.id)),
  );

  // One snapshot poll keeps the shell and every tab live without a reload:
  // run status plus the repair, findings, artifacts, and experiments
  // snapshots. Findings and artifacts are small and fetched every tick;
  // experiments ride along only when a finding references one we have not
  // seen (a finding's experiment is immutable once recorded) or on the
  // terminal tick, which refetches everything once more because the status
  // read and the snapshot reads are separate requests and the run can
  // finish between them.
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
        const [runRes, repairRes, findingsRes, artifactsRes] = await Promise.all([
          fetch(`/api/runs/${initialRun.id}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/runs/${initialRun.id}/repair`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/runs/${initialRun.id}/findings`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/runs/${initialRun.id}/artifacts`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (stopped) return;
        if (repairRes?.ok) setRepair((await repairRes.json()) as RepairSnapshot);
        if (artifactsRes?.ok) {
          setArtifacts(((await artifactsRes.json()) as ArtifactsResponse).artifacts);
        }
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

  const modelBadge = modelBadgeFromEvents(initialEvents);

  const counts: Partial<Record<Tab, number>> = {
    findings: findings.length,
    patch: repair.attempts.length,
    verification: repair.checks.length,
  };

  return (
    <VStack gap={4}>
      <Card>
        <MetadataList title="Run details" columns={2}>
          <MetadataListItem label="Task">{run.task}</MetadataListItem>
          <MetadataListItem label="Mode">
            {RUN_MODE_LABELS[run.mode]} <Text type="supporting">(stored intent)</Text>
          </MetadataListItem>
          <MetadataListItem label="Phase">
            <Text type="code">{run.phase}</Text>
          </MetadataListItem>
          <MetadataListItem label="Model">
            <Badge variant="neutral" label={modelBadge.label} />
            {modelBadge.usageLine && <Text type="supporting"> {modelBadge.usageLine}</Text>}
          </MetadataListItem>
          <MetadataListItem label="Limits">
            {formatDurationMs(run.limits.durationMs)} · {run.limits.modelCalls} model calls ·{' '}
            {run.limits.experiments} experiments
          </MetadataListItem>
          <MetadataListItem label="Timestamps">
            <VStack gap={0}>
              <Text>Created: {formatDateTime(run.createdAt)}</Text>
              <Text>Started: {formatDateTime(run.startedAt)}</Text>
              <Text>Finished: {formatDateTime(run.finishedAt)}</Text>
              {run.cancelRequestedAt && (
                <Text>Cancellation requested: {formatDateTime(run.cancelRequestedAt)}</Text>
              )}
            </VStack>
          </MetadataListItem>
          {run.errorMessage && (
            <MetadataListItem label="Error">
              <Text type="code">
                {run.errorCode ? `${run.errorCode}: ` : ''}
                {run.errorMessage}
              </Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </Card>

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

      <RaceCelebration runId={initialRun.id} experiments={liveExperiments} findings={findings} />

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
            visionNotes={visionNotesFromEvents(initialEvents)}
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

      <VStack gap={2}>
        <Heading level={2}>Run artifacts</Heading>
        {artifacts.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Screenshots and recorded values will appear here once the run executes trials."
          />
        ) : (
          <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
            {artifacts.map((artifact) => (
              <Card key={artifact.id}>
                <VStack gap={2}>
                  {artifact.mimeType.startsWith('image/') ? (
                    <a href={`/api/artifacts/${artifact.id}`} target="_blank" rel="noreferrer">
                      {/* Plain img: artifact bytes are local evidence, not optimized assets. */}
                      <img
                        src={`/api/artifacts/${artifact.id}`}
                        alt={`${artifact.kind} evidence: ${artifact.relativePath}`}
                        className="aspect-video w-full rounded-md object-cover object-top"
                      />
                    </a>
                  ) : (
                    <Link
                      href={`/api/artifacts/${artifact.id}`}
                      target="_blank"
                      isStandalone
                    >
                      Open {artifact.kind} ({artifact.mimeType})
                    </Link>
                  )}
                  <Text type="code">
                    {artifact.kind} · {artifact.relativePath}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        )}
      </VStack>
    </VStack>
  );
}
