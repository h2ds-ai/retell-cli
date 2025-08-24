
const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);

async function executeCurl(command) {
  try {
    const { stdout, stderr } = await execPromise(command);
    if (stderr && !stderr.includes("Upload completely sent off")) {
      const isWarning = /Warning: (.*)/.test(stderr);
      if (!isWarning) {
        console.error(`Curl command stderr: ${stderr}`);
        // Attempt to parse stdout for a Retell error message
        try {
          const errorJson = JSON.parse(stdout);
          if (errorJson.error) {
            throw new Error(`Retell API Error: ${errorJson.error}`);
          }
        } catch (e) {
          // Not a JSON error, throw original stderr
        }
        throw new Error(`Curl command failed with stderr: ${stderr}`);
      }
    }
    return JSON.parse(stdout);
  } catch (e) {
    console.error(`Error executing curl command: ${command}`);
    console.error(e);
    throw e;
  }
}

module.exports = { executeCurl };
