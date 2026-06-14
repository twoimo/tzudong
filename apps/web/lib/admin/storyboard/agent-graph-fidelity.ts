import type {
  StoryboardAgentGraphEvidenceState,
  StoryboardAgentGraphFidelityReport,
  StoryboardAgentGraphRoleId,
  StoryboardDataMode,
  StoryboardGraphDiagnostics,
} from './types';

export const STORYBOARD_AGENT_GRAPH_AHP_TARGET = 98;

const COMMITTEE = [
  { role: 'Supervisor reviewer', focus: 'task routing, approvals, and feedback reflection' },
  { role: 'Research lead', focus: 'self-RAG loop, query history, and data sufficiency' },
  { role: 'Tooling safety engineer', focus: 'Intern Tool/RPC mutation, code review, and human interrupts' },
  { role: 'Storyboard designer', focus: 'research-fed output, history, and feedback loop' },
  { role: 'QA/AHP chair', focus: 'weighted scoring, blockers, and evidence traceability' },
];

const CRITERIA = [
  { id: 'topology', label: 'Workflow topology fidelity', weight: 20 },
  { id: 'supervisor', label: 'Supervisor orchestration', weight: 18 },
  { id: 'researcher', label: 'Researcher self-RAG loop', weight: 15 },
  { id: 'intern', label: 'Intern safety/tool controls', weight: 17 },
  { id: 'designer', label: 'Designer feedback/storyboard loop', weight: 12 },
  { id: 'observability', label: 'State observability/auditability', weight: 10 },
  { id: 'humanLoop', label: 'Human-in-the-loop correctness', weight: 8 },
] as const;

type CriterionId = (typeof CRITERIA)[number]['id'];

type RecordValue = Record<string, unknown>;

export type StoryboardAgentGraphFidelityInput = {
  mode?: StoryboardDataMode;
  graph?: StoryboardGraphDiagnostics | null;
  candidate?: unknown;
  storyboardHistoryCount?: number;
  finalOutputReady?: boolean;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function bool(value: unknown) {
  return value === true;
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEntries(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return hasText(value);
}

function getNested(record: RecordValue, keys: string[]) {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function normalizeCandidate(value: unknown): RecordValue {
  const root = asRecord(value);
  const directReference = root.referenceGraph;
  if (isRecord(directReference)) return directReference;
  const nestedReference = getNested(root, ['agentGraphFidelity', 'referenceGraph']);
  if (isRecord(nestedReference)) return nestedReference;
  const backendReference = getNested(root, ['backendAgent', 'referenceGraph']);
  if (isRecord(backendReference)) return backendReference;
  const backendFidelityReference = getNested(root, ['backendAgent', 'agentGraphFidelity', 'referenceGraph']);
  if (isRecord(backendFidelityReference)) return backendFidelityReference;
  return root;
}

function hasNode(graph: StoryboardGraphDiagnostics | null | undefined, names: string[]) {
  const haystack = new Set((graph?.nodesVisited ?? []).map((node) => node.toLowerCase()));
  return names.some((name) => haystack.has(name.toLowerCase()));
}

function hasTool(graph: StoryboardGraphDiagnostics | null | undefined, names: string[]) {
  const haystack = new Set((graph?.toolsCalled ?? []).map((tool) => tool.toLowerCase()));
  return names.some((name) => haystack.has(name.toLowerCase()));
}

function percent(passed: number, total: number) {
  if (total <= 0) return 0;
  return Number(((passed / total) * 100).toFixed(2));
}

function scoreToEvidenceState(score: number, blocked = false): StoryboardAgentGraphEvidenceState {
  if (blocked) return 'blocked';
  if (score >= 95) return 'supported';
  if (score >= 35) return 'adapter';
  return 'missing';
}

function scoreTopology(reference: RecordValue, graph?: StoryboardGraphDiagnostics | null) {
  const lifecycle = asRecord(reference.lifecycle);
  const checks = [
    bool(lifecycle.start) || asArray(lifecycle.order).includes('start'),
    bool(lifecycle.extractSlots) || bool(lifecycle.extract_slots) || hasNode(graph, ['extract_slots']),
    bool(lifecycle.supervisor) || hasNode(graph, ['supervisor']),
    bool(lifecycle.researcherDelegated) || hasNode(graph, ['researcher']),
    bool(lifecycle.designerDelegated) || hasNode(graph, ['designer']),
    bool(lifecycle.internRoutedByResearcher) || hasNode(graph, ['intern']),
    bool(lifecycle.end) || asArray(lifecycle.order).includes('end'),
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreSupervisor(reference: RecordValue) {
  const supervisor = asRecord(reference.supervisor);
  const approvals = asRecord(supervisor.is_approved ?? supervisor.isApproved ?? supervisor.approvals);
  const checks = [
    bool(supervisor.research_sufficient ?? supervisor.researchSufficient),
    hasEntries(supervisor.agent_instructions ?? supervisor.agentInstructions),
    bool(approvals.researcher),
    bool(approvals.designer),
    hasEntries(supervisor.research_scene_data ?? supervisor.researchSceneData),
    hasEntries(supervisor.research_web_summary ?? supervisor.researchWebSummary),
    hasEntries(supervisor.human_feedback ?? supervisor.humanFeedback),
    hasEntries(supervisor.intern_result ?? supervisor.internResult),
    hasEntries(supervisor.messages),
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreResearcher(reference: RecordValue, graph?: StoryboardGraphDiagnostics | null) {
  const researcher = asRecord(reference.researcher);
  const loop = asRecord(researcher.loop ?? researcher.selfRag);
  const checks = [
    hasEntries(researcher.agent_instructions ?? researcher.agentInstructions),
    bool(researcher.research_sufficient ?? researcher.researchSufficient),
    hasEntries(researcher.research_summary ?? researcher.researchSummary),
    hasEntries(researcher.previous_queries ?? researcher.previousQueries),
    hasEntries(researcher.researcher_stall_summary ?? researcher.researcherStallSummary),
    hasEntries(researcher.intern_request ?? researcher.internRequest),
    hasEntries(researcher.intern_result ?? researcher.internResult),
    Number(researcher.researcher_think_count ?? researcher.researcherThinkCount) > 0,
    hasEntries(researcher.messages),
    bool(loop.think) || hasNode(graph, ['researcher']),
    bool(loop.tools) || hasTool(graph, ['search_scene_data']),
    bool(loop.evaluate) || graph?.retrieval?.status === 'used',
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreIntern(reference: RecordValue, graph?: StoryboardGraphDiagnostics | null) {
  const intern = asRecord(reference.intern);
  const review = asRecord(intern.review ?? intern.codeReview ?? intern.code_review);
  const interrupts = asRecord(intern.human_interrupts ?? intern.humanInterrupts);
  const checks = [
    hasEntries(intern.intern_request ?? intern.internRequest),
    hasEntries(intern.agent_instructions ?? intern.agentInstructions),
    hasEntries(intern.intern_action ?? intern.internAction),
    hasEntries(intern.pending_execute_calls ?? intern.pendingExecuteCalls),
    hasEntries(intern.intern_result ?? intern.internResult),
    hasEntries(intern.modified_tool_calls ?? intern.modifiedToolCalls),
    hasEntries(intern.plan_update_events ?? intern.planUpdateEvents),
    hasEntries(intern.messages),
    bool(intern.planCreated ?? intern.plan_created),
    bool(review.planApproved ?? review.plan_approved ?? review.approved),
    bool(intern.toolRpcMutation ?? intern.tool_rpc_mutation),
    bool(intern.searchSceneDataReviewed ?? intern.search_scene_data_reviewed) || hasTool(graph, ['search_scene_data']),
    bool(interrupts.beforeCreateDelete ?? interrupts.before_create_delete),
    bool(interrupts.afterToolRpcGeneration ?? interrupts.after_tool_rpc_generation),
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreDesigner(reference: RecordValue, input: StoryboardAgentGraphFidelityInput) {
  const designer = asRecord(reference.designer);
  const checks = [
    hasEntries(designer.research_scene_data ?? designer.researchSceneData),
    hasEntries(designer.research_web_summary ?? designer.researchWebSummary),
    hasEntries(designer.final_output ?? designer.finalOutput) || Boolean(input.finalOutputReady),
    hasEntries(designer.storyboard_history ?? designer.storyboardHistory) || (input.storyboardHistoryCount ?? 0) > 0,
    hasEntries(designer.human_feedback ?? designer.humanFeedback),
    hasEntries(designer.conversation_summary ?? designer.conversationSummary),
    hasEntries(designer.feedback_action ?? designer.feedbackAction),
    hasEntries(designer.messages),
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreObservability(reference: RecordValue, graph?: StoryboardGraphDiagnostics | null) {
  const audit = asRecord(reference.audit ?? reference.observability);
  const checks = [
    bool(audit.persisted) || Boolean(graph),
    bool(audit.perAgentStateVisible ?? audit.per_agent_state_visible),
    bool(audit.messagesCaptured ?? audit.messages_captured),
    bool(audit.eventsOrdered ?? audit.events_ordered),
    bool(audit.safeForPublicUi ?? audit.safe_for_public_ui),
    hasEntries(audit.evidencePointers ?? audit.evidence_pointers),
  ];
  return percent(checks.filter(Boolean).length, checks.length);
}

function scoreHumanLoop(reference: RecordValue, graph?: StoryboardGraphDiagnostics | null) {
  const intern = asRecord(reference.intern);
  const interrupts = asRecord(intern.human_interrupts ?? intern.humanInterrupts);
  const graphInterruptReady = Boolean(
    graph?.interrupts?.some((interrupt) => interrupt.resumable || interrupt.outputReady),
  );
  const checks = [
    bool(interrupts.beforeCreateDelete ?? interrupts.before_create_delete),
    bool(interrupts.afterToolRpcGeneration ?? interrupts.after_tool_rpc_generation),
    bool(interrupts.blocksUnapprovedExecution ?? interrupts.blocks_unapproved_execution),
    bool(interrupts.recordsHumanDecision ?? interrupts.records_human_decision),
    bool(interrupts.reviewBeforeTrust ?? interrupts.review_before_trust),
  ];
  const raw = percent(checks.filter(Boolean).length, checks.length);
  return raw > 0 ? raw : graphInterruptReady ? 40 : 0;
}

function buildCriterion(id: CriterionId, score: number, evidence: string) {
  const criterion = CRITERIA.find((item) => item.id === id)!;
  return {
    id,
    label: criterion.label,
    weight: criterion.weight,
    score: Number(score.toFixed(2)),
    evidence,
  };
}

function role(
  id: StoryboardAgentGraphRoleId,
  label: string,
  score: number,
  evidence: string,
  blocked = false,
) {
  return {
    id,
    label,
    evidenceState: scoreToEvidenceState(score, blocked),
    score: Number(score.toFixed(2)),
    evidence,
  };
}

export function buildStoryboardAgentGraphFidelity(
  input: StoryboardAgentGraphFidelityInput = {},
): StoryboardAgentGraphFidelityReport {
  const reference = normalizeCandidate(input.candidate);
  const graph = input.graph ?? null;
  const topology = scoreTopology(reference, graph);
  const supervisor = scoreSupervisor(reference);
  const researcher = scoreResearcher(reference, graph);
  const intern = scoreIntern(reference, graph);
  const designer = scoreDesigner(reference, input);
  const observability = scoreObservability(reference, graph);
  const humanLoop = scoreHumanLoop(reference, graph);

  const criteria = [
    buildCriterion('topology', topology, 'Start/extract_slots/Supervisor/delegated-agent/end topology evidence.'),
    buildCriterion('supervisor', supervisor, 'Supervisor instructions, approvals, research data, feedback, intern result, and messages.'),
    buildCriterion('researcher', researcher, 'Researcher Think/Tools/Evaluate loop, previous queries, sufficiency, stalls, and Intern request evidence.'),
    buildCriterion('intern', intern, 'Intern plan, Tool/RPC mutation, code-review, search_scene_data review, pending execution, and messages.'),
    buildCriterion('designer', designer, 'Designer research-fed final output, storyboard history, feedback action, and conversation summary.'),
    buildCriterion('observability', observability, 'Persisted/visible per-agent state, ordered events, messages, and evidence pointers.'),
    buildCriterion('humanLoop', humanLoop, 'Human interrupt before create/delete and after generated Tool/RPC before trust/execution.'),
  ];
  const weightedScore = criteria.reduce(
    (sum, criterion) => sum + (criterion.weight * criterion.score) / 100,
    0,
  );
  const score = Number(weightedScore.toFixed(2));

  const blockers: string[] = [];
  if (topology < 98) blockers.push('Reference graph topology is incomplete or adapter-only.');
  if (supervisor < 98) blockers.push('Supervisor approval/state contract is not fully evidenced.');
  if (researcher < 98) blockers.push('Researcher self-RAG sufficiency loop is not fully evidenced.');
  if (intern < 98) blockers.push('Intern Tool/RPC mutation, review, and execution state is not fully evidenced.');
  if (humanLoop < 98) blockers.push('Required human interrupts before create/delete and after Tool/RPC generation are missing.');
  if (observability < 98) blockers.push('Per-agent audit state is not fully persisted/observable.');

  const passed =
    score >= STORYBOARD_AGENT_GRAPH_AHP_TARGET && blockers.length === 0;
  const evidenceMode: StoryboardAgentGraphFidelityReport['evidenceMode'] =
    passed
      ? 'canonical_reference_graph'
      : graph?.runtime === 'langgraph'
        ? 'backend_diagnostics_partial'
        : input.mode === 'backend_agent_local_adapter'
          ? 'local_adapter_gap'
          : 'fallback_gap';

  const status = passed ? 'passed' : 'needs_iteration';

  return {
    targetScore: STORYBOARD_AGENT_GRAPH_AHP_TARGET,
    score,
    status,
    evidenceMode,
    committee: COMMITTEE,
    roles: [
      role('supervisor', 'Supervisor', supervisor, 'Routes agents, reflects feedback, and gates approvals.'),
      role('researcher', 'Researcher', researcher, 'Runs self-RAG data acquisition and sufficiency evaluation.'),
      role('intern', 'Intern', intern, 'Creates/modifies Tool/RPC under review and human interrupts.', intern < 98),
      role('designer', 'Designer', designer, 'Creates storyboard from research data and feedback history.'),
    ],
    criteria,
    blockers,
    nextActions: status === 'passed'
      ? ['Canonical reference graph evidence passes the AHP 98 gate for this fixture/result.']
      : [
          'Provide canonical Supervisor/Researcher/Intern/Designer state from the backend graph.',
          'Add Intern Tool/RPC mutation review evidence and human interrupt decisions.',
          'Keep storyboard content AHP separate from reference graph fidelity.',
        ],
  };
}
