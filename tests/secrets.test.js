const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  normalizeToEnvVarName,
  extractSecrets,
  injectSecrets,
  loadEnvFile,
  saveEnvFile,
  ensureGitignore,
  ENV_FILE_NAME,
} = require('../src/secrets');

// Helper: create a temp dir for file-system tests
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'retell-test-'));
}

// ---------------------------------------------------------------------------
// normalizeToEnvVarName
// ---------------------------------------------------------------------------
describe('normalizeToEnvVarName', () => {
  it('uppercases and replaces non-alphanumeric chars', () => {
    assert.equal(normalizeToEnvVarName('x-api-key'), 'X_API_KEY');
  });

  it('collapses consecutive underscores', () => {
    assert.equal(normalizeToEnvVarName('foo---bar'), 'FOO_BAR');
  });

  it('trims leading/trailing underscores', () => {
    assert.equal(normalizeToEnvVarName('--hello--'), 'HELLO');
  });

  it('handles already-uppercase input', () => {
    assert.equal(normalizeToEnvVarName('MY_VAR'), 'MY_VAR');
  });
});

// ---------------------------------------------------------------------------
// extractSecrets
// ---------------------------------------------------------------------------
describe('extractSecrets', () => {
  it('extracts header secrets from tools', () => {
    const flow = {
      tools: [
        {
          name: 'my_tool',
          headers: {
            'x-api-key': 'secret123',
            'content-type': 'application/json',
          },
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);

    // content-type should be left alone (non-sensitive)
    assert.equal(sanitizedFlow.tools[0].headers['content-type'], 'application/json');
    // x-api-key should be placeholdered
    assert.match(sanitizedFlow.tools[0].headers['x-api-key'], /^\{\{.+\}\}$/);
    // secrets map should contain the value
    const envVar = Object.keys(secrets)[0];
    assert.equal(secrets[envVar], 'secret123');
  });

  it('extracts query_params from tools', () => {
    const flow = {
      tools: [
        {
          name: 'search_api',
          query_params: { api_key: 'qp-secret' },
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.tools[0].query_params.api_key, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('qp-secret'));
  });

  it('extracts cal_api_key from tools', () => {
    const flow = {
      tools: [
        {
          name: 'calendar',
          cal_api_key: 'cal-key-value',
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.tools[0].cal_api_key, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('cal-key-value'));
  });

  it('extracts secrets from mcps', () => {
    const flow = {
      mcps: [
        {
          name: 'my_mcp',
          headers: { Authorization: 'Bearer tok123' },
          query_params: { token: 'mcp-token' },
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.mcps[0].headers.Authorization, /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.mcps[0].query_params.token, /^\{\{.+\}\}$/);
    assert.equal(Object.keys(secrets).length, 2);
  });

  it('deduplicates identical secret values', () => {
    const flow = {
      tools: [
        { name: 'tool_a', headers: { 'x-api-key': 'shared-secret' } },
        { name: 'tool_b', headers: { 'x-api-key': 'shared-secret' } },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    // Both should reference the same placeholder
    assert.equal(
      sanitizedFlow.tools[0].headers['x-api-key'],
      sanitizedFlow.tools[1].headers['x-api-key'],
    );
    // Only one secret entry
    assert.equal(Object.keys(secrets).length, 1);
  });

  it('skips empty values', () => {
    const flow = {
      tools: [{ name: 'tool', headers: { 'x-api-key': '' } }],
    };

    const { secrets } = extractSecrets(flow);
    assert.equal(Object.keys(secrets).length, 0);
  });

  it('skips values that are already placeholders', () => {
    const flow = {
      tools: [{ name: 'tool', headers: { 'x-api-key': '{{ALREADY_SET}}' } }],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.equal(sanitizedFlow.tools[0].headers['x-api-key'], '{{ALREADY_SET}}');
    assert.equal(Object.keys(secrets).length, 0);
  });

  it('returns empty secrets when no tools or mcps', () => {
    const { secrets } = extractSecrets({ name: 'empty flow' });
    assert.equal(Object.keys(secrets).length, 0);
  });

  it('does not mutate the original flow object', () => {
    const flow = {
      tools: [{ name: 'tool', headers: { 'x-key': 'val' } }],
    };
    const original = JSON.parse(JSON.stringify(flow));
    extractSecrets(flow);
    assert.deepEqual(flow, original);
  });

  it('falls back to tool_id when name is missing', () => {
    const flow = {
      tools: [{ tool_id: 'tid_123', headers: { 'x-key': 'val' } }],
    };

    const { secrets } = extractSecrets(flow);
    const envVar = Object.keys(secrets)[0];
    assert.ok(envVar.startsWith('TID_123'));
  });

  it('falls back to index when name and tool_id are missing', () => {
    const flow = {
      tools: [{ headers: { 'x-key': 'val' } }],
    };

    const { secrets } = extractSecrets(flow);
    const envVar = Object.keys(secrets)[0];
    assert.ok(envVar.startsWith('TOOL_0'));
  });

  it('extracts tool.url as a placeholder', () => {
    const flow = {
      tools: [
        {
          name: 'webhook',
          type: 'custom',
          url: 'https://api.example.com/webhook/retell',
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.tools[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('https://api.example.com/webhook/retell'));
  });

  it('extracts mcp.url as a placeholder', () => {
    const flow = {
      mcps: [
        {
          name: 'my_mcp',
          url: 'https://mcp.example.com/sse',
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.mcps[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('https://mcp.example.com/sse'));
  });

  it('deduplicates identical URLs across tools', () => {
    const flow = {
      tools: [
        { name: 'tool_a', type: 'custom', url: 'https://shared.example.com/api' },
        { name: 'tool_b', type: 'custom', url: 'https://shared.example.com/api' },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.equal(sanitizedFlow.tools[0].url, sanitizedFlow.tools[1].url);
    assert.equal(Object.keys(secrets).length, 1);
  });

  it('skips tool.url that is already a placeholder', () => {
    const flow = {
      tools: [{ name: 'tool', url: '{{ALREADY_URL}}' }],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.equal(sanitizedFlow.tools[0].url, '{{ALREADY_URL}}');
    assert.equal(Object.keys(secrets).length, 0);
  });
});

// ---------------------------------------------------------------------------
// extractSecrets — component tools
// ---------------------------------------------------------------------------
describe('extractSecrets — components', () => {
  it('extracts secrets from components[].tools[]', () => {
    const flow = {
      tools: [],
      components: [
        {
          name: 'my_component',
          tools: [
            {
              name: 'inner_tool',
              headers: { 'x-api-key': 'comp-secret' },
              url: 'https://comp.example.com/hook',
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.components[0].tools[0].headers['x-api-key'], /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.components[0].tools[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('comp-secret'));
    assert.ok(Object.values(secrets).includes('https://comp.example.com/hook'));
  });

  it('extracts secrets from components[].mcps[]', () => {
    const flow = {
      components: [
        {
          name: 'comp',
          mcps: [
            {
              name: 'comp_mcp',
              headers: { Authorization: 'Bearer comp-tok' },
              url: 'https://comp-mcp.example.com',
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.components[0].mcps[0].headers.Authorization, /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.components[0].mcps[0].url, /^\{\{.+\}\}$/);
    assert.equal(Object.keys(secrets).length, 2);
  });

  it('deduplicates secrets across top-level and component tools', () => {
    const flow = {
      tools: [
        { name: 'top_tool', url: 'https://shared.example.com' },
      ],
      components: [
        {
          name: 'comp',
          tools: [
            { name: 'comp_tool', url: 'https://shared.example.com' },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    // Same placeholder token
    assert.equal(sanitizedFlow.tools[0].url, sanitizedFlow.components[0].tools[0].url);
    assert.equal(Object.keys(secrets).length, 1);
  });

  it('prefixes component env var names with component label', () => {
    const flow = {
      components: [
        {
          name: 'billing',
          tools: [
            { name: 'stripe_hook', headers: { 'x-key': 'unique-val' } },
          ],
        },
      ],
    };

    const { secrets } = extractSecrets(flow);
    const envVar = Object.keys(secrets)[0];
    assert.ok(envVar.startsWith('BILLING'), `Expected env var to start with BILLING, got: ${envVar}`);
  });

  it('extracts secrets from component nodes[] with MCP-like data', () => {
    const flow = {
      components: [
        {
          name: 'support',
          nodes: [
            {
              name: 'mcp_lookup',
              headers: { Authorization: 'Bearer node-tok' },
              url: 'https://mcp-node.example.com/sse',
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.components[0].nodes[0].headers.Authorization, /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.components[0].nodes[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('Bearer node-tok'));
    assert.ok(Object.values(secrets).includes('https://mcp-node.example.com/sse'));
  });

  it('extracts secrets from nested components within nodes', () => {
    const flow = {
      components: [
        {
          name: 'outer',
          nodes: [
            {
              name: 'comp_node',
              components: [
                {
                  name: 'inner_comp',
                  tools: [
                    { name: 'nested_tool', headers: { 'x-key': 'nested-secret' } },
                  ],
                  mcps: [
                    { name: 'nested_mcp', url: 'https://nested.example.com' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(flow);
    assert.match(sanitizedFlow.components[0].nodes[0].components[0].tools[0].headers['x-key'], /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.components[0].nodes[0].components[0].mcps[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('nested-secret'));
    assert.ok(Object.values(secrets).includes('https://nested.example.com'));
  });

  it('extracts secrets from standalone component object (no top-level mcps)', () => {
    // A component object has tools[] and nodes[] but no top-level mcps or model_choice
    const component = {
      name: 'standalone',
      tools: [
        { name: 'comp_tool', headers: { 'x-api-key': 'standalone-secret' }, url: 'https://standalone.example.com' },
      ],
      nodes: [
        { name: 'mcp_node', url: 'https://mcp-standalone.example.com' },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(component);
    assert.match(sanitizedFlow.tools[0].headers['x-api-key'], /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.tools[0].url, /^\{\{.+\}\}$/);
    assert.match(sanitizedFlow.nodes[0].url, /^\{\{.+\}\}$/);
    assert.ok(Object.values(secrets).includes('standalone-secret'));
    assert.ok(Object.values(secrets).includes('https://standalone.example.com'));
    assert.ok(Object.values(secrets).includes('https://mcp-standalone.example.com'));
  });
});

// ---------------------------------------------------------------------------
// loadEnvFile / saveEnvFile
// ---------------------------------------------------------------------------
describe('loadEnvFile', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('parses key=value pairs', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'FOO=bar\nBAZ=qux\n');
    const result = loadEnvFile(file);
    assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
  });

  it('handles quoted values', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'A="hello world"\nB=\'single\'\n');
    const result = loadEnvFile(file);
    assert.equal(result.A, 'hello world');
    assert.equal(result.B, 'single');
  });

  it('skips comments and blank lines', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, '# comment\n\nKEY=val\n');
    const result = loadEnvFile(file);
    assert.deepEqual(result, { KEY: 'val' });
  });

  it('handles values containing = signs', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'TOKEN=abc=def==\n');
    const result = loadEnvFile(file);
    assert.equal(result.TOKEN, 'abc=def==');
  });
});

describe('saveEnvFile', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates a new env file with sorted keys', () => {
    const file = path.join(tmpDir, '.env');
    saveEnvFile(file, { ZEBRA: 'z', APPLE: 'a' });
    const result = loadEnvFile(file);
    assert.deepEqual(result, { APPLE: 'a', ZEBRA: 'z' });

    // Verify order in raw file
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.indexOf('APPLE') < raw.indexOf('ZEBRA'));
  });

  it('preserves existing values on merge', () => {
    const file = path.join(tmpDir, '.env');
    saveEnvFile(file, { KEY: 'original' });
    saveEnvFile(file, { KEY: 'new_value', OTHER: 'added' });

    const result = loadEnvFile(file);
    assert.equal(result.KEY, 'original'); // existing preserved
    assert.equal(result.OTHER, 'added');  // new key added
  });

  it('quotes values with spaces', () => {
    const file = path.join(tmpDir, '.env');
    saveEnvFile(file, { VAL: 'has spaces' });
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.includes('VAL="has spaces"'));
  });
});

// ---------------------------------------------------------------------------
// injectSecrets
// ---------------------------------------------------------------------------
describe('injectSecrets', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('resolves placeholders from env file', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'MY_TOOL_HEADER_X_API_KEY=secret123\n');

    const flow = {
      tools: [{ name: 'my_tool', headers: { 'x-api-key': '{{MY_TOOL_HEADER_X_API_KEY}}' } }],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.tools[0].headers['x-api-key'], 'secret123');
  });

  it('resolves cal_api_key placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'CALENDAR_CAL_API_KEY=cal-secret\n');

    const flow = {
      tools: [{ name: 'calendar', cal_api_key: '{{CALENDAR_CAL_API_KEY}}' }],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.tools[0].cal_api_key, 'cal-secret');
  });

  it('resolves mcp placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'MY_MCP_HEADER_AUTHORIZATION=Bearer abc\n');

    const flow = {
      mcps: [{ name: 'my_mcp', headers: { Authorization: '{{MY_MCP_HEADER_AUTHORIZATION}}' } }],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.mcps[0].headers.Authorization, 'Bearer abc');
  });

  it('throws when env file is missing', () => {
    const flow = {
      tools: [{ headers: { key: '{{SOME_VAR}}' } }],
    };
    assert.throws(
      () => injectSecrets(flow, path.join(tmpDir, 'nonexistent')),
      /Secrets file not found/,
    );
  });

  it('throws listing unresolved placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'ONE=1\n');

    const flow = {
      tools: [{ headers: { a: '{{ONE}}', b: '{{MISSING_A}}', c: '{{MISSING_B}}' } }],
    };

    assert.throws(
      () => injectSecrets(flow, envFile),
      /MISSING_A.*MISSING_B/,
    );
  });

  it('does not mutate the original flow', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'V=secret\n');

    const flow = { tools: [{ headers: { k: '{{V}}' } }] };
    const original = JSON.parse(JSON.stringify(flow));

    injectSecrets(flow, envFile);
    assert.deepEqual(flow, original);
  });

  it('resolves tool.url placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'WEBHOOK_URL=https://dev.example.com/hook\n');

    const flow = {
      tools: [{ name: 'webhook', url: '{{WEBHOOK_URL}}' }],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.tools[0].url, 'https://dev.example.com/hook');
  });

  it('resolves mcp.url placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'MY_MCP_URL=https://mcp.dev.example.com\n');

    const flow = {
      mcps: [{ name: 'my_mcp', url: '{{MY_MCP_URL}}' }],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.mcps[0].url, 'https://mcp.dev.example.com');
  });

  it('resolves component tool and mcp placeholders', () => {
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    fs.writeFileSync(envFile, 'COMP_URL=https://comp.dev.example.com\nCOMP_KEY=comp-secret\n');

    const flow = {
      components: [
        {
          name: 'comp',
          tools: [{ name: 'inner', url: '{{COMP_URL}}', headers: { key: '{{COMP_KEY}}' } }],
          mcps: [{ name: 'inner_mcp', url: '{{COMP_URL}}' }],
        },
      ],
    };

    const hydrated = injectSecrets(flow, envFile);
    assert.equal(hydrated.components[0].tools[0].url, 'https://comp.dev.example.com');
    assert.equal(hydrated.components[0].tools[0].headers.key, 'comp-secret');
    assert.equal(hydrated.components[0].mcps[0].url, 'https://comp.dev.example.com');
  });
});

// ---------------------------------------------------------------------------
// ensureGitignore
// ---------------------------------------------------------------------------
describe('ensureGitignore', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates .gitignore if it does not exist', () => {
    ensureGitignore(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    assert.ok(content.includes(ENV_FILE_NAME));
  });

  it('appends to existing .gitignore without duplicating', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'node_modules/\n');

    ensureGitignore(tmpDir);
    ensureGitignore(tmpDir); // call twice

    const content = fs.readFileSync(gitignorePath, 'utf8');
    const occurrences = content.split(ENV_FILE_NAME).length - 1;
    assert.equal(occurrences, 1);
  });

  it('does not add if already present', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, `node_modules/\n${ENV_FILE_NAME}\n`);

    ensureGitignore(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf8');
    const occurrences = content.split(ENV_FILE_NAME).length - 1;
    assert.equal(occurrences, 1);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: extract -> inject
// ---------------------------------------------------------------------------
describe('round-trip extract then inject', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('produces original values after extract + save + inject', () => {
    const originalFlow = {
      tools: [
        {
          name: 'api_tool',
          headers: {
            'x-api-key': 'key-abc-123',
            'content-type': 'application/json',
          },
          query_params: { token: 'tok-xyz' },
          cal_api_key: 'cal-999',
        },
      ],
      mcps: [
        {
          name: 'mcp_service',
          headers: { Authorization: 'Bearer mcp-token' },
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    saveEnvFile(envFile, secrets);

    const hydrated = injectSecrets(sanitizedFlow, envFile);

    assert.equal(hydrated.tools[0].headers['x-api-key'], 'key-abc-123');
    assert.equal(hydrated.tools[0].headers['content-type'], 'application/json');
    assert.equal(hydrated.tools[0].query_params.token, 'tok-xyz');
    assert.equal(hydrated.tools[0].cal_api_key, 'cal-999');
    assert.equal(hydrated.mcps[0].headers.Authorization, 'Bearer mcp-token');
  });

  it('round-trips tool URLs correctly', () => {
    const originalFlow = {
      tools: [
        {
          name: 'webhook',
          type: 'custom',
          url: 'https://prod.example.com/webhook/retell',
          headers: { 'x-api-key': 'wh-secret' },
        },
      ],
      mcps: [
        {
          name: 'my_mcp',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer mcp-key' },
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    saveEnvFile(envFile, secrets);

    const hydrated = injectSecrets(sanitizedFlow, envFile);

    assert.equal(hydrated.tools[0].url, 'https://prod.example.com/webhook/retell');
    assert.equal(hydrated.tools[0].headers['x-api-key'], 'wh-secret');
    assert.equal(hydrated.mcps[0].url, 'https://mcp.example.com/sse');
    assert.equal(hydrated.mcps[0].headers.Authorization, 'Bearer mcp-key');
  });

  it('round-trips component tools correctly', () => {
    const originalFlow = {
      tools: [
        { name: 'top_tool', url: 'https://top.example.com' },
      ],
      components: [
        {
          name: 'billing',
          tools: [
            {
              name: 'stripe_hook',
              url: 'https://billing.example.com/hook',
              headers: { 'x-key': 'billing-secret' },
            },
          ],
          mcps: [
            {
              name: 'billing_mcp',
              url: 'https://billing-mcp.example.com',
              query_params: { token: 'bmcp-tok' },
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    saveEnvFile(envFile, secrets);

    const hydrated = injectSecrets(sanitizedFlow, envFile);

    assert.equal(hydrated.tools[0].url, 'https://top.example.com');
    assert.equal(hydrated.components[0].tools[0].url, 'https://billing.example.com/hook');
    assert.equal(hydrated.components[0].tools[0].headers['x-key'], 'billing-secret');
    assert.equal(hydrated.components[0].mcps[0].url, 'https://billing-mcp.example.com');
    assert.equal(hydrated.components[0].mcps[0].query_params.token, 'bmcp-tok');
  });

  it('round-trips component nodes with MCP secrets', () => {
    const originalFlow = {
      components: [
        {
          name: 'support',
          tools: [
            { name: 'api', headers: { 'x-key': 'tool-key' } },
          ],
          nodes: [
            {
              name: 'mcp_node',
              headers: { Authorization: 'Bearer mcp-node-tok' },
              url: 'https://mcp-node.example.com',
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    saveEnvFile(envFile, secrets);

    const hydrated = injectSecrets(sanitizedFlow, envFile);

    assert.equal(hydrated.components[0].tools[0].headers['x-key'], 'tool-key');
    assert.equal(hydrated.components[0].nodes[0].headers.Authorization, 'Bearer mcp-node-tok');
    assert.equal(hydrated.components[0].nodes[0].url, 'https://mcp-node.example.com');
  });

  it('round-trips nested components within nodes', () => {
    const originalFlow = {
      components: [
        {
          name: 'outer',
          nodes: [
            {
              name: 'comp_node',
              components: [
                {
                  name: 'inner',
                  tools: [
                    { name: 'deep_tool', url: 'https://deep.example.com', headers: { 'x-key': 'deep-secret' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    saveEnvFile(envFile, secrets);

    const hydrated = injectSecrets(sanitizedFlow, envFile);

    assert.equal(hydrated.components[0].nodes[0].components[0].tools[0].url, 'https://deep.example.com');
    assert.equal(hydrated.components[0].nodes[0].components[0].tools[0].headers['x-key'], 'deep-secret');
  });

  it('allows URL swap by editing .env.retell between extract and inject', () => {
    const originalFlow = {
      tools: [
        { name: 'webhook', url: 'https://prod.example.com/webhook/retell' },
      ],
    };

    const { sanitizedFlow, secrets } = extractSecrets(originalFlow);

    // Simulate user editing the env file to point to dev
    const envFile = path.join(tmpDir, ENV_FILE_NAME);
    const envVarName = Object.keys(secrets)[0];
    fs.writeFileSync(envFile, `${envVarName}=https://dev.example.com/webhook/retell\n`);

    const hydrated = injectSecrets(sanitizedFlow, envFile);
    assert.equal(hydrated.tools[0].url, 'https://dev.example.com/webhook/retell');
  });
});
