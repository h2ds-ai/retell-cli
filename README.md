# Retell CLI

A powerful command-line interface for managing [Retell AI](https://retellai.com) voice agents, chat agents, LLMs, conversation flows, and flow components. Streamline your voice and chat AI development workflow with simple commands.

![npm version](https://img.shields.io/npm/v/retell-cli)
![license](https://img.shields.io/npm/l/retell-cli)
![downloads](https://img.shields.io/npm/dm/retell-cli)

## Features

- **Full Resource Management**: Create, read, update, and delete Agents, Chat Agents, LLMs, Conversation Flows, and Flow Components
- **Version Management**: Publish agent drafts as versions and list version history for voice and chat agents
- **Secrets Management**: Automatically extracts API keys and sensitive values from flow configs into `.env.retell`, replacing them with `{{PLACEHOLDER}}` tokens safe for version control
- **Flow Linting**: Validate conversation flow JSON files against 18 rules covering structure, graph integrity, reachability, and best practices
- **Test Case Management**: Create, list, update, and delete test case definitions for conversation flows
- **Batch Testing**: Run batch tests against flows with optional polling for completion
- **Smart Deploy**: Automatically creates new resources or updates existing ones based on ID presence
- **Export/Import Workflow**: Pull configurations from Retell, modify locally, and deploy changes back
- **Built on Official SDK**: Uses the official Retell SDK for maximum reliability
- **JSON-based Configuration**: Easy to version control and collaborate

## Installation

### Global Installation (Recommended)

```bash
npm install -g @h2ds-ai/retell-cli
```

### Local Installation

```bash
npm install @h2ds-ai/retell-cli
```

### From Source

```bash
git clone https://github.com/h2ds-ai/retell-cli.git
cd retell-cli
npm install
npm link
```

## Setup

Set your Retell API key as an environment variable:

```bash
export RETELL_API_KEY="your-api-key-here"
```

Or add it to your `.bashrc`/`.zshrc`:

```bash
echo 'export RETELL_API_KEY="your-api-key-here"' >> ~/.bashrc
```

## Usage

### Command Structure

```bash
retell-cli <resource> <action> [options]
```

**Resources**: `agent`, `chat-agent`, `llm`, `flow`, `component`, `test`

### Quick Examples

```bash
# List all voice agents
retell-cli agent list

# Pull and deploy a voice agent
retell-cli agent pull agent_123456 -o my-agent.json
retell-cli agent deploy my-agent.json

# Publish an agent draft and view version history
retell-cli agent publish agent_123456
retell-cli agent versions agent_123456

# Manage chat/SMS agents
retell-cli chat-agent list
retell-cli chat-agent pull agent_abc -o chat-agent.json
retell-cli chat-agent deploy chat-agent.json
retell-cli chat-agent publish agent_abc

# Pull a flow with secrets extracted to .env.retell
retell-cli flow pull flow_abc -o my-flow.json

# Work with reusable flow components
retell-cli component list
retell-cli component pull comp_xyz -o my-component.json

# Lint a flow configuration
retell-cli flow lint my-flow.json --stats

# Run batch tests for a flow
retell-cli test run flow_abc --poll
```

## Command Reference

### Agent Commands

| Command | Description |
|---------|-------------|
| `agent list [-o file]` | List all agents |
| `agent pull <id> [-o file]` | Pull an agent configuration |
| `agent deploy <file>` | Create or update an agent from a JSON file |
| `agent update <id> <file>` | Update a specific agent |
| `agent delete <id>` | Delete an agent |
| `agent publish <id>` | Publish the current draft as a new version |
| `agent versions <id> [-o file]` | List published versions of an agent |

### Chat Agent Commands

| Command | Description |
|---------|-------------|
| `chat-agent list [-o file]` | List all chat agents |
| `chat-agent pull <id> [-o file]` | Pull a chat agent configuration |
| `chat-agent deploy <file>` | Create or update a chat agent from a JSON file |
| `chat-agent update <id> <file>` | Update a specific chat agent |
| `chat-agent delete <id>` | Delete a chat agent |
| `chat-agent publish <id>` | Publish the current draft as a new version |
| `chat-agent versions <id> [-o file]` | List published versions of a chat agent |

### LLM Commands

| Command | Description |
|---------|-------------|
| `llm list [-o file]` | List all LLMs |
| `llm pull <id> [-o file]` | Pull an LLM configuration |
| `llm deploy <file>` | Create or update an LLM from a JSON file |
| `llm update <id> <file>` | Update a specific LLM |
| `llm delete <id>` | Delete an LLM |

### Flow Commands

| Command | Description |
|---------|-------------|
| `flow list [-o file]` | List all conversation flows |
| `flow pull <id> [-o file] [--no-secrets]` | Pull a flow configuration (extracts secrets by default) |
| `flow deploy <file>` | Create or update a flow from a JSON file (injects secrets from `.env.retell` if placeholders found) |
| `flow delete <id>` | Delete a conversation flow |
| `flow lint <file> [options]` | Lint a flow JSON file for errors and warnings |

#### Flow Lint Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to a lint config JSON for severity overrides |
| `--rule-pack <pack>` | Preset severity pack: `strict-import`, `advisory` |
| `--autofix` | Apply safe auto-fixes (string defaults, stub else_edge) |
| `--out <path>` | Write the fixed flow JSON to this path |
| `--stats` | Print graph statistics (nodes, edges, degree, isolated count) |
| `--json` | Output issues as JSON instead of formatted report |

### Component Commands

| Command | Description |
|---------|-------------|
| `component list [-o file]` | List all conversation flow components |
| `component pull <id> [-o file] [--no-secrets]` | Pull a component configuration (extracts secrets by default) |
| `component deploy <file>` | Create or update a component from a JSON file (injects secrets from `.env.retell` if placeholders found) |
| `component update <id> <file>` | Update a specific component (injects secrets from `.env.retell` if placeholders found) |
| `component delete <id>` | Delete a conversation flow component |

### Test Commands

| Command | Description |
|---------|-------------|
| `test list <flow-id> [-o file]` | List test cases for a conversation flow |
| `test pull <test-id> [-o file]` | Pull a single test case definition |
| `test create <file> [-o file]` | Create a test case from a JSON file |
| `test update <test-id> <file> [-o file]` | Update an existing test case |
| `test delete <test-id>` | Delete a test case |
| `test run <flow-id> [options]` | Run a batch test for a conversation flow |
| `test status <batch-id> [-o file]` | Check the status of a batch test |

#### Test Run Options

| Option | Description |
|--------|-------------|
| `--test-ids <file>` | JSON file containing array of test case IDs to run |
| `--poll` | Wait for batch test to complete |
| `--interval <ms>` | Poll interval in milliseconds (default: 5000) |
| `--timeout <ms>` | Maximum wait time in milliseconds (default: 600000) |
| `-o, --output <file>` | Path to save the batch test result |

## Secrets Management

When you pull a conversation flow or component, the CLI automatically:

1. Extracts sensitive values (API keys, auth headers, query params, tool URLs) from the flow config
2. Saves them to a `.env.retell` file in the same directory as the output
3. Replaces the values in the JSON with `{{PLACEHOLDER}}` tokens
4. Adds `.env.retell` to `.gitignore`

This means you can safely commit your flow JSON to version control.

```bash
# Pull with secrets extracted (default)
retell-cli flow pull flow_abc -o flows/my-flow.json
# Creates: flows/my-flow.json (safe to commit)
# Creates: flows/.env.retell (DO NOT commit)

# Pull raw flow without extracting secrets
retell-cli flow pull flow_abc -o my-flow.json --no-secrets

# Deploy automatically injects secrets from .env.retell
retell-cli flow deploy flows/my-flow.json
```

The `.env.retell` file uses standard dotenv format:

```bash
# Retell flow secrets — DO NOT commit this file
MYTOOL_HEADER_X_API_KEY=sk-abc123
MYTOOL_URL=https://api.example.com/v1/endpoint
```

## Flow Linting

The linter validates conversation flow JSON files against 18 rules:

| Code | Severity | Description |
|------|----------|-------------|
| E100 | ERROR | `model_choice` must have `type` and `model` |
| E110 | ERROR | `default_dynamic_variables` values must be strings |
| E200 | ERROR | Conversation nodes must have `instruction.text` |
| E210 | ERROR | Function nodes must have a valid `tool_id` |
| I211 | INFO | Function node missing `instruction.text` |
| W212 | WARN | Function node should have a success edge |
| E220 | ERROR | Extract nodes must have a non-empty `variables` array |
| E230 | ERROR | Branch node using 'Else' edge but missing `else_edge` |
| W240 | WARN | End node should not have outgoing edges |
| W300 | WARN | Edge has no `destination_node_id` |
| E310 | ERROR | Edge points to unknown destination node |
| E400 | ERROR | `start_node_id` not found in nodes |
| E410 | ERROR | No end node present |
| W420 | WARN | Node is unreachable from start |
| I430 | INFO | Graph cycles detected |
| I500 | INFO | Tool not referenced by any function node |
| W510 | WARN | Custom tool missing URL |
| E600 | ERROR | Duplicate node IDs |

Exits with code 1 if any errors are found, making it suitable for CI pipelines.

```bash
# Basic lint
retell-cli flow lint my-flow.json

# With graph stats
retell-cli flow lint my-flow.json --stats

# Auto-fix safe issues and write corrected file
retell-cli flow lint my-flow.json --autofix --out fixed-flow.json

# JSON output for CI/tooling
retell-cli flow lint my-flow.json --json

# Custom severity overrides
retell-cli flow lint my-flow.json --config lint-config.json
```

Lint config example (`lint-config.json`):

```json
{
  "severity_overrides": {
    "W420": "IGNORE",
    "I500": "WARN"
  },
  "disable_reachability": false,
  "success_edge_labels": ["if successful", "success"]
}
```

## Common Workflows

### Clone and Modify an Agent

```bash
# 1. Pull existing agent
retell-cli agent pull agent_123456 -o agent.json

# 2. Edit agent.json with your changes

# 3. Deploy updated configuration
retell-cli agent deploy agent.json
```

### Flow Development Cycle

```bash
# 1. Pull flow (secrets auto-extracted)
retell-cli flow pull flow_abc -o my-flow.json

# 2. Lint before making changes
retell-cli flow lint my-flow.json

# 3. Edit the flow JSON locally

# 4. Lint again to catch issues
retell-cli flow lint my-flow.json --stats

# 5. Deploy (secrets auto-injected from .env.retell)
retell-cli flow deploy my-flow.json
```

### Run Tests Against a Flow

```bash
# List existing test cases
retell-cli test list flow_abc

# Run all tests with polling
retell-cli test run flow_abc --poll -o results.json

# Run specific tests
echo '["test_id_1", "test_id_2"]' > test-ids.json
retell-cli test run flow_abc --test-ids test-ids.json --poll
```

### Chat Agent Workflow

```bash
# 1. Pull an existing chat agent
retell-cli chat-agent pull agent_abc -o chat-agent.json

# 2. Edit the configuration locally

# 3. Deploy changes
retell-cli chat-agent deploy chat-agent.json

# 4. Publish as a new version
retell-cli chat-agent publish agent_abc

# 5. View version history
retell-cli chat-agent versions agent_abc
```

### Component Workflow

```bash
# 1. List available components
retell-cli component list

# 2. Pull a component (secrets auto-extracted)
retell-cli component pull comp_xyz -o my-component.json

# 3. Edit and redeploy (secrets auto-injected)
retell-cli component deploy my-component.json
```

### Backup All Resources

```bash
#!/bin/bash
mkdir -p retell-backup/$(date +%Y%m%d)
cd retell-backup/$(date +%Y%m%d)

retell-cli agent list -o agents.json
retell-cli chat-agent list -o chat-agents.json
retell-cli llm list -o llms.json
retell-cli flow list -o flows.json
retell-cli component list -o components.json
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/h2ds-ai/retell-cli/issues)
- **Retell Documentation**: [docs.retellai.com](https://docs.retellai.com)

---

Made with care by [H2 Digital Solutions](https://github.com/h2ds-ai)
