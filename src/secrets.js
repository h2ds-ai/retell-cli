const fs = require('fs');
const path = require('path');

const ENV_FILE_NAME = '.env.retell';
const PLACEHOLDER_REGEX = /\{\{([A-Z0-9_]+)\}\}/g;

const NON_SENSITIVE_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'user-agent',
  'content-length',
  'host',
  'connection',
  'origin',
  'referer',
]);

/**
 * Convert an arbitrary string to a valid ENV_VAR_NAME.
 * Uppercase, replace non-alphanumeric with _, collapse runs, trim edges.
 */
function normalizeToEnvVarName(str) {
  return str
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Build a human-readable env var name from tool identity + field type + key.
 */
function buildEnvVarName(toolName, fieldType, key) {
  const parts = [toolName, fieldType, key].map(normalizeToEnvVarName);
  return parts.join('_');
}

/**
 * Return the tool's display name or a fallback.
 */
function getToolLabel(tool, index) {
  return tool.name || tool.tool_id || `tool_${index}`;
}

/**
 * Scan an object's string values and replace secrets with {{PLACEHOLDER}} tokens.
 * Mutates `obj` in place.  Returns an array of { envVar, value } entries.
 *
 * @param {Object} obj           - e.g. tool.headers
 * @param {string} toolLabel     - human label for naming
 * @param {string} fieldType     - HEADER | QUERY_PARAM
 * @param {Set}    skipKeys      - lowercase keys to skip (e.g. NON_SENSITIVE_HEADERS)
 * @param {Map}    valueToVar    - dedup map (value -> first assigned env var name)
 */
function scanObject(obj, toolLabel, fieldType, skipKeys, valueToVar) {
  if (!obj || typeof obj !== 'object') return [];

  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'string') continue;
    if (!value || PLACEHOLDER_REGEX.test(value)) {
      // Reset regex lastIndex since it's global
      PLACEHOLDER_REGEX.lastIndex = 0;
      continue;
    }
    PLACEHOLDER_REGEX.lastIndex = 0;
    if (skipKeys && skipKeys.has(key.toLowerCase())) continue;

    let envVar;
    if (valueToVar.has(value)) {
      envVar = valueToVar.get(value);
    } else {
      envVar = buildEnvVarName(toolLabel, fieldType, key);
      valueToVar.set(value, envVar);
    }

    entries.push({ envVar, value });
    obj[key] = `{{${envVar}}}`;
  }
  return entries;
}

/**
 * Extract a scalar string field from a tool/mcp, replacing it with a placeholder.
 * Returns the { envVar, value } entry or null if nothing to extract.
 */
function extractScalarField(obj, field, label, fieldType, valueToVar) {
  const value = obj[field];
  if (typeof value !== 'string' || !value) return null;
  PLACEHOLDER_REGEX.lastIndex = 0;
  if (PLACEHOLDER_REGEX.test(value)) {
    PLACEHOLDER_REGEX.lastIndex = 0;
    return null;
  }
  PLACEHOLDER_REGEX.lastIndex = 0;

  let envVar;
  if (valueToVar.has(value)) {
    envVar = valueToVar.get(value);
  } else {
    envVar = buildEnvVarName(label, fieldType, '');
    envVar = envVar.replace(/_$/, '');
    valueToVar.set(value, envVar);
  }

  obj[field] = `{{${envVar}}}`;
  return { envVar, value };
}

/**
 * Process a tools[] array — extract headers, query_params, cal_api_key, and url.
 * Mutates tools in place. Returns array of { envVar, value } entries.
 */
function processToolList(tools, valueToVar, labelPrefix) {
  if (!Array.isArray(tools)) return [];
  const entries = [];

  tools.forEach((tool, idx) => {
    const rawLabel = getToolLabel(tool, idx);
    const label = labelPrefix ? `${labelPrefix}_${rawLabel}` : rawLabel;

    entries.push(
      ...scanObject(tool.headers, label, 'HEADER', NON_SENSITIVE_HEADERS, valueToVar),
    );
    entries.push(
      ...scanObject(tool.query_params, label, 'QUERY_PARAM', null, valueToVar),
    );

    const calEntry = extractScalarField(tool, 'cal_api_key', label, 'CAL_API_KEY', valueToVar);
    if (calEntry) entries.push(calEntry);

    const urlEntry = extractScalarField(tool, 'url', label, 'URL', valueToVar);
    if (urlEntry) entries.push(urlEntry);
  });

  return entries;
}

/**
 * Process an mcps[] array — extract headers, query_params, and url.
 * Mutates mcps in place. Returns array of { envVar, value } entries.
 */
function processMcpList(mcps, valueToVar, labelPrefix) {
  if (!Array.isArray(mcps)) return [];
  const entries = [];

  mcps.forEach((mcp, idx) => {
    const rawLabel = mcp.name || mcp.mcp_id || `mcp_${idx}`;
    const label = labelPrefix ? `${labelPrefix}_${rawLabel}` : rawLabel;

    entries.push(
      ...scanObject(mcp.headers, label, 'HEADER', NON_SENSITIVE_HEADERS, valueToVar),
    );
    entries.push(
      ...scanObject(mcp.query_params, label, 'QUERY_PARAM', null, valueToVar),
    );

    const urlEntry = extractScalarField(mcp, 'url', label, 'URL', valueToVar);
    if (urlEntry) entries.push(urlEntry);
  });

  return entries;
}

/**
 * Scan a nodes[] array for MCP-type node entries with potential secrets.
 * McpNode entries within component nodes may contain headers, query_params, and url.
 * Also scans for ComponentNode entries that inline nested components.
 * Mutates nodes in place. Returns array of { envVar, value } entries.
 */
function processNodeList(nodes, valueToVar, labelPrefix) {
  if (!Array.isArray(nodes)) return [];
  const entries = [];

  nodes.forEach((node, idx) => {
    // MCP nodes may have headers/query_params/url at the node level or in mcp_config
    const nodeLabel = node.name || node.node_id || `node_${idx}`;
    const label = labelPrefix ? `${labelPrefix}_${nodeLabel}` : nodeLabel;

    // Check for mcp-shaped data directly on the node
    if (node.headers || node.query_params || node.url) {
      entries.push(
        ...scanObject(node.headers, label, 'HEADER', NON_SENSITIVE_HEADERS, valueToVar),
      );
      entries.push(
        ...scanObject(node.query_params, label, 'QUERY_PARAM', null, valueToVar),
      );
      const urlEntry = extractScalarField(node, 'url', label, 'URL', valueToVar);
      if (urlEntry) entries.push(urlEntry);
    }

    // Check for nested component data within ComponentNode entries
    if (node.components && Array.isArray(node.components)) {
      node.components.forEach((nestedComp, cIdx) => {
        const cLabel = nestedComp.name || nestedComp.component_id || `nested_component_${cIdx}`;
        const nestedLabel = label + '_' + cLabel;
        entries.push(...processToolList(nestedComp.tools, valueToVar, nestedLabel));
        entries.push(...processMcpList(nestedComp.mcps, valueToVar, nestedLabel));
        entries.push(...processNodeList(nestedComp.nodes, valueToVar, nestedLabel));
      });
    }
  });

  return entries;
}

/**
 * Extract secrets from a flow config, returning the sanitized flow and a
 * map of env var names to secret values.
 *
 * Scans: tools[].{headers, query_params, cal_api_key, url},
 *        mcps[].{headers, query_params, url},
 *        and the same within components[].
 *
 * @param {Object} flowData - raw flow config from the API
 * @returns {{ sanitizedFlow: Object, secrets: Record<string, string> }}
 */
function extractSecrets(flowData) {
  const sanitizedFlow = JSON.parse(JSON.stringify(flowData));
  const valueToVar = new Map();
  const secretEntries = [];

  // Top-level tools, mcps, and nodes
  secretEntries.push(...processToolList(sanitizedFlow.tools, valueToVar, ''));
  secretEntries.push(...processMcpList(sanitizedFlow.mcps, valueToVar, ''));
  secretEntries.push(...processNodeList(sanitizedFlow.nodes, valueToVar, ''));

  // Component-level tools, mcps, and nodes
  if (Array.isArray(sanitizedFlow.components)) {
    sanitizedFlow.components.forEach((component, cIdx) => {
      const cLabel = component.name || component.component_id || `component_${cIdx}`;
      secretEntries.push(...processToolList(component.tools, valueToVar, cLabel));
      secretEntries.push(...processMcpList(component.mcps, valueToVar, cLabel));
      secretEntries.push(...processNodeList(component.nodes, valueToVar, cLabel));
    });
  }

  const secrets = {};
  for (const { envVar, value } of secretEntries) {
    secrets[envVar] = value;
  }

  return { sanitizedFlow, secrets };
}

/**
 * Inject secrets from a .env.retell file back into a flow config,
 * resolving all {{PLACEHOLDER}} tokens.
 *
 * @param {Object} flowData    - flow config with placeholder tokens
 * @param {string} envFilePath - absolute path to .env.retell
 * @returns {Object} hydrated flow config
 */
function injectSecrets(flowData, envFilePath) {
  const hydrated = JSON.parse(JSON.stringify(flowData));

  if (!fs.existsSync(envFilePath)) {
    throw new Error(
      `Secrets file not found: ${envFilePath}\n` +
      'Run "flow pull" first to generate it, or replace {{PLACEHOLDER}} tokens with literal values.',
    );
  }

  const secrets = loadEnvFile(envFilePath);

  function resolveValue(val) {
    if (typeof val !== 'string') return val;
    return val.replace(PLACEHOLDER_REGEX, (match, varName) => {
      if (secrets[varName] !== undefined) return secrets[varName];
      return match; // leave unresolved for error reporting
    });
  }

  function resolveObject(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        obj[key] = resolveValue(obj[key]);
      }
    }
  }

  function resolveToolList(tools) {
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      resolveObject(tool.headers);
      resolveObject(tool.query_params);
      if (typeof tool.cal_api_key === 'string') {
        tool.cal_api_key = resolveValue(tool.cal_api_key);
      }
      if (typeof tool.url === 'string') {
        tool.url = resolveValue(tool.url);
      }
    }
  }

  function resolveMcpList(mcps) {
    if (!Array.isArray(mcps)) return;
    for (const mcp of mcps) {
      resolveObject(mcp.headers);
      resolveObject(mcp.query_params);
      if (typeof mcp.url === 'string') {
        mcp.url = resolveValue(mcp.url);
      }
    }
  }

  function resolveNodeList(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      resolveObject(node.headers);
      resolveObject(node.query_params);
      if (typeof node.url === 'string') {
        node.url = resolveValue(node.url);
      }
      // Resolve nested components within nodes
      if (node.components && Array.isArray(node.components)) {
        for (const nestedComp of node.components) {
          resolveToolList(nestedComp.tools);
          resolveMcpList(nestedComp.mcps);
          resolveNodeList(nestedComp.nodes);
        }
      }
    }
  }

  const unresolved = new Set();

  // Top-level tools, mcps, and nodes
  resolveToolList(hydrated.tools);
  resolveMcpList(hydrated.mcps);
  resolveNodeList(hydrated.nodes);

  // Component-level tools, mcps, and nodes
  if (Array.isArray(hydrated.components)) {
    for (const component of hydrated.components) {
      resolveToolList(component.tools);
      resolveMcpList(component.mcps);
      resolveNodeList(component.nodes);
    }
  }

  // Scan for any remaining unresolved placeholders
  const hydratedStr = JSON.stringify(hydrated);
  let match;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(hydratedStr)) !== null) {
    unresolved.add(match[1]);
  }

  if (unresolved.size > 0) {
    const keys = [...unresolved].sort().join(', ');
    throw new Error(
      `Unresolved secret placeholders: ${keys}\n` +
      `Add them to ${envFilePath} or replace the {{PLACEHOLDER}} tokens with literal values.`,
    );
  }

  return hydrated;
}

/**
 * Parse a .env file into a key-value map.
 * Supports comments (#), blank lines, and optional quoting of values.
 */
function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Save secrets to a .env file. Merges with existing file — new keys are added,
 * existing keys keep their current values.
 */
function saveEnvFile(filePath, newSecrets) {
  let existing = {};
  if (fs.existsSync(filePath)) {
    existing = loadEnvFile(filePath);
  }

  // Merge: existing values take precedence (user may have edited them)
  const merged = { ...newSecrets, ...existing };

  const lines = [
    '# Retell flow secrets — DO NOT commit this file',
    '# Generated by retell-cli flow pull',
    '',
  ];

  for (const key of Object.keys(merged).sort()) {
    const value = merged[key];
    // Quote values that contain spaces or special chars
    const needsQuoting = /[\s#"'=]/.test(value);
    lines.push(needsQuoting ? `${key}="${value}"` : `${key}=${value}`);
  }

  lines.push(''); // trailing newline
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

/**
 * Ensure .env.retell is listed in .gitignore.
 */
function ensureGitignore(projectDir) {
  const gitignorePath = path.join(projectDir, '.gitignore');
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
    // Check if already present (as its own line)
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(ENV_FILE_NAME)) return;
  }

  // Append with a blank separator if file doesn't end with newline
  const separator = content && !content.endsWith('\n') ? '\n' : '';
  const addition = `${separator}\n# Retell secrets\n${ENV_FILE_NAME}\n`;
  fs.appendFileSync(gitignorePath, addition, 'utf8');
}

module.exports = {
  ENV_FILE_NAME,
  PLACEHOLDER_REGEX,
  NON_SENSITIVE_HEADERS,
  normalizeToEnvVarName,
  extractSecrets,
  injectSecrets,
  loadEnvFile,
  saveEnvFile,
  ensureGitignore,
};
