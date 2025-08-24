# Example Configurations

This directory contains sample configuration files for different Retell AI resources.

## Files

### sample-agent.json
A basic agent configuration with common settings:
- Voice configuration (11labs-Rachel)
- Backchannel settings
- Interruption sensitivity
- Response engine configuration

**Usage:**
```bash
# Deploy as new agent (no ID in file)
retell-cli agent deploy examples/sample-agent.json

# Or update existing agent
# 1. Add "agent_id": "your-agent-id" to the JSON
# 2. Deploy to update
retell-cli agent deploy examples/sample-agent.json
```

### sample-llm.json
A simple LLM configuration with:
- GPT-4o model
- Basic customer service prompt
- State machine with greeting, inquiry handling, and closing
- Dynamic variables for company information

**Usage:**
```bash
# Create new LLM
retell-cli llm deploy examples/sample-llm.json

# The response will include the llm_id
# Use this ID in your agent's response_engine.llm_id
```

### sample-conversation-flow.json
A conversation flow example featuring:
- Multiple nodes (start, help, resolve)
- Node transitions
- Tool configurations (end_call, transfer_call)
- Global prompt settings

**Usage:**
```bash
# Create new conversation flow
retell-cli flow deploy examples/sample-conversation-flow.json

# Note: Tools will be persisted after automatic update
```

## Customization Tips

1. **Voice Selection**: 
   - Change `voice_id` in agent config
   - Available voices: Check Retell documentation

2. **Model Selection**:
   - Update `model` in LLM config
   - Options: "gpt-4o", "gpt-4o-mini", "claude-3-opus", etc.

3. **Dynamic Variables**:
   - Add to `default_dynamic_variables` in LLM
   - Reference with {{variable_name}} in prompts

4. **States and Transitions**:
   - Add new states to handle complex flows
   - Define edges between states for navigation

5. **Tools**:
   - Add custom tools to conversation flows
   - Specify which nodes can use each tool

## Workflow Example

1. Create an LLM from sample:
```bash
retell-cli llm deploy examples/sample-llm.json
# Output: llm_id: "llm_abc123..."
```

2. Update agent to use new LLM:
```bash
# Edit examples/sample-agent.json
# Set response_engine.llm_id to "llm_abc123..."
retell-cli agent deploy examples/sample-agent.json
# Output: agent_id: "agent_xyz789..."
```

3. Test your agent:
- Use the agent_id in your application
- Or test via Retell dashboard

## Important Notes

- Remove or update IDs when using samples
- Customize prompts for your use case
- Test thoroughly before production use
- Keep backups of working configurations