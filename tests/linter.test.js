const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  RULE,
  DEFAULT_SEVERITY,
  SUCCESS_LABELS_DEFAULT,
  loadConfig,
  applyRulePack,
  lintFlow,
  graphStats,
  formatReport,
  indexNodes,
  indexTools,
  iterEdges,
  hasSuccessEdge,
  detectCycles,
  checkReachability,
} = require('../src/linter');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal valid flow — one conversation node + one end node. */
function validFlow() {
  return {
    model_choice: { type: 'llm', model: 'gpt-4o' },
    start_node_id: 'n1',
    nodes: [
      {
        id: 'n1', name: 'Greeting', type: 'conversation',
        instruction: { text: 'Hello' },
        edges: [{ id: 'e1', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Done' } }],
      },
      { id: 'n2', name: 'End', type: 'end', instruction: { text: 'Bye' } },
    ],
    tools: [],
  };
}

function findIssue(issues, code) {
  return issues.find((i) => i.code === code);
}

function findAllIssues(issues, code) {
  return issues.filter((i) => i.code === code);
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  it('returns defaults when no path given', () => {
    const cfg = loadConfig(null);
    assert.deepStrictEqual(cfg.severity_overrides, {});
    assert.ok(Array.isArray(cfg.success_edge_labels));
    assert.strictEqual(cfg.disable_reachability, false);
  });

  it('loads overrides from a config file', () => {
    const tmp = path.join(os.tmpdir(), `linter-cfg-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ severity_overrides: { W420: 'IGNORE' } }));
    try {
      const cfg = loadConfig(tmp);
      assert.strictEqual(cfg.severity_overrides.W420, 'IGNORE');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('uses defaults if config file is unreadable', () => {
    const cfg = loadConfig('/nonexistent/path.json');
    assert.deepStrictEqual(cfg.severity_overrides, {});
  });
});

// ---------------------------------------------------------------------------
// applyRulePack
// ---------------------------------------------------------------------------

describe('applyRulePack', () => {
  it('strict-import pack downgrades certain rules', () => {
    const cfg = { severity_overrides: {} };
    applyRulePack(cfg, 'strict-import');
    assert.strictEqual(cfg.severity_overrides.W212, 'INFO');
    assert.strictEqual(cfg.severity_overrides.I500, 'IGNORE');
  });

  it('advisory pack is a no-op', () => {
    const cfg = { severity_overrides: {} };
    applyRulePack(cfg, 'advisory');
    assert.deepStrictEqual(cfg.severity_overrides, {});
  });
});

// ---------------------------------------------------------------------------
// indexNodes / indexTools / iterEdges
// ---------------------------------------------------------------------------

describe('indexNodes', () => {
  it('builds a map from node id to node', () => {
    const flow = { nodes: [{ id: 'a' }, { id: 'b' }] };
    const map = indexNodes(flow);
    assert.ok('a' in map);
    assert.ok('b' in map);
  });

  it('handles missing nodes array', () => {
    assert.deepStrictEqual(indexNodes({}), {});
  });
});

describe('indexTools', () => {
  it('builds a map from tool_id to tool', () => {
    const flow = { tools: [{ tool_id: 't1', name: 'Foo' }] };
    const map = indexTools(flow);
    assert.ok('t1' in map);
  });
});

describe('iterEdges', () => {
  it('includes regular edges, else_edge, and skip_response_edge', () => {
    const node = {
      edges: [{ id: 'e1', destination_node_id: 'a' }],
      else_edge: { id: 'e2', destination_node_id: 'b' },
      skip_response_edge: { id: 'e3', destination_node_id: 'c' },
    };
    const edges = iterEdges(node);
    assert.strictEqual(edges.length, 3);
    const dests = edges.map((e) => e.destination_node_id);
    assert.deepStrictEqual(dests, ['a', 'b', 'c']);
  });

  it('handles node with no edges', () => {
    assert.deepStrictEqual(iterEdges({}), []);
  });
});

// ---------------------------------------------------------------------------
// hasSuccessEdge
// ---------------------------------------------------------------------------

describe('hasSuccessEdge', () => {
  it('returns true when a success label matches', () => {
    const node = {
      edges: [{ transition_condition: { prompt: 'If successful' } }],
    };
    assert.ok(hasSuccessEdge(node, SUCCESS_LABELS_DEFAULT));
  });

  it('returns false when no edge matches', () => {
    const node = {
      edges: [{ transition_condition: { prompt: 'On failure' } }],
    };
    assert.ok(!hasSuccessEdge(node, SUCCESS_LABELS_DEFAULT));
  });
});

// ---------------------------------------------------------------------------
// lintFlow — valid flow
// ---------------------------------------------------------------------------

describe('lintFlow — valid flow', () => {
  it('produces no errors for a minimal valid flow', () => {
    const result = lintFlow(validFlow());
    const errors = result.issues.filter((i) => i.level === 'ERROR');
    assert.strictEqual(errors.length, 0);
  });
});

// ---------------------------------------------------------------------------
// E100 — MODEL_CHOICE_INVALID
// ---------------------------------------------------------------------------

describe('E100 — MODEL_CHOICE_INVALID', () => {
  it('fires when model_choice is missing', () => {
    const flow = validFlow();
    delete flow.model_choice;
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E100'));
  });

  it('fires when model_choice lacks type', () => {
    const flow = validFlow();
    flow.model_choice = { model: 'gpt-4o' };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E100'));
  });

  it('fires when model_choice lacks model', () => {
    const flow = validFlow();
    flow.model_choice = { type: 'llm' };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E100'));
  });
});

// ---------------------------------------------------------------------------
// E110 — DEFAULT_NOT_STRING
// ---------------------------------------------------------------------------

describe('E110 — DEFAULT_NOT_STRING', () => {
  it('fires when a default var value is not a string', () => {
    const flow = validFlow();
    flow.default_dynamic_variables = { count: 42 };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E110'));
  });

  it('does not fire when all values are strings', () => {
    const flow = validFlow();
    flow.default_dynamic_variables = { name: 'Andrew' };
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'E110'));
  });

  it('autofix converts non-string values to JSON strings', () => {
    const flow = validFlow();
    flow.default_dynamic_variables = { count: 42, flag: true };
    const result = lintFlow(flow, { autofix: true });
    assert.strictEqual(result.flow.default_dynamic_variables.count, '42');
    assert.strictEqual(result.flow.default_dynamic_variables.flag, 'true');
  });
});

// ---------------------------------------------------------------------------
// E200 — NODE_CONV_NEEDS_TEXT
// ---------------------------------------------------------------------------

describe('E200 — NODE_CONV_NEEDS_TEXT', () => {
  it('fires when conversation node is missing instruction.text', () => {
    const flow = validFlow();
    delete flow.nodes[0].instruction;
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E200'));
  });
});

// ---------------------------------------------------------------------------
// E210 — NODE_FUNC_NO_TOOL
// ---------------------------------------------------------------------------

describe('E210 — NODE_FUNC_NO_TOOL', () => {
  it('fires when function node has no tool_id', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'Func', type: 'function',
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E210'));
  });

  it('fires when tool_id references a non-existent tool', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'Func', type: 'function', tool_id: 'missing-tool',
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    const e210s = findAllIssues(issues, 'E210');
    assert.ok(e210s.some((i) => i.msg.includes('missing-tool')));
  });
});

// ---------------------------------------------------------------------------
// W212 — NODE_FUNC_MISSING_SUCCESS
// ---------------------------------------------------------------------------

describe('W212 — NODE_FUNC_MISSING_SUCCESS', () => {
  it('fires when function node has no success edge', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'Func', type: 'function', tool_id: 't1',
      instruction: { text: 'call it' },
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'Always' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W212'));
  });

  it('does not fire when success edge present', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'Func', type: 'function', tool_id: 't1',
      instruction: { text: 'call it' },
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W212'));
  });
});

// ---------------------------------------------------------------------------
// E220 — NODE_EXTRACT_NEEDS_VARS
// ---------------------------------------------------------------------------

describe('E220 — NODE_EXTRACT_NEEDS_VARS', () => {
  it('fires when extract node has no variables', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'ex1', name: 'Extract', type: 'extract_dynamic_variables',
      edges: [{ id: 'e2', destination_node_id: 'n2' }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'ex1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E220'));
  });

  it('does not fire when variables array is populated', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'ex1', name: 'Extract', type: 'extract_dynamic_variables',
      variables: [{ name: 'user_name' }],
      edges: [{ id: 'e2', destination_node_id: 'n2' }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'ex1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'E220'));
  });
});

// ---------------------------------------------------------------------------
// E230 — NODE_BRANCH_MISSING_ELSE
// ---------------------------------------------------------------------------

describe('E230 — NODE_BRANCH_MISSING_ELSE', () => {
  it('fires when branch node has Else in edges but no else_edge', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'br1', name: 'Branch', type: 'branch',
      edges: [
        { id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'Else' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'br1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E230'));
  });

  it('autofix stubs an else_edge', () => {
    const flow = validFlow();
    flow.nodes.splice(1, 0, {
      id: 'br1', name: 'Branch', type: 'branch',
      edges: [
        { id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'Else' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'br1';
    const result = lintFlow(flow, { autofix: true });
    const branchNode = result.flow.nodes.find((n) => n.id === 'br1');
    assert.ok(branchNode.else_edge);
    assert.strictEqual(branchNode.else_edge.id, 'auto-br1-else');
  });
});

// ---------------------------------------------------------------------------
// W240 — NODE_END_HAS_EDGES
// ---------------------------------------------------------------------------

describe('W240 — NODE_END_HAS_EDGES', () => {
  it('fires when end node has outgoing edges', () => {
    const flow = validFlow();
    flow.nodes[1].edges = [{ id: 'e3', destination_node_id: 'n1' }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W240'));
  });
});

// ---------------------------------------------------------------------------
// W300 — EDGE_NO_DEST / E310 — EDGE_UNKNOWN_DEST
// ---------------------------------------------------------------------------

describe('edge checks', () => {
  it('W300 fires for edge with no destination', () => {
    const flow = validFlow();
    flow.nodes[0].edges.push({ id: 'e-orphan' });
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W300'));
  });

  it('E310 fires for edge pointing to unknown node', () => {
    const flow = validFlow();
    flow.nodes[0].edges.push({ id: 'e-bad', destination_node_id: 'ghost' });
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E310'));
  });
});

// ---------------------------------------------------------------------------
// E400 — START_NOT_FOUND
// ---------------------------------------------------------------------------

describe('E400 — START_NOT_FOUND', () => {
  it('fires when start_node_id is not in nodes', () => {
    const flow = validFlow();
    flow.start_node_id = 'nonexistent';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E400'));
  });
});

// ---------------------------------------------------------------------------
// E410 — NO_END_NODE
// ---------------------------------------------------------------------------

describe('E410 — NO_END_NODE', () => {
  it('fires when no end node exists', () => {
    const flow = validFlow();
    flow.nodes = flow.nodes.filter((n) => n.type !== 'end');
    flow.nodes[0].edges = [];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E410'));
  });
});

// ---------------------------------------------------------------------------
// W420 — NODE_UNREACHABLE
// ---------------------------------------------------------------------------

describe('W420 — NODE_UNREACHABLE', () => {
  it('fires for a disconnected node', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'orphan', name: 'Orphan', type: 'conversation', instruction: { text: 'hi' } });
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W420'));
  });

  it('does not fire for global nodes', () => {
    const flow = validFlow();
    flow.nodes.push({
      id: 'global1', name: 'Global', type: 'conversation',
      instruction: { text: 'help' },
      global_node_setting: { enabled: true },
    });
    const { issues } = lintFlow(flow);
    assert.ok(!findAllIssues(issues, 'W420').some((i) => i.where.includes('Global')));
  });

  it('respects disable_reachability config', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'orphan', name: 'Orphan', type: 'conversation', instruction: { text: 'hi' } });
    const tmp = path.join(os.tmpdir(), `lint-no-reach-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ disable_reachability: true }));
    try {
      const { issues } = lintFlow(flow, { configPath: tmp });
      assert.ok(!findIssue(issues, 'W420'));
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// I430 — CYCLE_DETECTED
// ---------------------------------------------------------------------------

describe('I430 — CYCLE_DETECTED', () => {
  it('fires when a cycle exists', () => {
    const flow = validFlow();
    // n1 -> n2 already, add n2 -> n1 to create cycle
    flow.nodes[1].type = 'conversation';
    flow.nodes[1].instruction = { text: 'Loop back' };
    flow.nodes[1].edges = [{ id: 'e-back', destination_node_id: 'n1' }];
    // Add an end node so E410 doesn't fire
    flow.nodes.push({ id: 'n3', name: 'End', type: 'end' });
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'I430'));
  });

  it('does not fire in an acyclic flow', () => {
    const { issues } = lintFlow(validFlow());
    assert.ok(!findIssue(issues, 'I430'));
  });
});

// ---------------------------------------------------------------------------
// I500 — TOOL_UNREFERENCED
// ---------------------------------------------------------------------------

describe('I500 — TOOL_UNREFERENCED', () => {
  it('fires when a tool is not used by any function node', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'Unused Tool' }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'I500'));
  });

  it('does not fire when tool is referenced', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'UsedTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'Func', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'I500'));
  });
});

// ---------------------------------------------------------------------------
// W510 — TOOL_CUSTOM_NO_URL
// ---------------------------------------------------------------------------

describe('W510 — TOOL_CUSTOM_NO_URL', () => {
  it('fires when custom tool has no url', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'CustomNoUrl', type: 'custom' }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W510'));
  });

  it('does not fire when custom tool has a url', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'CustomOk', type: 'custom', url: 'https://example.com' }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W510'));
  });

  it('does not fire for non-custom tools', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'NativeTool', type: 'native' }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W510'));
  });
});

// ---------------------------------------------------------------------------
// E600 — DUP_NODE_IDS
// ---------------------------------------------------------------------------

describe('E600 — DUP_NODE_IDS', () => {
  it('fires when two nodes share the same ID', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'n1', name: 'Dupe', type: 'conversation', instruction: { text: 'hi' } });
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E600'));
  });
});

// ---------------------------------------------------------------------------
// skip_response_edge handling
// ---------------------------------------------------------------------------

describe('skip_response_edge', () => {
  it('is followed during reachability analysis', () => {
    const flow = {
      model_choice: { type: 'llm', model: 'gpt-4o' },
      start_node_id: 'n1',
      nodes: [
        {
          id: 'n1', name: 'Start', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [],
          skip_response_edge: { id: 'skip1', destination_node_id: 'n2' },
        },
        { id: 'n2', name: 'End', type: 'end' },
      ],
      tools: [],
    };
    const { issues } = lintFlow(flow);
    // n2 should be reachable via skip_response_edge
    assert.ok(!findIssue(issues, 'W420'));
  });

  it('validates skip_response_edge destination', () => {
    const flow = validFlow();
    flow.nodes[0].skip_response_edge = { id: 'skip-bad', destination_node_id: 'ghost' };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E310'));
  });
});

// ---------------------------------------------------------------------------
// graphStats
// ---------------------------------------------------------------------------

describe('graphStats', () => {
  it('computes correct stats for a simple flow', () => {
    const flow = validFlow();
    const stats = graphStats(flow);
    assert.strictEqual(stats.nodes, 2);
    assert.strictEqual(stats.edges, 1);
    assert.strictEqual(stats.isolated_nodes, 0);
  });

  it('detects isolated nodes', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'iso', name: 'Isolated', type: 'conversation' });
    const stats = graphStats(flow);
    assert.strictEqual(stats.isolated_nodes, 1);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('returns a formatted string with summary line', () => {
    const issues = [
      { level: 'ERROR', code: 'E100', where: 'model_choice', msg: 'bad' },
      { level: 'WARN', code: 'W300', where: 'node:X', msg: 'meh' },
    ];
    const report = formatReport(issues, 'test.json', null);
    assert.ok(report.includes('Retell Flow Lint Report'));
    assert.ok(report.includes('1 errors'));
    assert.ok(report.includes('1 warnings'));
  });

  it('includes stats when provided', () => {
    const report = formatReport([], 'test.json', { nodes: 5, edges: 8, avg_out_degree: 1.6, avg_in_degree: 1.6, isolated_nodes: 0 });
    assert.ok(report.includes('nodes=5'));
    assert.ok(report.includes('edges=8'));
  });
});

// ---------------------------------------------------------------------------
// severity overrides
// ---------------------------------------------------------------------------

describe('severity overrides', () => {
  it('config can downgrade an error to IGNORE', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'orphan', name: 'Orphan', type: 'conversation', instruction: { text: 'x' } });

    const tmp = path.join(os.tmpdir(), `lint-ign-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ severity_overrides: { W420: 'IGNORE' } }));
    try {
      const { issues } = lintFlow(flow, { configPath: tmp });
      assert.ok(!findIssue(issues, 'W420'));
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('strict-import pack suppresses TOOL_UNREFERENCED', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'Unused' }];
    const { issues } = lintFlow(flow, { rulePack: 'strict-import' });
    assert.ok(!findIssue(issues, 'I500'));
  });
});

// ---------------------------------------------------------------------------
// lintFlow returns sorted issues
// ---------------------------------------------------------------------------

describe('issue sorting', () => {
  it('errors sort before warnings before info', () => {
    const flow = validFlow();
    delete flow.model_choice; // E100
    flow.nodes.push({ id: 'orphan', name: 'Orphan', type: 'conversation', instruction: { text: 'x' } }); // W420
    flow.tools = [{ tool_id: 't1', name: 'Unused' }]; // I500

    const { issues } = lintFlow(flow);
    const levels = issues.map((i) => i.level);
    const errorIdx = levels.indexOf('ERROR');
    const warnIdx = levels.indexOf('WARN');
    const infoIdx = levels.indexOf('INFO');
    if (errorIdx !== -1 && warnIdx !== -1) assert.ok(errorIdx < warnIdx);
    if (warnIdx !== -1 && infoIdx !== -1) assert.ok(warnIdx < infoIdx);
  });
});

// ---------------------------------------------------------------------------
// stats option
// ---------------------------------------------------------------------------

describe('lintFlow stats option', () => {
  it('includes stats when requested', () => {
    const result = lintFlow(validFlow(), { stats: true });
    assert.ok(result.stats);
    assert.strictEqual(result.stats.nodes, 2);
  });

  it('omits stats by default', () => {
    const result = lintFlow(validFlow());
    assert.strictEqual(result.stats, undefined);
  });
});
