import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import config from '../proxy.config.mjs';

test('encaminha POSTs e ajusta apenas o Referer do próprio proxy', async (t) => {
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString()
      }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));

  config.target = `http://127.0.0.1:${upstream.address().port}`;
  config.port = 0;
  config.hotReload = false;
  config.debug = false;
  const { server } = await import('../server.mjs');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const localOrigin = `http://localhost:${server.address().port}`;
  const requestPath = '/content/example.searchFreeProduct.json?test=1';
  const body = 'fulltext=Coffee+decaffeinated%2C+not+roasted&page=1&pageSize=16';
  const refererPath = '/braziliansuppliers/Coffee%20decaffeinated?test=1';
  const response = await fetch(`${localOrigin}${requestPath}`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: localOrigin,
      referer: `${localOrigin}${refererPath}`
    },
    body
  });
  assert.equal(response.status, 200);
  const forwarded = await response.json();
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.url, requestPath);
  assert.equal(forwarded.body, body);
  assert.equal(forwarded.headers['content-type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  assert.equal(forwarded.headers.referer, `${config.target}${refererPath}`);
  assert.equal(forwarded.headers.origin, undefined);

  for (const referer of ['https://other.example/path', 'invalid']) {
    const otherResponse = await fetch(`${localOrigin}${requestPath}`, {
      method: 'POST',
      headers: { referer }
    });
    assert.equal((await otherResponse.json()).headers.referer, referer);
  }

  const withoutReferer = await fetch(`${localOrigin}${requestPath}`, { method: 'POST' });
  assert.equal((await withoutReferer.json()).headers.referer, undefined);

  const getResponse = await fetch(`${localOrigin}${requestPath}`, {
    headers: { referer: `${localOrigin}${refererPath}` }
  });
  const forwardedGet = await getResponse.json();
  assert.equal(forwardedGet.method, 'GET');
  assert.equal(forwardedGet.headers.referer, `${localOrigin}${refererPath}`);
});
