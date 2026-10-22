const { runTests } = require('./test-e2e');
require('./server');

setTimeout(async () => {
  try {
    await runTests();
    console.log('\nTesting complete. Exiting gracefully.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}, 2500);
