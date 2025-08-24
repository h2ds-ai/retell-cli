
const Retell = require('retell-sdk');

const apiKey = process.env.RETELL_API_KEY;

if (!apiKey) {
  console.error('Error: RETELL_API_KEY environment variable is not set.');
  process.exit(1);
}

const retell = new Retell({
  apiKey: apiKey,
});

module.exports = retell;
