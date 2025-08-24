const retell = require('./client');
const fs = require('fs').promises;

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

async function createOrUpdateFlow(filePath) {
  try {
    console.log(`Reading flow configuration from ${filePath}...`);
    const flowConfigStr = await fs.readFile(filePath, 'utf8');
    const flowConfig = JSON.parse(flowConfigStr);

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
};