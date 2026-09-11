// Starts the static dev server, runs the test module named on argv[2]
// (its default export receives the server's base URL), then tears the
// server down and exits with that test's exit code. Shared by every
// npm script so each individual test file only has to worry about the
// actual test logic.
import { startServer } from './devserver.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node tools/run-with-server.js <test-file.js>');
  process.exit(2);
}

const { server, url } = await startServer(0);
let exitCode = 0;
try {
  const mod = await import(pathToFileURL(path.resolve(target)).href);
  await mod.default(url);
} catch (err) {
  console.error(`[${path.basename(target)}] FAILED:`, err && err.stack ? err.stack : err);
  exitCode = 1;
} finally {
  server.close();
}
process.exit(exitCode);
