const retell = require('./client');
const fs = require('fs').promises;

async function getChatAgent(agentId) {
  try {
    console.log(`Retrieving chat agent with ID: ${agentId}...`);
    const agent = await retell.chatAgent.retrieve(agentId);
    console.log('Chat agent retrieved successfully.');
    return agent;
  } catch (error) {
    console.error(`Error retrieving chat agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function listChatAgents() {
  try {
    console.log('Listing all chat agents...');
    const agents = await retell.chatAgent.list();
    console.log(`Found ${agents.length} chat agents.`);
    return agents;
  } catch (error) {
    console.error('Error listing chat agents:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteChatAgent(agentId) {
  try {
    console.log(`Deleting chat agent with ID: ${agentId}...`);
    await retell.chatAgent.delete(agentId);
    console.log(`Chat agent ${agentId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting chat agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deployChatAgent(filePath) {
  try {
    console.log(`Reading chat agent configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(configStr);

    if (config.agent_id || config.id) {
      const agentId = config.agent_id || config.id;
      console.log(`Updating existing chat agent with ID: ${agentId}...`);

      const updateConfig = { ...config };
      delete updateConfig.agent_id;
      delete updateConfig.id;

      const response = await retell.chatAgent.update(agentId, updateConfig);
      console.log(`Chat agent ${agentId} updated successfully.`);
      return response;
    } else {
      console.log('Creating new chat agent...');
      const response = await retell.chatAgent.create(config);
      console.log(`Chat agent created successfully with ID: ${response.agent_id}`);
      return response;
    }
  } catch (error) {
    console.error(`Error deploying chat agent from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function updateChatAgent(agentId, filePath) {
  try {
    console.log(`Reading chat agent configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(configStr);

    delete config.agent_id;
    delete config.id;

    console.log(`Updating chat agent with ID: ${agentId}...`);
    const response = await retell.chatAgent.update(agentId, config);
    console.log(`Chat agent ${agentId} updated successfully.`);
    return response;
  } catch (error) {
    console.error(`Error updating chat agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function publishChatAgent(agentId) {
  try {
    console.log(`Publishing chat agent with ID: ${agentId}...`);
    const response = await retell.chatAgent.publish(agentId);
    console.log(`Chat agent ${agentId} published successfully.`);
    return response;
  } catch (error) {
    // The publish endpoint returns an empty body with Content-Type: application/json,
    // causing the SDK's JSON parser to fail. The server-side publish still succeeds.
    // Detect this specific case and treat it as success.
    if (error.type === 'invalid-json' && error.message?.includes('invalid json response body')) {
      console.log(`Chat agent ${agentId} published successfully.`);
      return { agent_id: agentId, published: true };
    }
    console.error(`Error publishing chat agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getChatAgentVersions(agentId) {
  try {
    console.log(`Retrieving versions for chat agent: ${agentId}...`);
    const versions = await retell.chatAgent.getVersions(agentId);
    console.log(`Retrieved versions for chat agent ${agentId}.`);
    return versions;
  } catch (error) {
    console.error(`Error retrieving versions for chat agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  getChatAgent,
  listChatAgents,
  deleteChatAgent,
  deployChatAgent,
  updateChatAgent,
  publishChatAgent,
  getChatAgentVersions,
};
