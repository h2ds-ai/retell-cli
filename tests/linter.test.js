const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  RULE,
  DEFAULT_SEVERITY,
  SUCCESS_LABELS_DEFAULT,
  UNARY_OPS,
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

// ---------------------------------------------------------------------------
// iterEdges — always_edge support
// ---------------------------------------------------------------------------

describe('iterEdges — always_edge', () => {
  it('includes always_edge in returned edges', () => {
    const node = {
      edges: [{ id: 'e1', destination_node_id: 'a' }],
      always_edge: { id: 'e4', destination_node_id: 'd' },
    };
    const edges = iterEdges(node);
    assert.strictEqual(edges.length, 2);
    const dests = edges.map((e) => e.destination_node_id);
    assert.ok(dests.includes('d'));
  });

  it('includes all four edge types together', () => {
    const node = {
      edges: [{ id: 'e1', destination_node_id: 'a' }],
      else_edge: { id: 'e2', destination_node_id: 'b' },
      skip_response_edge: { id: 'e3', destination_node_id: 'c' },
      always_edge: { id: 'e4', destination_node_id: 'd' },
    };
    const edges = iterEdges(node);
    assert.strictEqual(edges.length, 4);
    const dests = edges.map((e) => e.destination_node_id);
    assert.deepStrictEqual(dests, ['a', 'b', 'c', 'd']);
  });

  it('always_edge is followed during reachability', () => {
    const flow = {
      model_choice: { type: 'llm', model: 'gpt-4o' },
      start_node_id: 'n1',
      nodes: [
        {
          id: 'n1', name: 'Start', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [],
          always_edge: { id: 'ae1', destination_node_id: 'n2' },
        },
        { id: 'n2', name: 'End', type: 'end' },
      ],
      tools: [],
    };
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W420'));
  });
});

// ---------------------------------------------------------------------------
// W231 — NODE_FUNC_ELSE_PATTERN
// ---------------------------------------------------------------------------

describe('W231 — NODE_FUNC_ELSE_PATTERN', () => {
  it('fires when function node has Else in edges but no else_edge', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'DoSomething', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [
        { id: 'e-ok', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
        { id: 'e-else', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Else' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W231'));
  });

  it('does not fire when function node uses else_edge properly', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'DoSomething', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [
        { id: 'e-ok', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
      ],
      else_edge: { id: 'e-else', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Else' } },
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W231'));
  });

  it('does not fire when function node has no Else at all', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'DoSomething', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [
        { id: 'e-ok', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W231'));
  });
});

// ---------------------------------------------------------------------------
// W700 — EQUATION_INCOMPLETE
// ---------------------------------------------------------------------------

describe('W700 — EQUATION_INCOMPLETE', () => {
  it('fires when equation has empty left', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '', operator: '==', right: 'hello' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W700'));
    assert.ok(findIssue(issues, 'W700').msg.includes('empty left'));
  });

  it('fires when equation has empty operator', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '', right: 'hello' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W700'));
    assert.ok(findIssue(issues, 'W700').msg.includes('empty operator'));
  });

  it('fires when binary operator has missing right', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '==' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W700'));
    assert.ok(findIssue(issues, 'W700').msg.includes('missing right'));
  });

  it('does not fire for valid binary equation', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '==', right: 'hello' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('does not fire for binary operator with empty-string right (intentional "not blank" check)', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '!=', right: '' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('does not fire for unary operator (exists) without right', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: 'exists' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('does not fire for unary operator (not_exists) without right', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: 'not_exists' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('does not fire for unary operator (is_empty) without right', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: 'is_empty' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('does not fire for unary operator (is_not_empty) without right', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: 'is_not_empty' }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });

  it('ignores prompt-type edges (only checks equation type)', () => {
    const flow = validFlow();
    // Default validFlow already has prompt edges — should not trigger W700
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });
});

// ---------------------------------------------------------------------------
// UNARY_OPS constant
// ---------------------------------------------------------------------------

describe('UNARY_OPS', () => {
  it('contains the four known unary operators', () => {
    assert.ok(UNARY_OPS.has('exists'));
    assert.ok(UNARY_OPS.has('not_exists'));
    assert.ok(UNARY_OPS.has('is_empty'));
    assert.ok(UNARY_OPS.has('is_not_empty'));
  });

  it('does not contain binary operators', () => {
    assert.ok(!UNARY_OPS.has('=='));
    assert.ok(!UNARY_OPS.has('!='));
    assert.ok(!UNARY_OPS.has('contains'));
  });
});

// ---------------------------------------------------------------------------
// Component-level checking
// ---------------------------------------------------------------------------

describe('component-level checking', () => {
  it('detects function node without tool_id in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'MyComponent',
      nodes: [
        { id: 'cn1', name: 'CompFunc', type: 'function', edges: [] },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'E210').filter((i) => i.where.includes('MyComponent'));
    assert.ok(compIssues.length > 0);
  });

  it('detects function node else pattern in component', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'ATool' }];
    flow.components = [{
      id: 'comp1', name: 'MyComponent',
      nodes: [
        {
          id: 'cn1', name: 'CompFunc', type: 'function', tool_id: 't1',
          instruction: { text: 'do it' },
          edges: [
            { id: 'ce1', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
            { id: 'ce2', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Else' } },
          ],
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'W231').filter((i) => i.where.includes('MyComponent'));
    assert.ok(compIssues.length > 0);
  });

  it('detects branch missing else_edge in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'MyComponent',
      nodes: [
        {
          id: 'cn1', name: 'CompBranch', type: 'branch',
          edges: [
            { id: 'ce1', destination_node_id: 'n2', transition_condition: { prompt: 'Else' } },
          ],
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'E230').filter((i) => i.where.includes('MyComponent'));
    assert.ok(compIssues.length > 0);
  });

  it('detects equation issues in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'MyComponent',
      nodes: [
        {
          id: 'cn1', name: 'CompConv', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [{
            id: 'ceq1', destination_node_id: 'n2',
            transition_condition: {
              type: 'equation',
              equations: [{ left: '', operator: '==', right: 'x' }],
            },
          }],
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'W700').filter((i) => i.where.includes('MyComponent'));
    assert.ok(compIssues.length > 0);
  });

  it('does not fire for valid component nodes', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'ATool' }];
    flow.components = [{
      id: 'comp1', name: 'CleanComponent',
      nodes: [
        {
          id: 'cn1', name: 'CompFunc', type: 'function', tool_id: 't1',
          instruction: { text: 'do it' },
          edges: [
            { id: 'ce1', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
          ],
          else_edge: { id: 'ce2', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Else' } },
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = issues.filter((i) => i.where.includes('CleanComponent'));
    assert.strictEqual(compIssues.length, 0);
  });

  it('skips component checking when no components present', () => {
    const flow = validFlow();
    // No components key at all
    const { issues } = lintFlow(flow);
    // Should not crash, just skip
    assert.ok(Array.isArray(issues));
  });
});

// ---------------------------------------------------------------------------
// P0: I211 — NODE_FUNC_NEEDS_TEXT
// ---------------------------------------------------------------------------

describe('I211 — NODE_FUNC_NEEDS_TEXT', () => {
  it('fires as INFO when function node has no instruction.text and is not speaking', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'SilentFunc', type: 'function', tool_id: 't1',
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    const i211 = findIssue(issues, 'I211');
    assert.ok(i211);
    assert.strictEqual(i211.level, 'INFO');
  });

  it('fires as ERROR when speak_during_execution is true and no instruction.text', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'SpeakingFunc', type: 'function', tool_id: 't1',
      speak_during_execution: true,
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    const i211 = findIssue(issues, 'I211');
    assert.ok(i211);
    assert.strictEqual(i211.level, 'ERROR');
  });

  it('does not fire when function node has instruction.text', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'GoodFunc', type: 'function', tool_id: 't1',
      instruction: { text: 'Please wait while I process...' },
      speak_during_execution: true,
      edges: [{ id: 'e2', destination_node_id: 'n2', transition_condition: { prompt: 'If successful' } }],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'I211'));
  });
});

// ---------------------------------------------------------------------------
// P0: Component edge cross-referencing top-level nodes
// ---------------------------------------------------------------------------

describe('component cross-reference — edges to top-level nodes', () => {
  it('does not fire E310 when component edge targets a top-level node', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'ATool' }];
    flow.components = [{
      id: 'comp1', name: 'CrossRef',
      nodes: [
        {
          id: 'cn1', name: 'CompFunc', type: 'function', tool_id: 't1',
          instruction: { text: 'do it' },
          edges: [
            // Points to top-level 'n2' (End node) — should be valid
            { id: 'ce1', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
          ],
          else_edge: { id: 'ce2', destination_node_id: 'n1', transition_condition: { type: 'prompt', prompt: 'Else' } },
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compE310 = findAllIssues(issues, 'E310').filter((i) => i.where.includes('CrossRef'));
    assert.strictEqual(compE310.length, 0);
  });

  it('fires E310 when component edge targets a truly unknown node', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'ATool' }];
    flow.components = [{
      id: 'comp1', name: 'BadRef',
      nodes: [
        {
          id: 'cn1', name: 'CompFunc', type: 'function', tool_id: 't1',
          instruction: { text: 'do it' },
          edges: [
            { id: 'ce1', destination_node_id: 'ghost-node', transition_condition: { type: 'prompt', prompt: 'If successful' } },
          ],
          else_edge: { id: 'ce2', destination_node_id: 'n1', transition_condition: { type: 'prompt', prompt: 'Else' } },
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compE310 = findAllIssues(issues, 'E310').filter((i) => i.where.includes('BadRef'));
    assert.ok(compE310.length > 0);
  });

  it('component edge resolves to sibling component-internal node', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'InternalRef',
      nodes: [
        {
          id: 'cn1', name: 'Step1', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [{ id: 'ce1', destination_node_id: 'cn2', transition_condition: { type: 'prompt', prompt: 'Next' } }],
        },
        {
          id: 'cn2', name: 'Step2', type: 'conversation',
          instruction: { text: 'bye' },
          edges: [{ id: 'ce2', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Done' } }],
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compE310 = findAllIssues(issues, 'E310').filter((i) => i.where.includes('InternalRef'));
    assert.strictEqual(compE310.length, 0);
  });
});

// ---------------------------------------------------------------------------
// P0: W700 — right: null explicitly present
// ---------------------------------------------------------------------------

describe('W700 — right: null', () => {
  it('fires when binary operator has right explicitly set to null', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '==', right: null }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W700'));
    assert.ok(findIssue(issues, 'W700').msg.includes('missing right'));
  });

  it('fires when binary operator has right explicitly set to undefined', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [{ left: '{{var}}', operator: '!=', right: undefined }],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W700'));
  });
});

// ---------------------------------------------------------------------------
// P0: E110 — default_dynamic_variables as array
// ---------------------------------------------------------------------------

describe('E110 — default_dynamic_variables as array', () => {
  it('fires when default_dynamic_variables is an array', () => {
    const flow = validFlow();
    flow.default_dynamic_variables = ['foo', 'bar'];
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E110'));
  });
});

// ---------------------------------------------------------------------------
// P0: Cycle detection via always_edge
// ---------------------------------------------------------------------------

describe('I430 — cycle via always_edge', () => {
  it('detects a cycle formed through always_edge', () => {
    const flow = {
      model_choice: { type: 'llm', model: 'gpt-4o' },
      start_node_id: 'n1',
      nodes: [
        {
          id: 'n1', name: 'Start', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [{ id: 'e1', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'Next' } }],
        },
        {
          id: 'n2', name: 'Middle', type: 'conversation',
          instruction: { text: 'middle' },
          edges: [],
          always_edge: { id: 'ae-back', destination_node_id: 'n1' },
        },
        { id: 'n3', name: 'End', type: 'end' },
      ],
      tools: [],
    };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'I430'));
  });
});

// ---------------------------------------------------------------------------
// P1: always_edge destination validation
// ---------------------------------------------------------------------------

describe('always_edge — destination validation', () => {
  it('E310 fires when always_edge points to unknown node', () => {
    const flow = validFlow();
    flow.nodes[0].always_edge = { id: 'ae-bad', destination_node_id: 'ghost' };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'E310'));
  });

  it('W300 fires when always_edge has no destination', () => {
    const flow = validFlow();
    flow.nodes[0].always_edge = { id: 'ae-orphan' };
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W300'));
  });
});

// ---------------------------------------------------------------------------
// P1: Component — conversation, extract, end node checks
// ---------------------------------------------------------------------------

describe('component — other node type checks', () => {
  it('E200 fires for conversation node missing instruction.text in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'ConvComp',
      nodes: [
        { id: 'cn1', name: 'BadConv', type: 'conversation', edges: [] },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'E200').filter((i) => i.where.includes('ConvComp'));
    assert.ok(compIssues.length > 0);
  });

  it('E220 fires for extract node missing variables in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'ExtractComp',
      nodes: [
        { id: 'cn1', name: 'BadExtract', type: 'extract_dynamic_variables', edges: [] },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'E220').filter((i) => i.where.includes('ExtractComp'));
    assert.ok(compIssues.length > 0);
  });

  it('W240 fires for end node with outgoing edges in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'EndComp',
      nodes: [
        { id: 'cn1', name: 'BadEnd', type: 'end', edges: [{ id: 'ce1', destination_node_id: 'n1' }] },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'W240').filter((i) => i.where.includes('EndComp'));
    assert.ok(compIssues.length > 0);
  });

  it('W300 fires for edge with no destination in component', () => {
    const flow = validFlow();
    flow.components = [{
      id: 'comp1', name: 'OrphanComp',
      nodes: [
        {
          id: 'cn1', name: 'HasOrphan', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [{ id: 'ce-orphan' }],
        },
      ],
    }];
    const { issues } = lintFlow(flow);
    const compIssues = findAllIssues(issues, 'W300').filter((i) => i.where.includes('OrphanComp'));
    assert.ok(compIssues.length > 0);
  });
});

// ---------------------------------------------------------------------------
// P1: graphStats with always_edge
// ---------------------------------------------------------------------------

describe('graphStats — always_edge counting', () => {
  it('counts always_edge in edge totals', () => {
    const flow = {
      model_choice: { type: 'llm', model: 'gpt-4o' },
      start_node_id: 'n1',
      nodes: [
        {
          id: 'n1', name: 'Start', type: 'conversation',
          instruction: { text: 'hi' },
          edges: [],
          always_edge: { id: 'ae1', destination_node_id: 'n2' },
        },
        { id: 'n2', name: 'End', type: 'end' },
      ],
      tools: [],
    };
    const stats = graphStats(flow);
    assert.strictEqual(stats.edges, 1);
    assert.strictEqual(stats.isolated_nodes, 0);
  });
});

// ---------------------------------------------------------------------------
// P1: W231 — case-insensitive "Else" matching
// ---------------------------------------------------------------------------

describe('W231 — case insensitive matching', () => {
  it('fires for uppercase "ELSE" in edges', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'FuncUpper', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [
        { id: 'e-ok', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
        { id: 'e-else', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'ELSE' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W231'));
  });

  it('fires for lowercase "else" in edges', () => {
    const flow = validFlow();
    flow.tools = [{ tool_id: 't1', name: 'MyTool' }];
    flow.nodes.splice(1, 0, {
      id: 'fn1', name: 'FuncLower', type: 'function', tool_id: 't1',
      instruction: { text: 'do it' },
      edges: [
        { id: 'e-ok', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'If successful' } },
        { id: 'e-else', destination_node_id: 'n2', transition_condition: { type: 'prompt', prompt: 'else' } },
      ],
    });
    flow.nodes[0].edges[0].destination_node_id = 'fn1';
    const { issues } = lintFlow(flow);
    assert.ok(findIssue(issues, 'W231'));
  });
});

// ---------------------------------------------------------------------------
// P1: W700 — multiple equations in one edge
// ---------------------------------------------------------------------------

describe('W700 — multiple equations', () => {
  it('fires only for the invalid equation in a mixed array', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [
          { left: '{{good}}', operator: '==', right: 'ok' },    // valid
          { left: '', operator: '==', right: 'bad' },            // invalid: empty left
          { left: '{{also_good}}', operator: 'exists' },         // valid unary
        ],
      },
    }];
    const { issues } = lintFlow(flow);
    const w700s = findAllIssues(issues, 'W700');
    assert.strictEqual(w700s.length, 1);
    assert.ok(w700s[0].msg.includes('condition[1]'));
    assert.ok(w700s[0].msg.includes('empty left'));
  });

  it('fires multiple times when multiple equations are invalid', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [
          { left: '', operator: '==', right: 'x' },     // invalid: empty left
          { left: '{{var}}', operator: '' },              // invalid: empty operator + missing right
        ],
      },
    }];
    const { issues } = lintFlow(flow);
    const w700s = findAllIssues(issues, 'W700');
    assert.strictEqual(w700s.length, 2);
  });

  it('does not fire for empty equations array', () => {
    const flow = validFlow();
    flow.nodes[0].edges = [{
      id: 'eq1', destination_node_id: 'n2',
      transition_condition: {
        type: 'equation',
        equations: [],
      },
    }];
    const { issues } = lintFlow(flow);
    assert.ok(!findIssue(issues, 'W700'));
  });
});
