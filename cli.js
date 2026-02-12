#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs').promises;
const path = require('path');
const { getLlm, listLlm, deleteLlm, deployLlm, updateLlm } = require(path.join(__dirname, 'src', 'llms.js'));
const { getFlow, listFlows, deleteFlow, createOrUpdateFlow, pullFlowWithSecrets } = require(path.join(__dirname, 'src', 'flows.js'));
const { getAgent, listAgents, deleteAgent, deployAgent, updateAgent, publishAgent, getAgentVersions } = require(path.join(__dirname, 'src', 'agents.js'));
const {
  getChatAgent, listChatAgents, deleteChatAgent, deployChatAgent, updateChatAgent,
  publishChatAgent, getChatAgentVersions,
} = require(path.join(__dirname, 'src', 'chat-agents.js'));
const {
  getComponent, listComponents, deleteComponent, deployComponent, updateComponent,
  pullComponentWithSecrets,
} = require(path.join(__dirname, 'src', 'flow-components.js'));
const {
  listTestCases, getTestCase, createTestCase, updateTestCase, deleteTestCase,
  runBatchTest, getBatchTestStatus,
} = require(path.join(__dirname, 'src', 'tests.js'));
const { lintFlow, formatReport } = require(path.join(__dirname, 'src', 'linter.js'));

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
  .option('--no-secrets', 'Pull raw flow without extracting secrets')
  .action(async (flowId, options) => {
    if (options.secrets === false) {
      const flow = await getFlow(flowId);
      await handleOutput(flow, options.output);
    } else {
      const flow = await pullFlowWithSecrets(flowId, options.output);
      await handleOutput(flow, options.output);
    }
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

flow
  .command('lint')
  .description('Lint a Retell Conversation Flow JSON file for errors and warnings')
  .argument('<file-path>', 'Path to the flow JSON file to lint')
  .option('--config <config-path>', 'Path to a lint config JSON file for severity overrides')
  .option('--rule-pack <pack>', 'Preset severity pack: strict-import, advisory')
  .option('--autofix', 'Apply safe auto-fixes (string defaults, stub else_edge)')
  .option('--out <output-path>', 'Write the (fixed) flow JSON to this path')
  .option('--stats', 'Print graph statistics')
  .option('--json', 'Output issues as JSON instead of formatted report')
  .action(async (filePath, options) => {
    const flowStr = await fs.readFile(filePath, 'utf8');
    const flowData = JSON.parse(flowStr);

    const result = lintFlow(flowData, {
      configPath: options.config,
      rulePack: options.rulePack,
      autofix: !!options.autofix,
      stats: !!options.stats,
    });

    if (options.json) {
      const output = { issues: result.issues };
      if (result.stats) output.stats = result.stats;
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatReport(result.issues, filePath, result.stats));
    }

    if (options.autofix && options.out) {
      await fs.writeFile(options.out, JSON.stringify(result.flow, null, 2), 'utf8');
      console.log(`Fixed flow written to ${options.out}`);
    }

    // Exit with non-zero if any errors
    const errorCount = result.issues.filter((i) => i.level === 'ERROR').length;
    if (errorCount > 0) process.exit(1);
  });

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

agent
  .command('publish')
  .description('Publish the current draft of a Retell Agent as a new version')
  .argument('<agent-id>', 'The ID of the agent to publish')
  .action(async (agentId) => {
    const result = await publishAgent(agentId);
    console.log(JSON.stringify(result, null, 2));
  });

agent
  .command('versions')
  .description('List published versions of a Retell Agent')
  .argument('<agent-id>', 'The ID of the agent')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (agentId, options) => {
    const versions = await getAgentVersions(agentId);
    await handleOutput(versions, options.output);
  });

// Chat Agent Commands
const chatAgent = program.command('chat-agent').description('Manage Retell Chat Agents');

chatAgent
  .command('pull')
  .description('Pull a Retell Chat Agent configuration')
  .argument('<agent-id>', 'The ID of the chat agent to pull')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (agentId, options) => {
    const agent = await getChatAgent(agentId);
    await handleOutput(agent, options.output);
  });

chatAgent
  .command('list')
  .description('List all Retell Chat Agents')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (options) => {
    const agents = await listChatAgents();
    await handleOutput(agents, options.output);
  });

chatAgent
  .command('deploy')
  .description('Deploy a Retell Chat Agent from a local file (creates new or updates existing based on ID in file)')
  .argument('<file-path>', 'The path to the chat agent JSON configuration file')
  .action(deployChatAgent);

chatAgent
  .command('update')
  .description('Update a specific Retell Chat Agent')
  .argument('<agent-id>', 'The ID of the chat agent to update')
  .argument('<file-path>', 'The path to the chat agent JSON configuration file')
  .action(updateChatAgent);

chatAgent
  .command('delete')
  .description('Delete a Retell Chat Agent')
  .argument('<agent-id>', 'The ID of the chat agent to delete')
  .action(deleteChatAgent);

chatAgent
  .command('publish')
  .description('Publish the current draft of a Retell Chat Agent as a new version')
  .argument('<agent-id>', 'The ID of the chat agent to publish')
  .action(async (agentId) => {
    const result = await publishChatAgent(agentId);
    console.log(JSON.stringify(result, null, 2));
  });

chatAgent
  .command('versions')
  .description('List published versions of a Retell Chat Agent')
  .argument('<agent-id>', 'The ID of the chat agent')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (agentId, options) => {
    const versions = await getChatAgentVersions(agentId);
    await handleOutput(versions, options.output);
  });

// Component Commands
const component = program.command('component').description('Manage Retell Conversation Flow Components');

component
  .command('pull')
  .description('Pull a Retell Conversation Flow Component configuration')
  .argument('<component-id>', 'The ID of the component to pull')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .option('--no-secrets', 'Pull raw component without extracting secrets')
  .action(async (componentId, options) => {
    if (options.secrets === false) {
      const comp = await getComponent(componentId);
      await handleOutput(comp, options.output);
    } else {
      const comp = await pullComponentWithSecrets(componentId, options.output);
      await handleOutput(comp, options.output);
    }
  });

component
  .command('list')
  .description('List all Retell Conversation Flow Components')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (options) => {
    const components = await listComponents();
    await handleOutput(components, options.output);
  });

component
  .command('deploy')
  .description('Deploy a Retell Conversation Flow Component from a local file (creates new or updates existing based on ID in file)')
  .argument('<file-path>', 'The path to the component JSON configuration file')
  .action(deployComponent);

component
  .command('update')
  .description('Update a specific Retell Conversation Flow Component')
  .argument('<component-id>', 'The ID of the component to update')
  .argument('<file-path>', 'The path to the component JSON configuration file')
  .action(updateComponent);

component
  .command('delete')
  .description('Delete a Retell Conversation Flow Component')
  .argument('<component-id>', 'The ID of the component to delete')
  .action(deleteComponent);

// Test Commands
const test = program.command('test').description('Manage Retell Test Cases and Batch Tests');

test
  .command('list')
  .description('List test cases for a conversation flow')
  .argument('<flow-id>', 'The conversation flow ID')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (flowId, options) => {
    const cases = await listTestCases(flowId);
    await handleOutput(cases, options.output);
  });

test
  .command('pull')
  .description('Pull a single test case definition')
  .argument('<test-id>', 'The test case ID')
  .option('-o, --output <file-path>', 'Path to save the output JSON file')
  .action(async (testId, options) => {
    const tc = await getTestCase(testId);
    await handleOutput(tc, options.output);
  });

test
  .command('create')
  .description('Create a test case from a JSON file')
  .argument('<file-path>', 'Path to the test case JSON file')
  .option('-o, --output <file-path>', 'Path to save the created test case')
  .action(async (filePath, options) => {
    const result = await createTestCase(filePath);
    await handleOutput(result, options.output);
  });

test
  .command('update')
  .description('Update an existing test case')
  .argument('<test-id>', 'The test case ID to update')
  .argument('<file-path>', 'Path to the test case JSON file')
  .option('-o, --output <file-path>', 'Path to save the updated test case')
  .action(async (testId, filePath, options) => {
    const result = await updateTestCase(testId, filePath);
    await handleOutput(result, options.output);
  });

test
  .command('delete')
  .description('Delete a test case')
  .argument('<test-id>', 'The test case ID to delete')
  .action(deleteTestCase);

test
  .command('run')
  .description('Run a batch test for a conversation flow')
  .argument('<flow-id>', 'The conversation flow ID')
  .option('--test-ids <file-path>', 'JSON file containing array of test case IDs to run')
  .option('--poll', 'Wait for batch test to complete')
  .option('--interval <ms>', 'Poll interval in milliseconds', '5000')
  .option('--timeout <ms>', 'Maximum wait time in milliseconds', '600000')
  .option('-o, --output <file-path>', 'Path to save the batch test result')
  .action(async (flowId, options) => {
    let testCaseIds = null;
    if (options.testIds) {
      const idsStr = await fs.readFile(options.testIds, 'utf8');
      testCaseIds = JSON.parse(idsStr);
    }

    const result = await runBatchTest(flowId, testCaseIds, {
      poll: !!options.poll,
      intervalMs: parseInt(options.interval, 10),
      timeoutMs: parseInt(options.timeout, 10),
    });
    await handleOutput(result, options.output);
  });

test
  .command('status')
  .description('Check the status of a batch test')
  .argument('<batch-id>', 'The batch test ID')
  .option('-o, --output <file-path>', 'Path to save the batch test status')
  .action(async (batchId, options) => {
    const result = await getBatchTestStatus(batchId);
    await handleOutput(result, options.output);
  });

program.parse(process.argv);
