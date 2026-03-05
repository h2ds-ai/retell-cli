const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Rule codes & default severities
// ---------------------------------------------------------------------------

const RULE = {
  MODEL_CHOICE_INVALID:      'E100',
  DEFAULT_NOT_STRING:        'E110',
  NODE_CONV_NEEDS_TEXT:      'E200',
  NODE_FUNC_NO_TOOL:         'E210',
  NODE_FUNC_NEEDS_TEXT:      'I211',
  NODE_FUNC_MISSING_SUCCESS: 'W212',
  NODE_EXTRACT_NEEDS_VARS:   'E220',
  NODE_BRANCH_MISSING_ELSE:  'E230',
  NODE_FUNC_ELSE_PATTERN:    'W231',
  NODE_END_HAS_EDGES:        'W240',
  EDGE_NO_DEST:              'W300',
  EDGE_UNKNOWN_DEST:         'E310',
  START_NOT_FOUND:           'E400',
  NO_END_NODE:               'E410',
  NODE_UNREACHABLE:          'W420',
  CYCLE_DETECTED:            'I430',
  TOOL_UNREFERENCED:         'I500',
  TOOL_CUSTOM_NO_URL:        'W510',
  DUP_NODE_IDS:              'E600',
  EQUATION_INCOMPLETE:       'W700',
};

const DEFAULT_SEVERITY = {
  E100: 'ERROR', E110: 'ERROR', E200: 'ERROR', E210: 'ERROR',
  I211: 'INFO',  W212: 'WARN',  E220: 'ERROR', E230: 'ERROR',
  W231: 'WARN',  W240: 'WARN',  W300: 'WARN',  E310: 'ERROR',
  E400: 'ERROR', E410: 'ERROR', W420: 'WARN',  I430: 'INFO',
  I500: 'INFO',  W510: 'WARN',  W700: 'WARN',  E600: 'ERROR',
};

const SUCCESS_LABELS_DEFAULT = ['if successful', 'if_successful', 'success', 'successful'];

// ---------------------------------------------------------------------------
// ANSI colors (same as Python linter)
// ---------------------------------------------------------------------------

const C = {
  RESET: '\x1b[0m',
  RED:   '\x1b[31m',
  YEL:   '\x1b[33m',
  BLU:   '\x1b[34m',
  BOLD:  '\x1b[1m',
};

function colorize(level, text) {
  const pref = { ERROR: C.RED, WARN: C.YEL, INFO: C.BLU }[level] || '';
  return `${pref}${text}${C.RESET}`;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  severity_overrides: {},
  ignore_nodes: [],
  success_edge_labels: SUCCESS_LABELS_DEFAULT,
  treat_unconnected_edge_as: 'WARN',
  disable_reachability: false,
};

function loadConfig(configPath) {
  const cfg = { ...DEFAULT_CONFIG, severity_overrides: {} };

  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const user = JSON.parse(raw);
      if (user) Object.assign(cfg, user);
    } catch (_) {
      // silently use defaults if config can't be loaded
    }
  }

  cfg.success_edge_labels = (cfg.success_edge_labels || SUCCESS_LABELS_DEFAULT)
    .map((s) => s.trim().toLowerCase());

  return cfg;
}

function applyRulePack(cfg, pack) {
  if (!cfg.severity_overrides) cfg.severity_overrides = {};

  if (pack === 'strict-import') {
    Object.assign(cfg.severity_overrides, {
      W212: 'INFO', W420: 'INFO', W240: 'INFO', I500: 'IGNORE',
    });
  }
  // 'advisory' pack is a no-op (uses defaults)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sev(code, cfg) {
  return (cfg.severity_overrides || {})[code] || DEFAULT_SEVERITY[code] || 'WARN';
}

function addIssue(issues, level, where, msg, code) {
  if (level === 'IGNORE') return;
  issues.push({ level, where, msg, code });
}

function nodeLabel(n) {
  const name = n.name || '<unnamed>';
  const id = n.id || '<no-id>';
  const type = n.type || '<no-type>';
  return `node:${name} [${id}] (${type})`;
}

function indexTools(flow) {
  const map = {};
  for (const t of flow.tools || []) {
    if (t && typeof t === 'object' && t.tool_id) {
      map[t.tool_id] = t;
    }
  }
  return map;
}

function indexNodes(flow) {
  const map = {};
  for (const n of flow.nodes || []) {
    if (n && typeof n === 'object') {
      map[n.id] = n;
    }
  }
  return map;
}

/** Yield all outgoing edges from a node, including else_edge, skip_response_edge, and always_edge. */
function iterEdges(node) {
  const edges = [];
  if (Array.isArray(node.edges)) edges.push(...node.edges);
  if (node.else_edge) edges.push(node.else_edge);
  if (node.skip_response_edge) edges.push(node.skip_response_edge);
  if (node.always_edge) edges.push(node.always_edge);
  return edges;
}

// ---------------------------------------------------------------------------
// Check: model_choice
// ---------------------------------------------------------------------------

function checkModelChoice(flow, issues, cfg) {
  const mc = flow.model_choice;
  if (!mc || typeof mc !== 'object' || !mc.type || !mc.model) {
    addIssue(issues, sev(RULE.MODEL_CHOICE_INVALID, cfg), 'model_choice',
      "model_choice must be an object with 'type' and 'model'",
      RULE.MODEL_CHOICE_INVALID);
  }
}

// ---------------------------------------------------------------------------
// Check: default_dynamic_variables (with optional autofix)
// ---------------------------------------------------------------------------

function checkDefaults(flow, issues, cfg, autofix) {
  let fixes = 0;
  const defaults = flow.default_dynamic_variables;

  if (defaults === undefined || defaults === null) return fixes;

  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    addIssue(issues, sev(RULE.DEFAULT_NOT_STRING, cfg), 'default_dynamic_variables',
      'default_dynamic_variables must be an object', RULE.DEFAULT_NOT_STRING);
    return fixes;
  }

  for (const [k, v] of Object.entries(defaults)) {
    if (typeof v !== 'string') {
      addIssue(issues, sev(RULE.DEFAULT_NOT_STRING, cfg),
        `default_dynamic_variables.${k}`,
        'default value must be a string', RULE.DEFAULT_NOT_STRING);
      if (autofix) {
        defaults[k] = JSON.stringify(v);
        fixes++;
      }
    }
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// Equation validation constants
// ---------------------------------------------------------------------------

/** Unary operators that only need a left-hand operand (no right required). */
const UNARY_OPS = new Set(['exists', 'not_exists', 'is_empty', 'is_not_empty']);

// ---------------------------------------------------------------------------
// Check: nodes (structure, edges, type-specific rules)
// ---------------------------------------------------------------------------

function hasSuccessEdge(node, labels) {
  const prompts = (node.edges || [])
    .map((e) => ((e.transition_condition || {}).prompt || '').trim().toLowerCase())
    .filter(Boolean);
  return prompts.some((p) => labels.some((lbl) => p.includes(lbl)));
}

function checkNodes(flow, issues, cfg, autofix) {
  const tools = indexTools(flow);
  const nodes = indexNodes(flow);
  const nodeArr = flow.nodes || [];

  // Duplicate node IDs
  if (Object.keys(nodes).length !== nodeArr.length) {
    addIssue(issues, sev(RULE.DUP_NODE_IDS, cfg), 'nodes',
      'Duplicate or missing node ids detected', RULE.DUP_NODE_IDS);
  }

  // Start node exists
  const startId = flow.start_node_id;
  if (!(startId in nodes)) {
    addIssue(issues, sev(RULE.START_NOT_FOUND, cfg), 'start_node_id',
      `start_node_id '${startId}' not found among node ids`, RULE.START_NOT_FOUND);
  }

  // At least one end node
  if (!Object.values(nodes).some((n) => n.type === 'end')) {
    addIssue(issues, sev(RULE.NO_END_NODE, cfg), 'nodes',
      "No 'end' node present", RULE.NO_END_NODE);
  }

  // Per-node checks
  for (const [nid, n] of Object.entries(nodes)) {
    const where = nodeLabel(n);
    const ntype = n.type;

    if (ntype === 'conversation') {
      if (!n.instruction || !n.instruction.text) {
        addIssue(issues, sev(RULE.NODE_CONV_NEEDS_TEXT, cfg), where,
          'conversation node must have instruction.text', RULE.NODE_CONV_NEEDS_TEXT);
      }

    } else if (ntype === 'function') {
      if (!n.tool_id) {
        addIssue(issues, sev(RULE.NODE_FUNC_NO_TOOL, cfg), where,
          'function node must have tool_id', RULE.NODE_FUNC_NO_TOOL);
      } else if (!(n.tool_id in tools)) {
        addIssue(issues, sev(RULE.NODE_FUNC_NO_TOOL, cfg), where,
          `tool_id '${n.tool_id}' not found in tools list`, RULE.NODE_FUNC_NO_TOOL);
      }

      const speaks = !!n.speak_during_execution;
      if (!n.instruction || !n.instruction.text) {
        const level = speaks ? 'ERROR' : 'INFO';
        addIssue(issues, level, where,
          'function node missing instruction.text (OK if not speaking)', RULE.NODE_FUNC_NEEDS_TEXT);
      }

      if (!hasSuccessEdge(n, cfg.success_edge_labels)) {
        addIssue(issues, sev(RULE.NODE_FUNC_MISSING_SUCCESS, cfg), where,
          "function node should include a success edge (e.g., 'If successful')",
          RULE.NODE_FUNC_MISSING_SUCCESS);
      }

      // Function nodes should use else_edge, not "Else" in edges[]
      const funcElseInEdges = (n.edges || []).some((e) => {
        const prompt = ((e.transition_condition || {}).prompt || '').trim().toLowerCase();
        return prompt === 'else';
      });
      if (funcElseInEdges && !n.else_edge) {
        addIssue(issues, sev(RULE.NODE_FUNC_ELSE_PATTERN, cfg), where,
          "function node has 'Else' in edges[] — should use else_edge instead (causes double-Else in dashboard)",
          RULE.NODE_FUNC_ELSE_PATTERN);
      }

    } else if (ntype === 'extract_dynamic_variables') {
      if (!n.variables || !Array.isArray(n.variables) || n.variables.length === 0) {
        addIssue(issues, sev(RULE.NODE_EXTRACT_NEEDS_VARS, cfg), where,
          'extract_dynamic_variables must include non-empty variables array',
          RULE.NODE_EXTRACT_NEEDS_VARS);
      }

    } else if (ntype === 'branch') {
      const prompts = new Set(
        (n.edges || [])
          .map((e) => ((e.transition_condition || {}).prompt || '').trim().toLowerCase())
      );
      if (prompts.has('else') && !n.else_edge) {
        addIssue(issues, sev(RULE.NODE_BRANCH_MISSING_ELSE, cfg), where,
          "branch node uses 'Else' in edges but is missing else_edge (Retell requirement)",
          RULE.NODE_BRANCH_MISSING_ELSE);
        if (autofix) {
          n.else_edge = {
            destination_node_id: nid,
            id: `auto-${nid}-else`,
            transition_condition: { type: 'prompt', prompt: 'Else' },
          };
        }
      }

    } else if (ntype === 'end') {
      if (n.edges && n.edges.length > 0) {
        addIssue(issues, sev(RULE.NODE_END_HAS_EDGES, cfg), where,
          'end node should not have outgoing edges', RULE.NODE_END_HAS_EDGES);
      }
    }

    // Edge checks (all node types)
    for (const e of iterEdges(n)) {
      if (!e || typeof e !== 'object') continue;
      const dest = e.destination_node_id;
      if (!dest) {
        addIssue(issues, cfg.treat_unconnected_edge_as || 'WARN', where,
          'edge has no destination_node_id (editor may show as unconnected)',
          RULE.EDGE_NO_DEST);
      } else if (!(dest in nodes)) {
        addIssue(issues, sev(RULE.EDGE_UNKNOWN_DEST, cfg), where,
          `edge points to unknown destination_node_id '${dest}'`, RULE.EDGE_UNKNOWN_DEST);
      }
    }

    // Equation edge validation (all node types)
    for (const e of (n.edges || [])) {
      const tc = e.transition_condition || {};
      if (tc.type !== 'equation') continue;
      const equations = tc.equations || [];
      for (let i = 0; i < equations.length; i++) {
        const eq = equations[i];
        const left = eq.left || '';
        const op = eq.operator || '';
        const rightMissing = !('right' in eq) || eq.right === null || eq.right === undefined;
        const problems = [];
        if (!left) problems.push('empty left');
        if (!op) problems.push('empty operator');
        if (rightMissing && !UNARY_OPS.has(op)) problems.push('missing right');
        if (problems.length > 0) {
          addIssue(issues, sev(RULE.EQUATION_INCOMPLETE, cfg), where,
            `equation edge ${e.id || '?'} condition[${i}] has: ${problems.join(', ')}`,
            RULE.EQUATION_INCOMPLETE);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check: components (inner nodes within reusable components)
// ---------------------------------------------------------------------------

function checkComponents(flow, issues, cfg) {
  const components = flow.components || [];
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compName = comp.name || comp.id || '<unnamed component>';
    const compNodes = comp.nodes || [];

    // Build a node index scoped to this component + top-level nodes for cross-references
    const topNodes = indexNodes(flow);
    const compNodeMap = {};
    for (const n of compNodes) {
      if (n && typeof n === 'object') compNodeMap[n.id] = n;
    }
    // Component edges can reference both component-internal and top-level nodes
    const allReachable = { ...topNodes, ...compNodeMap };

    const compTools = indexTools(flow); // Components share top-level tools

    for (const n of compNodes) {
      if (!n || typeof n !== 'object') continue;
      const where = `component:${compName} > ${nodeLabel(n)}`;
      const ntype = n.type;

      // Function node checks
      if (ntype === 'function') {
        if (!n.tool_id) {
          addIssue(issues, sev(RULE.NODE_FUNC_NO_TOOL, cfg), where,
            'function node must have tool_id', RULE.NODE_FUNC_NO_TOOL);
        } else if (!(n.tool_id in compTools)) {
          addIssue(issues, sev(RULE.NODE_FUNC_NO_TOOL, cfg), where,
            `tool_id '${n.tool_id}' not found in tools list`, RULE.NODE_FUNC_NO_TOOL);
        }

        if (!hasSuccessEdge(n, cfg.success_edge_labels)) {
          addIssue(issues, sev(RULE.NODE_FUNC_MISSING_SUCCESS, cfg), where,
            "function node should include a success edge (e.g., 'If successful')",
            RULE.NODE_FUNC_MISSING_SUCCESS);
        }

        // Function nodes should use else_edge
        const funcElseInEdges = (n.edges || []).some((e) => {
          const prompt = ((e.transition_condition || {}).prompt || '').trim().toLowerCase();
          return prompt === 'else';
        });
        if (funcElseInEdges && !n.else_edge) {
          addIssue(issues, sev(RULE.NODE_FUNC_ELSE_PATTERN, cfg), where,
            "function node has 'Else' in edges[] — should use else_edge instead (causes double-Else in dashboard)",
            RULE.NODE_FUNC_ELSE_PATTERN);
        }

      } else if (ntype === 'conversation') {
        if (!n.instruction || !n.instruction.text) {
          addIssue(issues, sev(RULE.NODE_CONV_NEEDS_TEXT, cfg), where,
            'conversation node must have instruction.text', RULE.NODE_CONV_NEEDS_TEXT);
        }

      } else if (ntype === 'branch') {
        const prompts = new Set(
          (n.edges || [])
            .map((e) => ((e.transition_condition || {}).prompt || '').trim().toLowerCase())
        );
        if (prompts.has('else') && !n.else_edge) {
          addIssue(issues, sev(RULE.NODE_BRANCH_MISSING_ELSE, cfg), where,
            "branch node uses 'Else' in edges but is missing else_edge (Retell requirement)",
            RULE.NODE_BRANCH_MISSING_ELSE);
        }

      } else if (ntype === 'extract_dynamic_variables') {
        if (!n.variables || !Array.isArray(n.variables) || n.variables.length === 0) {
          addIssue(issues, sev(RULE.NODE_EXTRACT_NEEDS_VARS, cfg), where,
            'extract_dynamic_variables must include non-empty variables array',
            RULE.NODE_EXTRACT_NEEDS_VARS);
        }

      } else if (ntype === 'end') {
        if (n.edges && n.edges.length > 0) {
          addIssue(issues, sev(RULE.NODE_END_HAS_EDGES, cfg), where,
            'end node should not have outgoing edges', RULE.NODE_END_HAS_EDGES);
        }
      }

      // Edge destination checks within component
      for (const e of iterEdges(n)) {
        if (!e || typeof e !== 'object') continue;
        const dest = e.destination_node_id;
        if (!dest) {
          addIssue(issues, cfg.treat_unconnected_edge_as || 'WARN', where,
            'edge has no destination_node_id (editor may show as unconnected)',
            RULE.EDGE_NO_DEST);
        } else if (!(dest in allReachable)) {
          addIssue(issues, sev(RULE.EDGE_UNKNOWN_DEST, cfg), where,
            `edge points to unknown destination_node_id '${dest}'`, RULE.EDGE_UNKNOWN_DEST);
        }
      }

      // Equation edge validation within component
      for (const e of (n.edges || [])) {
        const tc = e.transition_condition || {};
        if (tc.type !== 'equation') continue;
        const equations = tc.equations || [];
        for (let i = 0; i < equations.length; i++) {
          const eq = equations[i];
          const left = eq.left || '';
          const op = eq.operator || '';
          const rightMissing = !('right' in eq) || eq.right === null || eq.right === undefined;
          const problems = [];
          if (!left) problems.push('empty left');
          if (!op) problems.push('empty operator');
          if (rightMissing && !UNARY_OPS.has(op)) problems.push('missing right');
          if (problems.length > 0) {
            addIssue(issues, sev(RULE.EQUATION_INCOMPLETE, cfg), where,
              `equation edge ${e.id || '?'} condition[${i}] has: ${problems.join(', ')}`,
              RULE.EQUATION_INCOMPLETE);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check: tools (unreferenced, custom tool validation)
// ---------------------------------------------------------------------------

function checkTools(flow, issues, cfg) {
  const tools = flow.tools || [];
  const nodes = flow.nodes || [];

  // Collect all tool_ids referenced by function nodes
  const referencedToolIds = new Set();
  for (const n of nodes) {
    if (n.tool_id) referencedToolIds.add(n.tool_id);
  }

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const toolId = tool.tool_id || tool.id;
    const label = tool.name || toolId || '<unnamed tool>';

    // Unreferenced tool
    if (toolId && !referencedToolIds.has(toolId)) {
      addIssue(issues, sev(RULE.TOOL_UNREFERENCED, cfg), `tool:${label}`,
        `tool '${label}' is not referenced by any function node`, RULE.TOOL_UNREFERENCED);
    }

    // Custom tool without URL
    if (tool.type === 'custom' && !tool.url) {
      addIssue(issues, sev(RULE.TOOL_CUSTOM_NO_URL, cfg), `tool:${label}`,
        `custom tool '${label}' is missing a url`, RULE.TOOL_CUSTOM_NO_URL);
    }
  }
}

// ---------------------------------------------------------------------------
// Reachability (BFS from start_node_id)
// ---------------------------------------------------------------------------

function checkReachability(flow, issues, cfg) {
  const nodes = indexNodes(flow);
  const startId = flow.start_node_id;

  if (cfg.disable_reachability || !(startId in nodes)) return;

  // Global nodes are always reachable by definition
  const globalOk = new Set();
  for (const [nid, n] of Object.entries(nodes)) {
    if (n.global_node_setting) globalOk.add(nid);
  }

  const seen = new Set();
  const queue = [startId];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (!(cur in nodes)) continue;

    for (const e of iterEdges(nodes[cur])) {
      const dest = e.destination_node_id;
      if (dest && dest in nodes && !seen.has(dest)) {
        queue.push(dest);
      }
    }
  }

  for (const [nid, n] of Object.entries(nodes)) {
    if (seen.has(nid) || globalOk.has(nid)) continue;
    addIssue(issues, sev(RULE.NODE_UNREACHABLE, cfg), nodeLabel(n),
      'node is not reachable from start_node_id', RULE.NODE_UNREACHABLE);
  }
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS)
// ---------------------------------------------------------------------------

function detectCycles(flow, issues, cfg) {
  const nodes = indexNodes(flow);
  const startId = flow.start_node_id;
  if (!startId || !(startId in nodes)) return 0;

  const visited = new Set();
  const inStack = new Set();
  let cycleCount = 0;

  function dfs(nodeId) {
    visited.add(nodeId);
    inStack.add(nodeId);
    const node = nodes[nodeId];
    if (!node) { inStack.delete(nodeId); return; }

    for (const e of iterEdges(node)) {
      const dest = e.destination_node_id;
      if (!dest || !(dest in nodes)) continue;
      if (!visited.has(dest)) {
        dfs(dest);
      } else if (inStack.has(dest)) {
        cycleCount++;
      }
    }
    inStack.delete(nodeId);
  }

  dfs(startId);

  if (cycleCount > 0) {
    addIssue(issues, sev(RULE.CYCLE_DETECTED, cfg), 'graph',
      `Detected ${cycleCount} cycle back-edge(s) (verify they terminate properly)`,
      RULE.CYCLE_DETECTED);
  }

  return cycleCount;
}

// ---------------------------------------------------------------------------
// Graph statistics
// ---------------------------------------------------------------------------

function graphStats(flow) {
  const nodes = indexNodes(flow);
  const nids = Object.keys(nodes);
  const total = nids.length;

  const degIn = {};
  const degOut = {};
  for (const nid of nids) { degIn[nid] = 0; degOut[nid] = 0; }

  for (const [nid, n] of Object.entries(nodes)) {
    for (const e of iterEdges(n)) {
      const dest = e.destination_node_id;
      if (dest in nodes) {
        degOut[nid]++;
        degIn[dest]++;
      }
    }
  }

  const totalEdges = Object.values(degOut).reduce((a, b) => a + b, 0);
  const isolated = nids.filter((nid) => degIn[nid] === 0 && degOut[nid] === 0);

  return {
    nodes: total,
    edges: totalEdges,
    avg_out_degree: total ? totalEdges / total : 0,
    avg_in_degree: total ? totalEdges / total : 0,
    isolated_nodes: isolated.length,
  };
}

// ---------------------------------------------------------------------------
// Main lint function
// ---------------------------------------------------------------------------

/**
 * Lint a Retell conversation flow config.
 *
 * @param {Object} flowData - parsed flow JSON
 * @param {Object} options
 * @param {string} options.configPath - path to lint config JSON
 * @param {string} options.rulePack  - 'strict-import' | 'advisory'
 * @param {boolean} options.autofix  - apply safe auto-fixes
 * @param {boolean} options.stats    - include graph stats in result
 * @returns {{ issues: Object[], stats?: Object, flow: Object }}
 */
function lintFlow(flowData, { configPath, rulePack, autofix = false, stats = false } = {}) {
  const cfg = loadConfig(configPath);
  if (rulePack) applyRulePack(cfg, rulePack);

  // Work on a deep copy so autofix doesn't mutate the caller's data
  const flow = JSON.parse(JSON.stringify(flowData));
  const issues = [];

  checkModelChoice(flow, issues, cfg);
  checkDefaults(flow, issues, cfg, autofix);
  checkNodes(flow, issues, cfg, autofix);
  checkComponents(flow, issues, cfg);
  checkTools(flow, issues, cfg);
  checkReachability(flow, issues, cfg);
  detectCycles(flow, issues, cfg);

  // Sort: ERROR first, then WARN, then INFO; within same level by location then code
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort((a, b) =>
    (order[a.level] ?? 99) - (order[b.level] ?? 99)
    || a.where.localeCompare(b.where)
    || a.code.localeCompare(b.code)
  );

  const result = { issues, flow };
  if (stats) result.stats = graphStats(flow);

  return result;
}

// ---------------------------------------------------------------------------
// CLI report formatter
// ---------------------------------------------------------------------------

function formatReport(issues, filePath, stats) {
  const lines = [];
  lines.push(`${C.BOLD}Retell Flow Lint Report${C.RESET} for ${filePath}`);
  lines.push('='.repeat(60));

  for (const i of issues) {
    lines.push(colorize(i.level, `[${i.level}] ${i.code} ${i.where}: ${i.msg}`));
  }

  lines.push('='.repeat(60));

  const ec = issues.filter((i) => i.level === 'ERROR').length;
  const wc = issues.filter((i) => i.level === 'WARN').length;
  const ic = issues.filter((i) => i.level === 'INFO').length;

  const overall = ec ? 'ERROR' : (wc ? 'WARN' : 'INFO');
  lines.push(colorize(overall, `Summary: ${ec} errors, ${wc} warnings, ${ic} info`));

  if (stats) {
    lines.push(
      `Graph stats: nodes=${stats.nodes} edges=${stats.edges}` +
      ` avg_out=${stats.avg_out_degree.toFixed(2)}` +
      ` avg_in=${stats.avg_in_degree.toFixed(2)}` +
      ` isolated=${stats.isolated_nodes}`
    );
  }

  return lines.join('\n');
}

module.exports = {
  RULE,
  DEFAULT_SEVERITY,
  SUCCESS_LABELS_DEFAULT,
  UNARY_OPS,
  loadConfig,
  applyRulePack,
  lintFlow,
  graphStats,
  formatReport,
  // Expose internals for testing
  indexNodes,
  indexTools,
  iterEdges,
  hasSuccessEdge,
  detectCycles,
  checkReachability,
};
