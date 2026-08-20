const { runIntegrationTests } = require("./integration.test");

async function run() {
  await runIntegrationTests();
}

module.exports = { run };
