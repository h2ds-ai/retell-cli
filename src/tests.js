const retell = require('./client');
const fs = require('fs').promises;

// ---------------------------------------------------------------------------
// Test Case CRUD
// ---------------------------------------------------------------------------

async function listTestCases(flowId) {
  try {
    console.log(`Listing test cases for flow ${flowId}...`);
    const result = await retell.get('/list-test-case-definitions', {
      query: { type: 'conversation-flow', conversation_flow_id: flowId },
    });
    console.log(`Found ${result.length ?? '?'} test case(s).`);
    return result;
  } catch (error) {
    console.error('Error listing test cases:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getTestCase(testId) {
  try {
    console.log(`Retrieving test case ${testId}...`);
    const result = await retell.get(`/get-test-case-definition/${testId}`);
    console.log('Test case retrieved successfully.');
    return result;
  } catch (error) {
    console.error(`Error retrieving test case ${testId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function createTestCase(filePath) {
  try {
    console.log(`Reading test case configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(configStr);

    console.log('Creating test case...');
    const result = await retell.post('/create-test-case-definition', { body: config });
    console.log('Test case created successfully.');
    return result;
  } catch (error) {
    console.error(`Error creating test case from ${filePath}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function updateTestCase(testId, filePath) {
  try {
    console.log(`Reading test case configuration from ${filePath}...`);
    const configStr = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(configStr);

    console.log(`Updating test case ${testId}...`);
    const result = await retell.put(`/update-test-case-definition/${testId}`, { body: config });
    console.log(`Test case ${testId} updated successfully.`);
    return result;
  } catch (error) {
    console.error(`Error updating test case ${testId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function deleteTestCase(testId) {
  try {
    console.log(`Deleting test case ${testId}...`);
    await retell.delete(`/delete-test-case-definition/${testId}`, {
      headers: { Accept: '*/*' },
    });
    console.log(`Test case ${testId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting test case ${testId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Batch Test Run + Poll
// ---------------------------------------------------------------------------

async function createBatchTest(flowId, testCaseIds) {
  try {
    const body = { conversation_flow_id: flowId };
    if (testCaseIds && testCaseIds.length > 0) {
      body.test_case_ids = testCaseIds;
    }

    console.log(`Starting batch test for flow ${flowId}...`);
    const result = await retell.post('/create-batch-test', { body });
    console.log(`Batch test created: ${result.batch_test_id || result.id || 'OK'}`);
    return result;
  } catch (error) {
    console.error('Error creating batch test:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getBatchTestStatus(batchId) {
  try {
    console.log(`Retrieving batch test status for ${batchId}...`);
    const result = await retell.get(`/list-test-runs/${batchId}`);
    return result;
  } catch (error) {
    console.error(`Error retrieving batch test ${batchId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Run a batch test and optionally poll until completion.
 *
 * @param {string}   flowId       - conversation flow ID
 * @param {string[]} testCaseIds  - optional subset of test case IDs
 * @param {Object}   opts
 * @param {boolean}  opts.poll        - whether to poll until done
 * @param {number}   opts.intervalMs  - poll interval (default 5000)
 * @param {number}   opts.timeoutMs   - max wait (default 10 minutes)
 * @returns batch test result
 */
async function runBatchTest(flowId, testCaseIds, { poll = false, intervalMs = 5000, timeoutMs = 600000 } = {}) {
  const batch = await createBatchTest(flowId, testCaseIds);
  const batchId = batch.batch_test_id || batch.id;

  if (!poll) return batch;

  console.log(`Polling batch ${batchId} every ${intervalMs / 1000}s (timeout: ${timeoutMs / 1000}s)...`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const status = await getBatchTestStatus(batchId);

    // The API may return a list of test runs or a wrapper object
    const runs = Array.isArray(status) ? status : (status.test_runs || []);
    const total = runs.length;
    const completed = runs.filter((r) => r.status === 'completed' || r.status === 'failed').length;

    console.log(`  Progress: ${completed}/${total} runs finished`);

    if (total > 0 && completed === total) {
      console.log('Batch test completed.');
      return status;
    }
  }

  console.error(`Batch test ${batchId} did not complete within ${timeoutMs / 1000}s.`);
  return getBatchTestStatus(batchId);
}

module.exports = {
  listTestCases,
  getTestCase,
  createTestCase,
  updateTestCase,
  deleteTestCase,
  createBatchTest,
  getBatchTestStatus,
  runBatchTest,
};
