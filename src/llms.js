const retell = require('./client');
const fs = require('fs').promises;
const path = require('path');
const { injectSecrets, ENV_FILE_NAME, PLACEHOLDER_REGEX } = require('./secrets');

/**
 * Read an LLM file and resolve {{PLACEHOLDER}} tokens from the .env.retell next to
 * it, the same way `flow deploy` does, so tool URLs never reach Retell as literals.
 */
async function readLlmConfig(filePath) {
  const llmConfigStr = await fs.readFile(filePath, 'utf8');
  let llmConfig = JSON.parse(llmConfigStr);
  PLACEHOLDER_REGEX.lastIndex = 0;
  if (PLACEHOLDER_REGEX.test(llmConfigStr)) {
    const envFilePath = path.join(path.dirname(path.resolve(filePath)), ENV_FILE_NAME);
    console.log('Detected secret placeholders: injecting from .env.retell...');
    llmConfig = injectSecrets(llmConfig, envFilePath);
  }
  return llmConfig;
}

async function getLlm(llmId) {
  try {
    console.log(`Retrieving LLM with ID: ${llmId}...`);
    const llm = await retell.llm.retrieve(llmId);
    console.log('LLM retrieved successfully.');
    return llm;
  } catch (error) {
    console.error(`Error retrieving LLM ${llmId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function listLlm() {
  try {
    console.log('Listing all Retell LLMs...');
    const llms = await retell.llm.list();
    console.log(`Found ${llms.length} LLMs.`);
    return llms;
  } catch (error) {
    console.error('Error listing LLMs:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteLlm(llmId) {
  try {
    console.log(`Deleting LLM with ID: ${llmId}...`);
    await retell.llm.delete(llmId);
    console.log(`LLM ${llmId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting LLM ${llmId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deployLlm(filePath) {
  try {
    console.log(`Reading LLM configuration from ${filePath}...`);
    const llmConfig = await readLlmConfig(filePath);

    // Check if LLM has an ID (for update) or not (for create)
    if (llmConfig.llm_id || llmConfig.id) {
      // Update existing LLM
      const llmId = llmConfig.llm_id || llmConfig.id;
      console.log(`Updating existing LLM with ID: ${llmId}...`);
      
      // Remove the ID from the config before updating
      const updateConfig = { ...llmConfig };
      delete updateConfig.llm_id;
      delete updateConfig.id;
      
      const response = await retell.llm.update(llmId, updateConfig);
      console.log(`LLM ${llmId} updated successfully.`);
      return response;
    } else {
      // Create new LLM
      console.log('Creating new LLM...');
      const response = await retell.llm.create(llmConfig);
      console.log(`LLM created successfully with ID: ${response.llm_id}`);
      return response;
    }
  } catch (error) {
    console.error(`Error deploying LLM from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function updateLlm(llmId, filePath) {
  try {
    console.log(`Reading LLM configuration from ${filePath}...`);
    const llmConfig = await readLlmConfig(filePath);

    // Remove any ID fields from the config
    delete llmConfig.llm_id;
    delete llmConfig.id;
    
    console.log(`Updating LLM with ID: ${llmId}...`);
    const response = await retell.llm.update(llmId, llmConfig);
    console.log(`LLM ${llmId} updated successfully.`);
    return response;
  } catch (error) {
    console.error(`Error updating LLM ${llmId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  getLlm,
  listLlm,
  deleteLlm,
  deployLlm,
  updateLlm,
  readLlmConfig,
};