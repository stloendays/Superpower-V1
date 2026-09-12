const mode = process.argv[2];
const port = Number(process.env.CHROME_DEBUG_PORT || 0);
const extensionPath = process.env.SUPERPOWER_EXTENSION_PATH || '';
const extensionId = process.env.SUPERPOWER_EXTENSION_ID || '';

if (!['discover', 'verify'].includes(mode)) {
  throw new Error('Usage: node chrome_native_integration.mjs <discover|verify>');
}
if (!Number.isInteger(port) || port <= 0) throw new Error('CHROME_DEBUG_PORT is required.');
if (!extensionPath) throw new Error('SUPERPOWER_EXTENSION_PATH is required.');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function extensionPageTarget(expectedUrl) {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  let pageTargets = [];

  while (Date.now() < deadline) {
    try {
      const targets = await listTargets();
      pageTargets = targets.filter(item => item.type === 'page');
      const target = pageTargets.find(item => item.url === expectedUrl && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(300);
  }

  const targetSummary = pageTargets.map(item => item.url).join(', ');
  throw new Error(
    `Chrome never opened the Superpower integration page ${expectedUrl}.` +
      `${targetSummary ? ` Page targets: ${targetSummary}.` : ''}` +
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

async function readPageResult(client) {
  const deadline = Date.now() + 30_000;
  let raw = '';
  while (Date.now() < deadline) {
    raw = await evaluate(client, 'document.documentElement.dataset.superpowerResult || ""');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`Integration page returned malformed result JSON: ${raw}`);
      }
    }
    await sleep(200);
  }

  const diagnostics = await evaluate(
    client,
    `({
      readyState: document.readyState,
      boot: document.documentElement.dataset.superpowerBoot || '',
      title: document.title,
      scripts: Array.from(document.scripts).map(script => script.src || '<inline>'),
      bodyText: document.body?.innerText || ''
    })`,
  );
  throw new Error(`Integration page did not publish a result within 30 seconds. Diagnostics: ${JSON.stringify(diagnostics)}`);
}

async function verifyIntegration() {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('SUPERPOWER_EXTENSION_ID is invalid.');

  const workerTarget = await extensionWorkerTarget(extensionId);
  console.log(`Using extension service worker target: ${workerTarget.url}`);
  const workerClient = new CdpClient(workerTarget.webSocketDebuggerUrl);
  await workerClient.connect();

  try {
    await workerClient.command('Runtime.enable');
    const runtimeId = await evaluate(workerClient, 'chrome.runtime.id');
    assert(runtimeId === extensionId, `Service worker runtime ID mismatch: expected ${extensionId}, received ${runtimeId}`);
  } finally {
    workerClient.close();
  }

  const pageUrl = `chrome-extension://${extensionId}/native-integration.html`;
  const pageTarget = await extensionPageTarget(pageUrl);
  console.log(`Using manifest-declared options page target: ${pageTarget.url}`);
  const pageClient = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await pageClient.connect();

  try {
    await pageClient.command('Runtime.enable');
    const result = await readPageResult(pageClient);
    assert(result?.ok === true, `Extension integration page failed: ${JSON.stringify(result)}`);
    assert(result?.runtimeId === extensionId, `Extension page reported wrong runtime ID: ${JSON.stringify(result)}`);
    assert(result?.guiDelivered === true, `Qt GUI delivery was not confirmed: ${JSON.stringify(result)}`);
    console.log(`PASS: ${result.summary}`);
  } finally {
    pageClient.close();
  }
}

if (mode === 'discover') {
  await discoverExtensionId();
} else {
  await verifyIntegration();
}
