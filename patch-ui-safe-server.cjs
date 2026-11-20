const fs = require('fs');
const file = 'server/server.ts';
const source = fs.readFileSync(file, 'utf8');

const changes = [
  {
    name: 'safe-mode flag',
    old: "function startBackgroundWork() {",
    replacement: "const localUiSafeMode = process.env.LOCAL_UI_SAFE_MODE === 'true';\n\nfunction startBackgroundWork() {"
  },
  {
    name: 'shutdown flush guard',
    old: `    void Promise.allSettled([flush(), flushMetrics(), flushChecks()])
      .then(() => closePool())
      .then(() => log.info('server', 'shutdown complete'))
      .finally(() => process.exit(0));`,
    replacement: `    const shutdownWork = localUiSafeMode
      ? closePool()
      : Promise.allSettled([flush(), flushMetrics(), flushChecks()]).then(() => closePool());
    void shutdownWork
      .then(() => log.info('server', 'shutdown complete'))
      .finally(() => process.exit(0));`
  },
  {
    name: 'startup background-work guard',
    old: `  startBackgroundWork();
  log.info('server', 'ready — database loaded, monitoring started');`,
    replacement: `  if (localUiSafeMode) {
    log.info('server', 'ready — UI-safe mode; background monitoring disabled');
  } else {
    startBackgroundWork();
    log.info('server', 'ready — database loaded, monitoring started');
  }`
  }
];

let updated = source;
for (const change of changes) {
  const count = updated.split(change.old).length - 1;
  if (count !== 1) {
    console.error('Stopped:', change.name, 'expected one match; found', count);
    process.exit(1);
  }
  updated = updated.replace(change.old, change.replacement);
}

fs.writeFileSync(file, updated, 'utf8');
console.log('Updated the three UI-safe server sections.');
