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
    // API requires test_case_definition_ids — auto-fetch all if none provided
    if (!testCaseIds || testCaseIds.length === 0) {
      console.log('No test case IDs specified — fetching all for this flow...');
      const allCases = await listTestCases(flowId);
      testCaseIds = (Array.isArray(allCases) ? allCases : []).map(
        (tc) => tc.test_case_definition_id
      );
      if (testCaseIds.length === 0) {
        throw new Error(`No test cases found for flow ${flowId}`);
      }
      console.log(`Will run ${testCaseIds.length} test case(s).`);
    }

    const body = {
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: flowId,
      },
      test_case_definition_ids: testCaseIds,
    };

    console.log(`Starting batch test for flow ${flowId}...`);
    const result = await retell.post('/create-batch-test', { body });
    const bid = result.test_case_batch_job_id || result.batch_test_id || result.id;
    console.log(`Batch test created: ${bid || 'OK'}`);
    return result;
  } catch (error) {
    console.error('Error creating batch test:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getBatchTestStatus(batchId) {
  try {
    console.log(`Retrieving batch test status for ${batchId}...`);
    const result = await retell.get(`/get-batch-test/${batchId}`);
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
  const batchId = batch.test_case_batch_job_id || batch.batch_test_id || batch.id;

  if (!poll) return batch;

  console.log(`Polling batch ${batchId} every ${intervalMs / 1000}s (timeout: ${timeoutMs / 1000}s)...`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const status = await getBatchTestStatus(batchId);

    // API returns { status, pass_count, fail_count, error_count, total_count }
    const total = status.total_count || 0;
    const completed = (status.pass_count || 0) + (status.fail_count || 0) + (status.error_count || 0);

    console.log(`  Progress: ${completed}/${total} (pass: ${status.pass_count || 0}, fail: ${status.fail_count || 0}, error: ${status.error_count || 0})`);

    if (status.status === 'complete' || status.status === 'completed') {
      console.log('Batch test completed.');
      return status;
    }
    if (status.status === 'failed' || status.status === 'error') {
      console.error('Batch test failed.');
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
