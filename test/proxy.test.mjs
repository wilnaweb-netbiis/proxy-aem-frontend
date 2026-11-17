import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import config from '../proxy.config.mjs';

test('seleciona a configuracao pelo site e falha sem fallback para configuracoes invalidas', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = await mkdtemp(path.join(root, '.proxy-config-test-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await copyFile(new URL('../server.mjs', import.meta.url), path.join(fixture, 'server.mjs'));

  for (const [file, prefix] of [
    ['proxy.config.mjs', '/default'],
    ['proxy.config.apexbrasil.mjs', '/apexbrasil']
  ]) {
    await writeFile(path.join(fixture, file), `export default ${JSON.stringify({
      target: 'http://127.0.0.1',
      port: 0,
      hotReload: false,
      localClientlibPrefix: prefix,
      frontendDist: fixture,
      assets: {}
    })};`);
  }
  await writeFile(path.join(fixture, 'proxy.config.broken.mjs'), 'throw new Error("config quebrada");');

  const run = promisify(execFile);
  const serverUrl = pathToFileURL(path.join(fixture, 'server.mjs')).href;
  const script = `
    const { server } = await import(${JSON.stringify(serverUrl)});
    await import('node:events').then(({ once }) => once(server, 'listening'));
    const response = await fetch('http://localhost:' + server.address().port + '/__proxy_aem_live_reload.js');
    if (response.status !== 200) throw new Error('Proxy indisponivel');
    await new Promise(resolve => server.close(resolve));
  `;
  const options = { cwd: os.tmpdir(), timeout: 10000 };
  for (const [args, file, prefix] of [
    [[], 'proxy.config.mjs', '/default'],
    [['apexbrasil'], 'proxy.config.apexbrasil.mjs', '/apexbrasil']
  ]) {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script, 'server.mjs', ...args], options);
    assert.ok(stdout.includes(`Configuracao: ${file}`));
    assert.ok(stdout.includes(`Clientlib local: ${prefix}`));
  }

  for (const [args, message] of [
    [['missing'], /Falha ao carregar a configuracao proxy\.config\.missing\.mjs/],
    [['broken'], /config quebrada/],
    [['../apexbrasil'], /Uso: node server\.mjs/],
    [['apexbrasil', 'extra'], /Uso: node server\.mjs/]
  ]) {
    await assert.rejects(
      run(process.execPath, ['--input-type=module', '-e', script, 'server.mjs', ...args], options),
      error => error.code !== 0 && message.test(error.stderr)
    );
  }
});

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
