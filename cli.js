#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs').promises;
const path = require('path');
const { getLlm, listLlm, deleteLlm, deployLlm, updateLlm } = require(path.join(__dirname, 'src', 'llms.js'));
const { getFlow, listFlows, deleteFlow, createOrUpdateFlow } = require(path.join(__dirname, 'src', 'flows.js'));
const { getAgent, listAgents, deleteAgent, deployAgent, updateAgent } = require(path.join(__dirname, 'src', 'agents.js'));

const program = new Command();

program
  .name('retell-cli')
  .description('A CLI tool for managing Retell AI resources.')
  .version('1.0.0');

// Helper to handle output
const handleOutput = async (data, outputPath) => {
  const json = JSON.stringify(data, null, 2);
  if (outputPath) {
    await fs.writeFile(outputPath, json, 'utf8');
    console.log(`Output successfully written to ${outputPath}`);
  } else {
    console.log(json);
  }
};

// LLM Commands
const llm = program.command('llm').description('Manage Retell LLMs');

llm
  .command('pull')
  .description('Pull a Retell LLM configuration')
  .argument('<llm-id>', 'The ID of the LLM to pull')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (llmId, options) => {
    const llm = await getLlm(llmId);
    await handleOutput(llm, options.output);
  });

llm
  .command('list')
  .description('List all Retell LLMs')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (options) => {
    const llms = await listLlm();
    await handleOutput(llms, options.output);
  });

llm
  .command('deploy')
  .description('Deploy a Retell LLM from a local file (creates new or updates existing based on ID in file)')
  .argument('<file-path>', 'The path to the LLM JSON configuration file')
  .action(deployLlm);

llm
  .command('update')
  .description('Update a specific Retell LLM')
  .argument('<llm-id>', 'The ID of the LLM to update')
  .argument('<file-path>', 'The path to the LLM JSON configuration file')
  .action(updateLlm);

llm
  .command('delete')
  .description('Delete a Retell LLM')
  .argument('<llm-id>', 'The ID of the LLM to delete')
  .action(deleteLlm);

// Flow Commands
const flow = program.command('flow').description('Manage Retell Conversation Flows');

flow
  .command('pull')
  .description('Pull a Retell Conversation Flow configuration')
  .argument('<flow-id>', 'The ID of the flow to pull')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (flowId, options) => {
    const flow = await getFlow(flowId);
    await handleOutput(flow, options.output);
  });

flow
  .command('list')
  .description('List all Retell Conversation Flows')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (options) => {
    const flows = await listFlows();
    await handleOutput(flows, options.output);
  });

flow
  .command('deploy')
  .description('Deploy a Retell Conversation Flow from a local file (creates new or updates existing based on ID in file)')
  .argument('<file-path>', 'The path to the flow JSON configuration file')
  .action(createOrUpdateFlow);

flow
  .command('delete')
  .description('Delete a Retell Conversation Flow')
  .argument('<flow-id>', 'The ID of the flow to delete')
  .action(deleteFlow);

// Agent Commands
const agent = program.command('agent').description('Manage Retell Agents');

agent
  .command('pull')
  .description('Pull a Retell Agent configuration')
  .argument('<agent-id>', 'The ID of the agent to pull')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (agentId, options) => {
    const agent = await getAgent(agentId);
    await handleOutput(agent, options.output);
  });

agent
  .command('list')
  .description('List all Retell Agents')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (options) => {
    const agents = await listAgents();
    await handleOutput(agents, options.output);
  });

agent
  .command('deploy')
  .description('Deploy a Retell Agent from a local file (creates new or updates existing based on ID in file)')
  .argument('<file-path>', 'The path to the agent JSON configuration file')
  .action(deployAgent);

agent
  .command('update')
  .description('Update a specific Retell Agent')
  .argument('<agent-id>', 'The ID of the agent to update')
  .argument('<file-path>', 'The path to the agent JSON configuration file')
  .action(updateAgent);

agent
  .command('delete')
  .description('Delete a Retell Agent')
  .argument('<agent-id>', 'The ID of the agent to delete')
  .action(deleteAgent);

program.parse(process.argv);