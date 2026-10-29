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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1" role="group" aria-label="Run views">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
                tab === key ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {TAB_LABELS[key]}
              {key === 'findings' && findings.length > 0 && (
                <span className="ml-1 font-mono text-xs opacity-80">({findings.length})</span>
              )}
              {key === 'patch' && repair.attempts.length > 0 && (
                <span className="ml-1 font-mono text-xs opacity-80">({repair.attempts.length})</span>
              )}
              {key === 'verification' && repair.checks.length > 0 && (
                <span className="ml-1 font-mono text-xs opacity-80">({repair.checks.length})</span>
              )}
            </button>
          ))}
        </div>
        <span className="ml-auto">
          <RerunButton runId={initialRun.id} />
        </span>
      </div>

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
    </div>
  );
}
