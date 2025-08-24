# Retell CLI

A powerful command-line interface for managing [Retell AI](https://retellai.com) voice agents, LLMs, and conversation flows. Streamline your voice AI development workflow with simple commands.

![npm version](https://img.shields.io/npm/v/retell-cli)
![license](https://img.shields.io/npm/l/retell-cli)
![downloads](https://img.shields.io/npm/dm/retell-cli)

## 🚀 Features

- **Full Resource Management**: Create, read, update, and delete Agents, LLMs, and Conversation Flows
- **Smart Deploy**: Automatically creates new resources or updates existing ones based on ID presence  
- **Export/Import Workflow**: Pull configurations from Retell, modify locally, and deploy changes back
- **Batch Operations**: List and manage multiple resources efficiently
- **Built on Official SDK**: Uses the official Retell SDK for maximum reliability
- **JSON-based Configuration**: Easy to version control and collaborate

## 📦 Installation

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

## 🔧 Setup

Set your Retell API key as an environment variable:

```bash
export RETELL_API_KEY="your-api-key-here"
```

Or add it to your `.bashrc`/`.zshrc`:

```bash
echo 'export RETELL_API_KEY="your-api-key-here"' >> ~/.bashrc
```

Or create a `.env` file in your project:

```bash
RETELL_API_KEY=your-api-key-here
```

## 📖 Usage

### Command Structure

```bash
retell-cli <resource> <action> [options]
```

**Resources**: `agent`, `llm`, `flow`  
**Actions**: `pull`, `list`, `deploy`, `update`, `delete`

### Quick Examples

```bash
# List all agents
retell-cli agent list

# Pull an agent configuration
retell-cli agent pull agent_123456 -o my-agent.json

# Deploy an updated agent
retell-cli agent deploy my-agent.json

# Delete an agent
retell-cli agent delete agent_123456
```

## 📚 Command Reference

See [full documentation](https://github.com/h2ds-ai/retell-cli#command-reference) for all commands.

## 🎯 Common Workflows

### Clone and Modify an Agent

```bash
# 1. Pull existing agent
retell-cli agent pull agent_123456 -o agent.json

# 2. Edit agent.json with your changes

# 3. Deploy updated configuration
retell-cli agent deploy agent.json
```

### Backup All Resources

```bash
#!/bin/bash
mkdir -p retell-backup/$(date +%Y%m%d)
cd retell-backup/$(date +%Y%m%d)

retell-cli agent list -o agents.json
retell-cli llm list -o llms.json  
retell-cli flow list -o flows.json
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Support

- **Issues**: [GitHub Issues](https://github.com/h2ds-ai/retell-cli/issues)
- **Retell Documentation**: [docs.retellai.com](https://docs.retellai.com)

---

Made with ❤️ by the community
