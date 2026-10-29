# I’m at the Races product requirements

Product requirements document • Version 1.0 • 29 October 2026

Product owner and builder: Joseph Deakin

### Product intent

I’m at the Races is a local developer tool that investigates timing bugs in web applications. A developer supplies a repository and running application. An agent connects source code with browser evidence, generates test cases, changes event delivery order, and produces an observable, reproducible failure. It then proposes a source patch and verifies it using the unchanged reproducer.

The main product experience is a visual race debugger. The developer can see which event arrived late, what changed on screen, why the agent believes that is wrong, and whether the proposed fix prevents the same failure.

### Release decision

Build one complete HTTP race investigation and repair journey before adding broader protocol coverage. The hackathon release must include genuine agent-generated test design and a generated patch. A scripted search reproducer is the integration milestone, not the finished product.

The initial architecture is a pnpm monorepo with a Next.js web app and a separate local Node worker. SQLite stores structured records; local files store evidence. The worker owns investigations so a web reload does not terminate them.

### Intended readers and use

This document is the implementation contract for Joe and coding agents. Requirement IDs identify testable behaviour. P0 means required for the hackathon release, P1 means the next increment, and P2 means later exploration. Proposed limits and quality targets are acceptance targets, not measured performance.

### Established starting point

The existing build plan records a locally verified stale-search fixture: normal response order passes, reverse order exposes stale results, and an authored guard passes that reverse order. The Next.js foundation prompt has been submitted to a coding agent. Its resulting code and checks have not yet been reviewed here.

### Document map

1 Product intent and release decision

2 Users, outcomes and scope

3 End to end user experience

4 Investigation and generated test cases

5 Experiment execution and evidence

6 Findings, repair and verification

7 Visual debugger and interaction requirements

8 Architecture, persistence and interfaces

9 Reliability, privacy and operating limits

10 Acceptance, delivery and remaining decisions

## Users outcomes and scope

### Problem

Asynchronous responses can be individually valid yet produce an incorrect UI when they arrive in an unexpected order. Ordinary happy-path tests may miss the failure, and a screenshot alone does not explain the event sequence. Developers must currently connect traffic, source code, UI changes and regression tests themselves.

### Primary user

A frontend or full-stack developer working on a local JavaScript or TypeScript application. They can run the app and provide its source, but do not necessarily know which interaction or event ordering is faulty. Joe’s experience with React and real-time applications is the initial product context.

### Jobs to be done

- Discover: investigate a running app without requiring me to prewrite every test.

- Understand: show the event sequence and visible consequence beside the relevant code.

- Reproduce: give me a saved plan and executable regression test that fail for the stated reason.

- Repair: propose a focused patch and demonstrate its effect with independent execution.

- Trust: distinguish observations, inferred expectations and unverified claims.

### P0 hackathon release

Local repository and target configuration; persistent projects and runs; one active worker run; source search and reading; DOM, screenshot, HTTP and console inspection; bounded exploration; agent-generated structured experiments; HTTP response hold and release; executable assertions; reproduction attempts; visual replay; isolated code repair; verification and export.

The supported demonstration environment is a local React/TypeScript app with finite HTTP responses, repeatable read-only workflows and a documented start command. The engine must avoid hardcoded search terms, selectors or fixture-specific response logic. Generated plans may contain app-specific selectors and checks.

### P1 after the complete journey

Second distinct race scenario; event-sequence reduction; WebSocket inspection and controlled message delivery; richer state instrumentation; SSE progress delivery; additional framework fixtures; convenient patch application after review.

### P2 future exploration

CI integration, pull-request publishing, multi-user collaboration, remote workers, larger benchmark suites, arbitrary framework state adapters and wider browser coverage.

### Explicit non goals

General security scanning; proof that an application has no races; server-side thread scheduling; arbitrary production testing; automatic merging or deployment; a Chrome extension; a hosted SaaS service; comprehensive React DevTools state extraction. Response timing control does not establish coverage of backend concurrency defects.

### Product outcomes

Release success means a developer can trace a demonstrated UI failure to the recorded event order, replay it, review a generated patch, and inspect the unchanged test passing after repair. Winning a prize is the business ambition; it is not a measurable product guarantee.

## End to end user experience

### Journey and run inputs

UX01 P0 — The developer creates a project with a name, absolute repository path and target URL. Paths refer to the machine running the tool. The UI validates inputs and reports missing paths, unreachable targets and unsupported setup clearly.

UX02 P0 — The developer starts an investigation with an optional task, investigation-only or repair mode, and bounded duration, model-call and experiment budgets. An empty task defaults to investigating likely timing-sensitive interactions. User-supplied rules are optional evidence, not a prerequisite for generated tests.

UX03 P0 — Project configuration includes the starting page, permitted target origins, setup/test commands and reset strategy. P0 supports an already running target and a configured command for the isolated repair app. Credentials and authentication state are local inputs and never ordinary event payloads.

### Preflight

Check repository readability, target availability, configuration and available executor capabilities. Record the source revision or content fingerprint. Discovery can read an existing working tree, but repair requires a clean, reproducible source snapshot. If a dirty tree cannot be captured faithfully, continue investigation-only and explain that repair is unavailable.

A browser reset clears browser state; it does not reset server data. P0 uses read-only fixture workflows. Any later state-changing workflow must provide and verify a backend reset mechanism before repeated experiments.

### Investigation experience

The run appears immediately as queued with a stable ID. If the executor is not connected, it stays queued with a clear explanation. Once claimed, it shows the current phase and a concise activity stream: inspecting source, exploring a workflow, testing a hypothesis or verifying a failure.

The developer can leave and reopen the page without losing evidence. Stop requests cancellation; the UI displays the request until the worker acknowledges cleanup. No invented percentages, findings or estimates appear.

### Results experience

A finding opens its explanation, expected and observed values, evidence timeline, relevant source and reproduction record. A run with no findings reports tested workflows and limitations, not a declaration that the app is race-free. Partial results remain available after cancellation, timeout or repair failure.

### Repair experience

In repair mode, a supported finding advances to an isolated workspace. The UI shows the proposed diff, regression test, exact verification results and before/after evidence. The original working tree remains untouched. The developer can export the patch and test; applying or merging is a separate deliberate action.

### Key user stories

- As a developer, I can start with a broad instruction and inspect the generated test before trusting its conclusion.

- As a reviewer, I can select the stale response and see the values it changed.

- As a maintainer, I can rerun an exported test without asking the model to reconstruct the bug.

- As a developer with an unsuccessful repair, I still receive the original finding and evidence.

## Investigation and generated test cases

### Agent responsibility

AG01 P0 — The agent reads relevant source and runtime observations together. It can search files, read bounded excerpts, inspect existing tests and follow request handlers. It must cite file locations against the captured source snapshot. Static suspicion alone is not a confirmed runtime finding.

AG02 P0 — Browser tools expose page structure, visible values, screenshots, console errors and bounded network details. Structured evidence supplies the useful parts of developer tools; operating the DevTools interface is unnecessary. Arbitrary internal React state is not assumed to be available.

AG03 P0 — The agent generates hypotheses, actions, schedules and observable checks. It records why an expectation is justified: user requirement, source behaviour, existing test, observed normal behaviour or inference. Ambiguous expectations remain candidates even if their checks repeatedly fail.

### Investigation loop

Observe source and runtime → identify a plausible relationship → design a test → validate the plan → execute → interpret evidence → reproduce a violation → save the result → investigate further while budget remains.

The orchestrator owns tool validation, budgets, lifecycle and persistence. The model chooses investigative actions. Timing-critical execution is local code; the model does not decide when to release each response during an experiment.

### Initial tool contract

- Code: listFiles, searchCode and readFile, with repository boundaries and size limits.

- Browser: observePage, act and readEvidence, with validated locators and allowed navigation.

- Experiment: runExperiment accepts a versioned plan and returns typed outcomes and evidence IDs.

- Completion: finish records coverage, unresolved suspicions and limitations.

Repair adds bounded edit and command tools in the isolated workspace. Verification uses fixed commands and the frozen test, not the repair agent’s verbal verdict.

### Required experiment plan

Each plan contains an ID and schema version; hypothesis; evidence references; source locations; reset instructions; ordered actions; logical request matchers; event dependencies; delivery schedule; assertions; evaluation conditions; timeouts; expected-outcome rationale; and required runner capabilities.

Match requests using method, URL/body predicates and an occurrence or action relationship. A URL alone is insufficient when several calls share an endpoint. Assertions use supported structured predicates over captured DOM/network values. Arbitrary model-authored JavaScript is not executed inside the orchestrator.

### Context and feedback

Supply bounded recent events, relevant source excerpts, prior experiments and remaining budget. Full artifacts remain available through explicit reads. Invalid tool arguments return actionable errors and consume a bounded retry allowance. Page text, repository content and network bodies are evidence, not instructions that override the developer’s task.

### Acceptance

Given the stale-search app without a prewritten action list, the agent must identify the overlapping request path, select distinct queries, generate a delivery-order experiment and justify its final-state check. The resulting plan and tool history must be saved for inspection.

## Experiment execution and evidence

### Controlled execution

EX01 P0 — Validate the plan and supported capabilities before launching a trial. Restore the declared starting state, run a baseline, reset again, then run the intervention. Baseline and intervention use equivalent user actions, inputs and assertions; only the intended timing treatment differs. A baseline must not wait on a response-held condition that exists only in the intervention.

EX02 P0 — Capture finite HTTP responses and hold or release selected responses according to explicit dependencies. Requests may reach the server normally; the changed variable is response delivery to the browser. Unsupported streaming, downloads, service-worker paths or interception failures produce a capability limitation, not a passing test.

EX03 P0 — Distinguish request start, response capture, hold, release and observed UI update. Response release does not prove that application code has consumed it. Every dependent observation has a timeout and a supported completion criterion. Global network-idle is not a completion rule while traffic is held.

### Example generated experiment

Workflow: enter query A, then distinct query B. Capture A and B. Deliver B, observe its expected results, then deliver A. After the configured processing observation, compare displayed results with the current query. Preserve values and screenshots around both deliveries.

For a negative claim such as “stale results never appear,” define the observation window explicitly. Passing a finite check is evidence for that window, not a guarantee about all future events. If completion cannot be established, the result is inconclusive.

### Outcomes

Pass: the defined check passed under the recorded conditions.

Violation: a defined executable assertion failed with supporting values.

Inconclusive: required state, matching traffic or completion condition was not established.

Runner error: tooling, reset, browser or instrumentation failed.

A baseline failure remains visible and prevents a simple claim that the intervention caused the difference. Baselines can themselves be flaky; report repeated baseline outcomes rather than treating one pass as proof.

### Evidence contract

EV01 P0 — Persist append-only ordered events with event ID, run ID, experiment/trial ID, sequence, monotonic elapsed time, wall-clock time, kind, schema version and typed payload. Link action IDs, logical request IDs, observations, assertions and artifact IDs where applicable.

EV02 P0 — Capture screenshots and selected values before and after decisive deliveries and at assertion failure. Record capture time separately from the triggering event. Store traces when available, response-body excerpts within limits and console errors. Missing evidence is explicitly labelled.

### Repeatability and cleanup

Replays use logical matchers and dependencies, not transient browser request IDs or model latency. All waits and holds are bounded. On timeout or cancellation, abort pending work, resolve held traffic safely, close the context and retain partial evidence. Do not blindly replay writes after a worker crash.

## Findings repair and verification

### Finding standard

FI01 P0 — A finding includes the behaviour under test, expected and actual values, expectation provenance, baseline outcomes, intervention, source snapshot, implicated code, evidence IDs, reproduction plan and attempt counts. Separate demonstrated observations from the agent’s explanation of cause.

FI02 P0 — Run three confirmation attempts by default after a candidate violation, with results reported separately from the initial discovery. Label a failure “reproduced” when at least two confirmation attempts violate the same check; always show X of Y. This is an operating threshold, not statistical proof. Unrepeated observations and ambiguous expectations remain visible with qualified status.

### Freeze the reproducer

RP01 P0 — Export an executable regression test and versioned plan. Run the exported test against the original snapshot and confirm failure for the stated assertion. Store hashes of the test, plan and check definition before repair. A test that fails because the server will not start does not qualify.

The reproducer may depend on the project’s runner package. Export the required version, fixture assumptions, reset procedure, setup instructions and exact command. Do not imply it is standalone if it requires that runtime.

### Isolated repair

RP02 P0 — Create a separate checkout or worktree from the captured source snapshot. Start its target app on a distinct configured port and verify that the browser is testing that checkout. The repair phase receives relevant source, repository instructions, finding, frozen test and permitted build/test commands.

RP03 P0 — Generate a focused patch, inspect related state transitions such as stale error and loading updates, and retain every attempted diff and check outcome. The repair agent must not edit the protected reproducer, weaken assertions or replace the target with the authored fixed fixture. Verify protected hashes before and after each attempt.

### Independent verification gates

VF01 P0 — The original snapshot fails the frozen test for the intended reason; the patched snapshot passes the same test in all three configured repetitions; the normal workflow passes; at least two applicable nearby delivery schedules pass; and configured relevant tests and type checks pass. Run the build when the project provides it.

Verification is performed by the orchestrator using execution results. The repair agent’s explanation cannot change the verdict. Missing required checks produce “verification incomplete”; failed checks produce “verification failed.” Preserve command, exit code, duration, environment/source identity and bounded logs.

### Bounded outcome

Allow up to two repair attempts by default. Failed verification returns evidence for revision within that budget. On exhaustion, provide the finding and the last patch as unverified. “Verified for tested cases” applies only when every required gate passes; no claim of universal correctness is made.

RP04 P0 — Show diff, original and patched replays, regression test and verification matrix. Export them for review. Automatic application, push, merge and deployment are outside P0.

## Visual debugger and interaction requirements

### Product layout

UI01 P0 — Use a restrained developer-tool interface: neutral surfaces, readable text, thin borders, one accent colour and monospace metadata. The race is the main content. Avoid decorative dashboards, fake counters and promotional AI badges.

Project pages handle setup and history. A run workspace uses a compact header for project, target, status and controls, with Timeline, Findings and Trace views. A finding also exposes Source, Patch and Verification content without requiring a large global sidebar.

### Synchronized replay

UI02 P0 — A single selected event controls the request timeline, browser snapshot and inspector. Show one lane per relevant request, with start, capture, held interval and release markers. Include user-action markers and the failing assertion. State plainly when a causal relationship is inferred rather than instrumented.

UI03 P0 — The snapshot panel shows the nearest applicable recorded image and its timestamp. The inspector shows selected values before/after, request parameters, response excerpts and the assertion. No animation may imply an unrecorded intermediate UI state.

UI04 P0 — Provide recorded play/pause, previous/next event, speed and scrubbing. Backwards movement inspects saved evidence. A separately named “Rerun experiment” control executes a fresh trial and creates new evidence; it never overwrites the original run.

### Explaining the race

The selected failure should support a concise explanation such as: “Response A belongs to the earlier query, but replaced results while query B remained selected.” Link the sentence to recorded requests, values and source references. If the cause remains uncertain, say so.

Highlight the selected late response and failed check with both colour and text or iconography. Show expected and actual values alongside each other. Avoid relying on red versus green alone.

### Comparison and review

UI05 P0 — Before/after comparison aligns runs by logical actions and deliveries, not absolute elapsed time. Show the same frozen check on original and patched code, their source identities and reproduction counts. Timing differences and missing corresponding snapshots remain visible.

The patch view includes file paths and a readable diff. Verification lists each executed check with pass, fail, incomplete or skipped status and its supporting output. A skipped required check prevents a fully verified label.

### Empty and failure states

Cover no projects, queued without executor, unreachable target, model unavailable, unsupported interception, missing artifact, no findings, cancelled run, worker interruption and repair failure. Preserve navigation to existing evidence in each case.

### Accessibility and acceptance

All forms and controls have names, keyboard focus and readable contrast. Timeline events have a keyboard-accessible ordered list alternative. The primary desktop target is 1280 pixels wide; narrower layouts stack panels without hiding evidence. Acceptance: selecting the late response updates every linked panel and clearly exposes the stale overwrite using real persisted data.

## Architecture persistence and interfaces

### Process boundaries

AR01 P0 — apps/web contains Next.js pages, React components and Node-runtime API handlers. apps/worker is a long-running Node process. packages/contracts holds browser-safe schemas; packages/db holds Drizzle/SQLite access; packages/core holds orchestration, agent, browser, workspace and verification modules. fixtures/stale-search remains the controlled fixture.

The web app imports contracts and server-side database code, never the execution core. It queues commands and reads evidence. The worker owns browser processes, model calls, repairs and cleanup. The target application and its data remain separate from the tool.

### Storage model

Use one absolute configurable .races directory with races.db and artifacts grouped by run and experiment. Both processes resolve the same path. Structured records reference artifact IDs and relative paths; binary files stay outside database rows. Use migrations, foreign keys, WAL, a busy timeout and short transactions.

Projects store repository, target and setup configuration. Runs store task, mode, status, phase, limits, source identity, cancellation and timestamps. Events store ordered typed payloads with a unique run/sequence key. Artifacts store type, path, MIME type, size and content hash.

Add experiments and trials for plans, baselines and outcomes; findings for claims and evidence; repair attempts for workspace and diff references; verification checks for commands and verdicts. Introduce these tables with their implementing milestones, rather than building unused schema first.

### Lifecycle and ownership

Run status is queued, running, completed, failed, cancelled or interrupted. Phase is separate: preflight, discovery, experiment, reproduction, repair, verification or reporting. Completed means the bounded investigation finished, not that it found or fixed a bug.

AR02 P0 — Atomically claim one queued run and append its start event. Record worker ownership and heartbeat. Enforce one active run initially. On lost ownership, stop further mutations; after a crash, mark the abandoned run interrupted and preserve evidence. Recovery must not create two executors for one run.

### API surface

Projects: list, create, detail and project run history. Runs: create, detail, events after sequence, cancel and finding list. Evidence: experiment/trial detail, artifact by ID, patch, verification and export. Rerun creates a new linked trial or run rather than mutating historical evidence.

Run creation returns HTTP 202 after its queued record and initial event commit together. Queued cancellation is immediate; running cancellation records a request; terminal cancellation is idempotent. Cursor polling deduplicates ordered events, avoids overlapping requests and fetches the final event tail before stopping.

### Contract choices

Zod validates external input and model tool arguments. JSON-safe DTOs cross process boundaries. Route Handlers and cursor polling are the baseline; tRPC or SSE are optional changes, not parallel requirements. Artifact routes resolve known IDs and confined paths. Persist state changes and corresponding events transactionally.

## Reliability privacy and operating limits

### Proposed defaults

OP01 P0 — Defaults are 10 minutes per investigation, 30 model calls, 6 experiment plans, 3 confirmation attempts and 2 repair attempts. Baselines and repeats count as trials, not extra plans. All phases share the wall-clock deadline; reaching a budget yields partial results with an explicit stop reason.

Apply per-action and request-match timeouts of 10 seconds, a 15-second maximum response hold and a configurable command timeout bounded by the remaining run time. Limit evidence bodies to 64 KiB per captured item and total artifacts to 250 MiB per run. These are initial tunable product decisions, to be adjusted after measured runs.

### Responsiveness and failure handling

OP02 P0 — Target local queue acknowledgement within 2 seconds, progress visibility within 2 seconds of persistence, cancellation acknowledgement within 2 seconds and worker cleanup within 10 seconds. Measure on the documented demo machine. Show delayed cleanup if a process cannot be terminated within the target.

Model errors receive bounded retries for transient failures. Invalid plans receive corrective feedback. Repeated failures terminate the affected phase with evidence. Do not rerun potentially state-changing commands simply because the model call or connection timed out.

### Local data and model boundary

PR01 P0 — Keep run artifacts local by default. Clearly explain that selected source excerpts and browser observations are sent to the configured model provider. Never describe the entire investigation as offline. API keys remain server-side and are never exposed through public environment variables.

Exclude dependency folders, generated output, credentials and environment files from routine source collection. Redact authorization headers, cookies and configured secret patterns before persistence, model submission and export. Limit and label truncated bodies. Screenshots may still contain visible application data; use synthetic demo data and show what evidence is captured.

### Execution boundaries

PR02 P0 — Bind the local service to loopback, reject inappropriate cross-origin mutations and validate permitted target origins. Keep repository reads and artifact paths confined after resolving symlinks. Discovery has no source-write capability. Repair writes only in its isolated workspace; commands are configured or explicitly permitted and have timeouts and output limits.

Local repository commands execute with the developer’s machine permissions; an isolated checkout is not an OS security sandbox. P0 is for trusted local projects. Do not claim safe execution of hostile repositories or arbitrary internet targets.

### Retention and diagnosability

Preserve evidence until explicitly removed; do not silently delete findings when limits are reached. On capacity exhaustion, stop additional capture and label missing evidence. Provide documented local cleanup for P0; a deletion UI can follow later. Exports omit secrets and include a manifest of required artifacts and versions.

Record source identity, runner/browser versions, effective configuration, timestamps, model/provider identifier, tool-call history and token usage when returned. Display unknown usage as unknown; avoid invented cost estimates. Logs must support diagnosis without leaking credentials.

## Acceptance delivery and remaining decisions

### Release acceptance suite

AT01 — From a fresh setup, create a project and run, refresh the page and recover the same persisted state. Exactly one worker claims the run. Queue and running cancellation retain coherent terminal records.

AT02 — With the existing scripted experiment, observe real requests, releases, snapshots and assertion results in the GUI. This proves the execution path before autonomous discovery is integrated.

AT03 — On the buggy fixture, the agent uses source and browser evidence to generate its own test. The baseline passes and the intervention exposes the expected stale overwrite. All confirmation outcomes are recorded; no fixture-specific behaviour is embedded in engine code.

AT04 — Exported regression test fails on the original snapshot for the stated reason. Repair produces an actual source diff in isolation. Protected test hashes remain unchanged and the patched app is demonstrably served from that workspace.

AT05 — The patched app passes the frozen test, baseline, applicable timing variations and configured project checks. The visual comparison shows the corrected result. The authored fixed fixture is a control, never a substitute for generated repair.

AT06 — Missing selectors, ambiguous traffic, model failure, cancellation, worker crash and missing artifacts yield truthful outcomes and retain inspectable evidence. No unsupported or unexecuted check is shown as passing.

### Delivery sequence

M1 Foundation: review the coding agent’s Next.js output, persistence, contracts and actual check results. Gate: AT01 without the full executor.

M2 Real execution: integrate the verified runner, transactional worker claim and evidence feed. Gate: AT02 and cancellation cleanup.

M3 Autonomous investigation: source tools, browser tools, plan schemas and Muse loop. Gate: AT03 without a hand-authored action plan.

M4 Visual explanation: synchronized timeline, snapshots, inspector and finding detail. Gate: the failure is understandable from saved evidence.

M5 Repair and verification: freeze/export the test, create the isolated patch and rerun independently. Gate: AT04 and AT05.

M6 Harden and present: failure cases, repeat demo, README and submission assets. Gate: AT06 and successful rehearsal from documented setup.

### Cut order and demo

Cut WebSocket control, reduction, arbitrary React state, SSE, extra fixtures and elaborate animation before cutting the complete HTTP journey. If repair remains incomplete, ship an explicitly discovery-only result; do not present it as satisfying this full P0 PRD.

Target a three-minute demonstration: introduce the problem; start or open a clearly labelled recorded investigation; show generated hypothesis and late response; inspect the source diff; show the unchanged test passing after repair. Retain an authentic recorded fallback with run IDs and source identity.

### Decisions and release checklist

Confirm actual Muse API capabilities and SDK/tool schema during integration. Confirm repository commands, clean-source capture, assertion operators and interception constraints in M1–M3. The historical plan targets 4 November 2026; verify the exact organiser deadline, timezone, eligibility and submission rules from the current event portal before release.

Prepare repository access, setup instructions, dependency versions, demonstration video, product description, known limitations and required organiser disclosures. This PRD supersedes earlier single-process planning; it specifies intended behaviour and does not certify unreviewed implementation work as complete.
