// Actual TLS HTTP/2, concurrent static/PHP streams, cookies and PHP CSRF guards.
// Run against scripts/smoke-image.py's isolated synthetic fixture only.
const http2 = require('node:http2');
const assert = require('node:assert/strict');
const origin = process.argv[2];
const client = http2.connect(origin, {rejectUnauthorized: false});
client.setTimeout(20000, () => client.destroy(new Error('HTTP/2 fixture timeout')));
client.on('error', error => { console.error(error.message); process.exitCode = 1; });
function request(path, extra = {}) {
  return new Promise((resolve, reject) => {
    const stream = client.request({':path': path, ...extra});
    const chunks = [];
    let headers;
    stream.on('response', value => { headers = value; });
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve({headers, body: Buffer.concat(chunks)}));
    stream.end();
  });
}
(async () => {
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  assert.equal(client.alpnProtocol, 'h2');
  const first = await request('/cloud-saves/api.php?action=status');
  assert.equal(first.headers[':status'], 200);
  const data = JSON.parse(first.body);
  assert.equal(data.config.appName, 'Release Test Arcade', 'FPM must inherit runtime environment');
  const cookie = first.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  assert(cookie && data.csrf);
  const responses = await Promise.all(Array.from({length: 16}, (_, i) => request(i % 2
    ? '/cloud-saves/api.php?action=status' : '/content/nes/roms/first.nes', i % 2
    ? {cookie} : {range: 'bytes=0-3'})));
  for (const [i, response] of responses.entries()) {
    if (i % 2) {
      assert.equal(response.headers[':status'], 200);
      assert.equal(JSON.parse(response.body).csrf, data.csrf, 'PHP session must survive across streams');
      assert.match(response.headers['cache-control'], /no-store/);
    } else {
      assert.equal(response.headers[':status'], 206);
      assert.deepEqual(response.body, Buffer.from([0x4e, 0x45, 0x53, 0x1a]));
      assert.match(response.headers['content-range'], /^bytes 0-3\//);
    }
  }
  for (const [headers, status] of [
    [{cookie}, 403],
    [{cookie, 'x-csrf-token': data.csrf, origin: 'https://foreign.example'}, 403],
    [{cookie, 'x-csrf-token': data.csrf}, 200],
  ]) {
    const response = await request('/cloud-saves/api.php?action=cancel', {':method': 'POST', ...headers});
    assert.equal(response.headers[':status'], status);
  }
  const html = await request('/play/');
  assert.equal(html.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(html.headers['cross-origin-embedder-policy'], 'require-corp');
  console.log('PASS TLS h2, 16 concurrent PHP/range streams, runtime env, session/CSRF/origin guards and isolation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => client.close());
