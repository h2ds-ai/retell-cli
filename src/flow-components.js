const retell = require('./client');
const fs = require('fs').promises;
const path = require('path');
const { extractSecrets, injectSecrets, saveEnvFile, ensureGitignore, ENV_FILE_NAME, PLACEHOLDER_REGEX } = require('./secrets');

async function getComponent(componentId) {
  try {
    console.log(`Retrieving component with ID: ${componentId}...`);
    const component = await retell.conversationFlowComponent.retrieve(componentId);
    console.log('Component retrieved successfully.');
    return component;
  } catch (error) {
    console.error(`Error retrieving component ${componentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function listComponents() {
  try {
    console.log('Listing all conversation flow components...');
    const components = await retell.conversationFlowComponent.list();
    console.log(`Found ${components.length} components.`);
    return components;
  } catch (error) {
    console.error('Error listing components:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteComponent(componentId) {
  try {
    console.log(`Deleting component with ID: ${componentId}...`);
    await retell.conversationFlowComponent.delete(componentId);
    console.log(`Component ${componentId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting component ${componentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deployComponent(filePath) {
  try {
    console.log(`Reading component configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    let config = JSON.parse(configStr);

    // Check for {{PLACEHOLDER}} tokens and inject secrets if found
    PLACEHOLDER_REGEX.lastIndex = 0;
    if (PLACEHOLDER_REGEX.test(configStr)) {
      const envFilePath = path.join(path.dirname(path.resolve(filePath)), ENV_FILE_NAME);
      console.log('Detected secret placeholders — injecting from .env.retell...');
      config = injectSecrets(config, envFilePath);
    }

    if (config.conversation_flow_component_id || config.id) {
      const componentId = config.conversation_flow_component_id || config.id;
      console.log(`Updating existing component with ID: ${componentId}...`);

      const updateConfig = { ...config };
      delete updateConfig.conversation_flow_component_id;
      delete updateConfig.id;

      const response = await retell.conversationFlowComponent.update(componentId, updateConfig);
      console.log(`Component ${componentId} updated successfully.`);
      return response;
    } else {
      console.log('Creating new conversation flow component...');
      const response = await retell.conversationFlowComponent.create(config);
      console.log(`Component created successfully with ID: ${response.conversation_flow_component_id}`);
      return response;
    }
  } catch (error) {
    console.error(`Error deploying component from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function updateComponent(componentId, filePath) {
  try {
    console.log(`Reading component configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    let config = JSON.parse(configStr);

    // Check for {{PLACEHOLDER}} tokens and inject secrets if found
    PLACEHOLDER_REGEX.lastIndex = 0;
    if (PLACEHOLDER_REGEX.test(configStr)) {
      const envFilePath = path.join(path.dirname(path.resolve(filePath)), ENV_FILE_NAME);
      console.log('Detected secret placeholders — injecting from .env.retell...');
      config = injectSecrets(config, envFilePath);
    }

    delete config.conversation_flow_component_id;
    delete config.id;

    console.log(`Updating component with ID: ${componentId}...`);
    const response = await retell.conversationFlowComponent.update(componentId, config);
    console.log(`Component ${componentId} updated successfully.`);
    return response;
  } catch (error) {
    console.error(`Error updating component ${componentId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Pull a component and extract secrets into .env.retell.
 * Returns the sanitized component (with {{PLACEHOLDER}} tokens).
 */
async function pullComponentWithSecrets(componentId, outputPath) {
  const component = await getComponent(componentId);
  const { sanitizedFlow: sanitizedComponent, secrets } = extractSecrets(component);

  const secretCount = Object.keys(secrets).length;
  if (secretCount > 0) {
    const baseDir = outputPath ? path.dirname(path.resolve(outputPath)) : process.cwd();
    const envFilePath = path.join(baseDir, ENV_FILE_NAME);

    saveEnvFile(envFilePath, secrets);
    ensureGitignore(baseDir);
    console.log(`Extracted ${secretCount} secret(s) to ${envFilePath}`);
  }

  return sanitizedComponent;
}

module.exports = {
  getComponent,
  listComponents,
  deleteComponent,
  deployComponent,
  updateComponent,
  pullComponentWithSecrets,
};
