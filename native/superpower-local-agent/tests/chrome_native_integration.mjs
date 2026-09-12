import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const port = Number(process.env.CHROME_DEBUG_PORT || 0);
const extensionPath = process.env.SUPERPOWER_EXTENSION_PATH || '';
const extensionId = process.env.SUPERPOWER_EXTENSION_ID || '';
const testRoot = process.env.SUPERPOWER_TEST_ROOT || '';

if (!['discover', 'verify'].includes(mode)) {
  throw new Error('Usage: node chrome_native_integration.mjs <discover|verify>');
}
if (!Number.isInteger(port) || port <= 0) throw new Error('CHROME_DEBUG_PORT is required.');
if (!extensionPath) throw new Error('SUPERPOWER_EXTENSION_PATH is required.');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizePath = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Chrome DevTools target query failed: HTTP ${response.status}`);
  return response.json();
}

function extensionIdFromTarget(target) {
  const match = String(target?.url || '').match(/^chrome-extension:\/\/([a-p]{32})\//);
  return match?.[1] || '';
}

async function extensionWorkerTarget(expectedId = '') {
  const expectedOrigin = expectedId ? `chrome-extension://${expectedId}/` : '';
  const deadline = Date.now() + 30_000;
  let lastError = '';
  let extensionTargets = [];

  while (Date.now() < deadline) {
    try {
      const targets = await listTargets();
      extensionTargets = targets.filter(
        item => item.type === 'service_worker' && String(item.url || '').startsWith('chrome-extension://'),
      );

      const target = extensionTargets.find(item => {
        if (!item.webSocketDebuggerUrl) return false;
        const url = String(item.url || '');
        if (expectedOrigin) return url.startsWith(expectedOrigin);
        return /^[a-p]{32}$/.test(extensionIdFromTarget(item));
      });
      if (target) return target;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(300);
  }

  const targetSummary = extensionTargets.map(item => `${item.type}:${item.url}`).join(', ');
  throw new Error(
    `Chrome never exposed Superpower's MV3 service worker${expectedId ? ` for ${expectedId}` : ''}.` +
      `${targetSummary ? ` Extension targets: ${targetSummary}.` : ''}` +
      `${lastError ? ` Last error: ${lastError}` : ''}`,
  );
}

async function discoverExtensionId() {
  const target = await extensionWorkerTarget();
  const id = extensionIdFromTarget(target);
  if (!/^[a-p]{32}$/.test(id)) throw new Error(`Could not read a valid extension ID from ${target.url}`);
  process.stdout.write(`${id}\n`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools WebSocket.')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Chrome DevTools WebSocket connection failed.'));
      });
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        if (!message.id || !this.pending.has(message.id)) return;
        const { resolve: finish, reject: fail } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message || JSON.stringify(message.error)));
        else finish(message.result);
      });
    });
  }

  command(method, params = {}) {
    if (!this.socket) return Promise.reject(new Error('Chrome DevTools client is not connected.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Chrome evaluation failed.');
  }
  return result.result?.value;
}

async function verifyIntegration() {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('SUPERPOWER_EXTENSION_ID is invalid.');
  if (!testRoot) throw new Error('SUPERPOWER_TEST_ROOT is required.');

  fs.mkdirSync(testRoot, { recursive: true });
  const proofFile = path.join(testRoot, 'native-message-proof.txt');
  fs.writeFileSync(proofFile, 'Superpower real Native Messaging integration proof.\n', 'utf8');

  const target = await extensionWorkerTarget(extensionId);
  console.log(`Using extension service worker target: ${target.url}`);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  let alias = '';
  try {
    await client.command('Runtime.enable');
    const runtimeId = await evaluate(client, 'chrome?.runtime?.id');
    assert(runtimeId === extensionId, `Service worker runtime ID mismatch: expected ${extensionId}, received ${runtimeId}`);

    const send = payload =>
      evaluate(client, `chrome.runtime.sendMessage(${JSON.stringify({ type: 'local-agent:request', payload })})`);

    const ping = await send({ id: 'ci-ping', action: 'ping', args: {} });
    assert(ping?.success === true, `Bridge ping failed: ${JSON.stringify(ping)}`);
    assert(ping?.payload?.ok === true, `Native host ping failed: ${JSON.stringify(ping)}`);
    assert(
      ping?.payload?.result?.service === 'superpower-local-agent',
      `Unexpected native host identity: ${JSON.stringify(ping)}`,
    );

    const blocked = await send({
      id: 'ci-unapproved-memory',
      action: 'memory.remember',
      args: { alias: 'ci-unapproved', path: testRoot },
    });
    assert(blocked?.success === false, 'Browser bridge accepted an unapproved local-memory scope change.');
    assert(/approval/i.test(blocked?.error || ''), `Approval rejection was not explicit: ${JSON.stringify(blocked)}`);

    alias = `ci-native-${Date.now()}`;
    const remembered = await send({
      id: 'ci-remember',
      action: 'memory.remember',
      args: { alias, path: testRoot, approved: true },
    });
    assert(remembered?.success === true && remembered?.payload?.ok === true, `Remember failed: ${JSON.stringify(remembered)}`);

    const resolved = await send({
      id: 'ci-resolve',
      action: 'memory.resolve',
      args: { query: alias },
    });
    assert(resolved?.success === true && resolved?.payload?.ok === true, `Resolve failed: ${JSON.stringify(resolved)}`);
    assert(
      normalizePath(resolved?.payload?.result?.path || '') === normalizePath(testRoot),
      `Resolved path mismatch: ${JSON.stringify(resolved)}`,
    );

    const searched = await send({
      id: 'ci-search',
      action: 'file.search',
      args: { query: 'native-message-proof.txt', max_results: 10, max_scanned_entries: 1000 },
    });
    assert(searched?.success === true && searched?.payload?.ok === true, `File search failed: ${JSON.stringify(searched)}`);
    const matches = searched?.payload?.result?.matches || [];
    assert(
      matches.some(match => normalizePath(match.path) === normalizePath(proofFile)),
      `The remembered root did not yield the proof file: ${JSON.stringify(searched)}`,
    );

    const notified = await send({
      id: 'ci-gui-notify',
      action: 'gui.notify',
      args: {
        role: 'Assistant',
        source: 'Chrome CI',
        kind: 'success',
        text: 'Superpower real Chrome → Native Messaging → C++ → Qt GUI integration passed.',
      },
    });
    assert(notified?.success === true && notified?.payload?.ok === true, `GUI notification failed: ${JSON.stringify(notified)}`);
    assert(
      notified?.payload?.result?.delivered === true,
      `Native host could not deliver the message to the running Qt GUI: ${JSON.stringify(notified)}`,
    );

    const forgotten = await send({ id: 'ci-forget', action: 'memory.forget', args: { alias } });
    assert(forgotten?.success === true && forgotten?.payload?.ok === true, `Cleanup forget failed: ${JSON.stringify(forgotten)}`);
    alias = '';

    console.log('PASS: Chrome extension → Native Messaging → C++ host → SQLite/file search → Qt GUI IPC.');
  } finally {
    client.close();
  }
}

if (mode === 'discover') {
  await discoverExtensionId();
} else {
  await verifyIntegration();
}
