'use client';

import { useEffect, useState } from 'react';
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
import { HStack } from '@astryxdesign/core/HStack';
import { Tab } from '@astryxdesign/core/TabList';
import { TabList } from '@astryxdesign/core/TabList';
import { VStack } from '@astryxdesign/core/VStack';
import { RunMonitor } from './RunMonitor';
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

const REPAIR_POLL_INTERVAL_MS = 2000;

export function RunWorkspace({
  initialRun,
  initialEvents,
  initialNextAfter,
  experiments,
  findings,
  initialTrialId,
  initialRepair,
}: {
  initialRun: Run;
  initialEvents: RunEvent[];
  initialNextAfter: number;
  experiments: ExperimentWithTrials[];
  findings: Finding[];
  initialTrialId: string | null;
  initialRepair: RepairSnapshot;
}) {
  const [tab, setTab] = useState<Tab>(experiments.length > 0 ? 'timeline' : 'activity');
  const [repair, setRepair] = useState<RepairSnapshot>(initialRepair);
  const isTerminal = isTerminalRunStatus(initialRun.status);

  // Live runs keep the repair tabs fed without a reload.
  useEffect(() => {
    if (isTerminal) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/runs/${initialRun.id}/repair`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as RepairSnapshot;
          setRepair(data);
        }
      } catch {
        // Transient: retry on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, REPAIR_POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, REPAIR_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [initialRun.id, isTerminal]);
  const [focusRequest, setFocusRequest] = useState<{ trialId: string; nonce: number } | null>(
    null,
  );

  const counts: Partial<Record<Tab, number>> = {
    findings: findings.length,
    patch: repair.attempts.length,
    verification: repair.checks.length,
  };

  return (
    <VStack gap={4}>
      <HStack gap={2} justify="between" wrap="wrap">
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
        <RerunButton runId={initialRun.id} />
      </HStack>

      <section id={`run-panel-${tab}`} role="tabpanel" aria-label={TAB_LABELS[tab]}>
        {tab === 'timeline' && (
          <TimelineView
            runId={initialRun.id}
            initialExperiments={experiments}
            initialEvents={initialEvents}
            isTerminal={isTerminalRunStatus(initialRun.status)}
            initialTrialId={initialTrialId}
            focusRequest={focusRequest}
          />
        )}
        {tab === 'findings' && (
          <FindingsView
            findings={findings}
            experiments={experiments}
            runStatus={initialRun.status}
            onOpenTrial={(trialId) => {
              setFocusRequest((prev) => ({ trialId, nonce: (prev?.nonce ?? 0) + 1 }));
              setTab('timeline');
            }}
          />
        )}
        {tab === 'patch' && <PatchView attempts={repair.attempts} checks={repair.checks} />}
        {tab === 'verification' && (
          <VerificationView
            reproducers={repair.reproducers}
            attempts={repair.attempts}
            checks={repair.checks}
            reproArtifacts={repair.reproArtifacts}
            findings={findings}
            runMode={initialRun.mode}
            runStatus={initialRun.status}
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
