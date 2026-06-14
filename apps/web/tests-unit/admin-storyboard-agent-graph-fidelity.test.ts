import { describe, expect, test } from 'bun:test';

import { buildStoryboardAgentGraphFidelity } from '../lib/admin/storyboard/agent-graph-fidelity';
import type { StoryboardGraphDiagnostics } from '../lib/admin/storyboard/types';

function canonicalReferenceGraph() {
  return {
    lifecycle: {
      start: true,
      extractSlots: true,
      supervisor: true,
      researcherDelegated: true,
      designerDelegated: true,
      internRoutedByResearcher: true,
      end: true,
    },
    supervisor: {
      research_sufficient: true,
      agent_instructions: { researcher: 'collect scene data', designer: 'draft storyboard' },
      is_approved: { researcher: true, designer: true },
      research_scene_data: [{ scene: 'first bite' }],
      research_web_summary: 'web and caption summary',
      human_feedback: ['tighten cut 3'],
      intern_result: { tool: 'search_scene_data.py reviewed' },
      messages: ['supervisor routed tasks'],
    },
    researcher: {
      agent_instructions: ['self-RAG with search_scene_data'],
      research_sufficient: true,
      research_summary: 'scene/caption data collected',
      previous_queries: ['first bite replay', 'texture closeup'],
      researcher_stall_summary: 'no stall after Intern tool update',
      intern_request: { tool: 'create search_scene_data RPC adapter' },
      intern_result: { reviewed: true },
      researcher_think_count: 3,
      messages: ['think', 'tools', 'evaluate'],
      loop: { think: true, tools: true, evaluate: true },
    },
    intern: {
      intern_request: { tool: 'search_scene_data.py' },
      agent_instructions: ['plan before mutation'],
      intern_action: 'create_modify_tool_rpc',
      pending_execute_calls: ['create_tool'],
      intern_result: { status: 'reviewed' },
      modified_tool_calls: ['search_scene_data'],
      plan_update_events: ['plan', 'review_create', 'execute'],
      messages: ['plan approved', 'human approved execution'],
      planCreated: true,
      review: { planApproved: true },
      toolRpcMutation: true,
      searchSceneDataReviewed: true,
      humanInterrupts: {
        beforeCreateDelete: true,
        afterToolRpcGeneration: true,
        blocksUnapprovedExecution: true,
        recordsHumanDecision: true,
        reviewBeforeTrust: true,
      },
    },
    designer: {
      research_scene_data: [{ scene: 'first bite' }],
      research_web_summary: 'caption/web summary',
      final_output: '# storyboard',
      storyboard_history: ['draft', 'revision'],
      human_feedback: ['make cut 3 calmer'],
      conversation_summary: 'operator feedback applied',
      feedback_action: 'revise_and_finalize',
      messages: ['drafted from research data'],
    },
    audit: {
      persisted: true,
      perAgentStateVisible: true,
      messagesCaptured: true,
      eventsOrdered: true,
      safeForPublicUi: true,
      evidencePointers: ['backend/storyboard-agent/src/graph.py', 'search_scene_data.py'],
    },
  };
}

const genericGraph: StoryboardGraphDiagnostics = {
  status: 'used',
  runtime: 'langgraph',
  mode: 'graph_command',
  threadId: 'generic-thread',
  checkpointer: 'MemorySaver',
  checkpointerScope: 'per_process_only',
  nodesVisited: ['extract_slots', 'supervisor', 'researcher', 'intern', 'designer'],
  interrupts: [{ node: 'designer', resumable: true, outputReady: true, summary: 'review' }],
  toolsCalled: ['search_scene_data'],
  retrieval: { status: 'used' },
};

describe('storyboard agent graph fidelity', () => {
  test('keeps fallback/local adapter below the AHP 98 reference graph gate', () => {
    const report = buildStoryboardAgentGraphFidelity({
      mode: 'backend_agent_local_adapter',
      finalOutputReady: true,
    });

    expect(report.status).toBe('needs_iteration');
    expect(report.score).toBeLessThan(98);
    expect(report.evidenceMode).toBe('local_adapter_gap');
    expect(report.blockers.join('\n')).toContain('Intern Tool/RPC mutation');
    expect(report.roles.find((role) => role.id === 'intern')?.evidenceState).toBe('blocked');
  });

  test('passes only with canonical Supervisor/Researcher/Intern/Designer evidence', () => {
    const report = buildStoryboardAgentGraphFidelity({
      candidate: { referenceGraph: canonicalReferenceGraph() },
      graph: genericGraph,
      mode: 'backend_agent_command',
      finalOutputReady: true,
      storyboardHistoryCount: 2,
    });

    expect(report.status).toBe('passed');
    expect(report.score).toBeGreaterThanOrEqual(98);
    expect(report.evidenceMode).toBe('canonical_reference_graph');
    expect(report.blockers).toEqual([]);
    expect(report.roles.every((role) => role.evidenceState === 'supported')).toBe(true);
  });

  test('does not treat generic nodesVisited/toolsCalled as enough for reference graph fidelity', () => {
    const report = buildStoryboardAgentGraphFidelity({
      graph: genericGraph,
      mode: 'backend_agent_command',
      finalOutputReady: true,
    });

    expect(report.status).toBe('needs_iteration');
    expect(report.score).toBeLessThan(98);
    expect(report.evidenceMode).toBe('backend_diagnostics_partial');
    expect(report.blockers.join('\n')).toContain('Supervisor approval');
    expect(report.blockers.join('\n')).toContain('Required human interrupts');
  });
});
