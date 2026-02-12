const retell = require('./client');
const fs = require('fs').promises;

async function getAgent(agentId) {
  try {
    console.log(`Retrieving agent with ID: ${agentId}...`);
    const agent = await retell.agent.retrieve(agentId);
    console.log('Agent retrieved successfully.');
    return agent;
  } catch (error) {
    console.error(`Error retrieving agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function listAgents() {
  try {
    console.log('Listing all agents...');
    const agents = await retell.agent.list();
    console.log(`Found ${agents.length} agents.`);
    return agents;
  } catch (error) {
    console.error('Error listing agents:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteAgent(agentId) {
  try {
    console.log(`Deleting agent with ID: ${agentId}...`);
    await retell.agent.delete(agentId);
    console.log(`Agent ${agentId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deployAgent(filePath) {
  try {
    console.log(`Reading agent configuration from ${filePath}...`);
    const agentConfigStr = await fs.readFile(filePath, 'utf8');
    const agentConfig = JSON.parse(agentConfigStr);

    // Check if agent has an ID (for update) or not (for create)
    if (agentConfig.agent_id || agentConfig.id) {
      // Update existing agent
      const agentId = agentConfig.agent_id || agentConfig.id;
      console.log(`Updating existing agent with ID: ${agentId}...`);
      
      // Remove the ID from the config before updating
      const updateConfig = { ...agentConfig };
      delete updateConfig.agent_id;
      delete updateConfig.id;
      
      const response = await retell.agent.update(agentId, updateConfig);
      console.log(`Agent ${agentId} updated successfully.`);
      return response;
    } else {
      // Create new agent
      console.log('Creating new agent...');
      const response = await retell.agent.create(agentConfig);
      console.log(`Agent created successfully with ID: ${response.agent_id}`);
      return response;
    }
  } catch (error) {
    console.error(`Error deploying agent from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function updateAgent(agentId, filePath) {
  try {
    console.log(`Reading agent configuration from ${filePath}...`);
    const agentConfigStr = await fs.readFile(filePath, 'utf8');
    const agentConfig = JSON.parse(agentConfigStr);
    
    // Remove any ID fields from the config
    delete agentConfig.agent_id;
    delete agentConfig.id;
    
    console.log(`Updating agent with ID: ${agentId}...`);
    const response = await retell.agent.update(agentId, agentConfig);
    console.log(`Agent ${agentId} updated successfully.`);
    return response;
  } catch (error) {
    console.error(`Error updating agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function publishAgent(agentId) {
  try {
    console.log(`Publishing agent with ID: ${agentId}...`);
    const response = await retell.agent.publish(agentId);
    console.log(`Agent ${agentId} published successfully.`);
    return response;
  } catch (error) {
    // The publish endpoint returns an empty body with Content-Type: application/json,
    // causing the SDK's JSON parser to fail. The server-side publish still succeeds.
    // Detect this specific case and treat it as success.
    if (error.type === 'invalid-json' && error.message?.includes('invalid json response body')) {
      console.log(`Agent ${agentId} published successfully.`);
      return { agent_id: agentId, published: true };
    }
    console.error(`Error publishing agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getAgentVersions(agentId) {
  try {
    console.log(`Retrieving versions for agent: ${agentId}...`);
    const versions = await retell.agent.getVersions(agentId);
    console.log(`Retrieved versions for agent ${agentId}.`);
    return versions;
  } catch (error) {
    console.error(`Error retrieving versions for agent ${agentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  getAgent,
  listAgents,
  deleteAgent,
  deployAgent,
  updateAgent,
  publishAgent,
  getAgentVersions,
};