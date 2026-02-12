const retell = require('./client');
const fs = require('fs').promises;
const path = require('path');
const { extractSecrets, injectSecrets, saveEnvFile, ensureGitignore, ENV_FILE_NAME, PLACEHOLDER_REGEX } = require('./secrets');

async function getFlow(flowId) {
  try {
    console.log(`Retrieving flow with ID: ${flowId}...`);
    const flow = await retell.conversationFlow.retrieve(flowId);
    console.log('Flow retrieved successfully.');
    return flow;
  } catch (error) {
    console.error(`Error retrieving flow ${flowId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function listFlows() {
  try {
    console.log('Listing all conversation flows...');
    const flows = await retell.conversationFlow.list();
    console.log(`Found ${flows.length} flows.`);
    return flows;
  } catch (error) {
    console.error('Error listing flows:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteFlow(flowId) {
  try {
    console.log(`Deleting flow with ID: ${flowId}...`);
    await retell.conversationFlow.delete(flowId);
    console.log(`Flow ${flowId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting flow ${flowId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Pull a flow and extract secrets into .env.retell.
 * Returns the sanitized flow (with {{PLACEHOLDER}} tokens).
 */
async function pullFlowWithSecrets(flowId, outputPath) {
  const flow = await getFlow(flowId);
  const { sanitizedFlow, secrets } = extractSecrets(flow);

  const secretCount = Object.keys(secrets).length;
  if (secretCount > 0) {
    // Resolve env file path relative to output file or cwd
    const baseDir = outputPath ? path.dirname(path.resolve(outputPath)) : process.cwd();
    const envFilePath = path.join(baseDir, ENV_FILE_NAME);

    saveEnvFile(envFilePath, secrets);
    ensureGitignore(baseDir);
    console.log(`Extracted ${secretCount} secret(s) to ${envFilePath}`);
  }

  return sanitizedFlow;
}

async function createOrUpdateFlow(filePath) {
  try {
    console.log(`Reading flow configuration from ${filePath}...`);
    const flowConfigStr = await fs.readFile(filePath, 'utf8');
    let flowConfig = JSON.parse(flowConfigStr);

    // Check for {{PLACEHOLDER}} tokens and inject secrets if found
    PLACEHOLDER_REGEX.lastIndex = 0;
    if (PLACEHOLDER_REGEX.test(flowConfigStr)) {
      const envFilePath = path.join(path.dirname(path.resolve(filePath)), ENV_FILE_NAME);
      console.log('Detected secret placeholders — injecting from .env.retell...');
      flowConfig = injectSecrets(flowConfig, envFilePath);
    }

    // Check if flow has an ID (for update) or not (for create)
    if (flowConfig.conversation_flow_id || flowConfig.id) {
      // Update existing flow
      const flowId = flowConfig.conversation_flow_id || flowConfig.id;
      console.log(`Updating existing flow with ID: ${flowId}...`);

      // Remove the ID from the config before updating
      const updateConfig = { ...flowConfig };
      delete updateConfig.conversation_flow_id;
      delete updateConfig.id;

      const response = await retell.conversationFlow.update(flowId, updateConfig);
      console.log(`Flow ${flowId} updated successfully.`);
      return response;
    } else {
      // Create new flow (tools won't be stored on first create)
      console.log('Creating new conversation flow...');
      const createResponse = await retell.conversationFlow.create(flowConfig);

      if (!createResponse || !createResponse.conversation_flow_id) {
        console.error('Failed to create flow. Response:', createResponse);
        throw new Error('Flow creation did not return a valid ID.');
      }

      const flowId = createResponse.conversation_flow_id;
      console.log(`Flow created with ID: ${flowId}. Now updating to persist tools...`);

      // Update the flow to persist tools
      const updateResponse = await retell.conversationFlow.update(flowId, flowConfig);
      console.log(`Flow ${flowId} updated successfully with tools.`);
      return updateResponse;
    }
  } catch (error) {
    console.error(`Error deploying flow from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  getFlow,
  listFlows,
  deleteFlow,
  createOrUpdateFlow,
  pullFlowWithSecrets,
};
