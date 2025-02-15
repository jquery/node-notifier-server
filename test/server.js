/* eslint-env qunit */
'use script';

const fs = require('fs');

const kleur = require('kleur');
const rimraf = require('rimraf');

const notifier = require('../notifier-server.js');
const util = require('./util.js');

QUnit.config.testTimeout = 1000;

function logFn (message) {
  console.info(kleur.grey('# ' + message));
}

QUnit.module('notifier-server', hooks => {
  let tmpDir = null;
  let servers = [];

  hooks.beforeEach(() => {
    tmpDir = util.getTmpDir();
  });

  hooks.afterEach(() => {
    if (tmpDir) {
      rimraf.sync(tmpDir);
      tmpDir = null;
    }

    servers.forEach(server => {
      server.close();
    });
    servers = [];

    delete process.env.WEBHOOK_SECRET;
  });

  async function startServer () {
    const server = await notifier.start({ directory: tmpDir, port: 0, debug: true, logFn: logFn });
    servers.push(server);
    return server;
  }

  QUnit.test('start server', async assert => {
    const server = await startServer();
    assert.strictEqual(typeof server.address().port, 'number');
  });

  QUnit.test('load subscriber script', async assert => {
    let called = 0;
    function subscriber () {
      called++;
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);
    assert.strictEqual(called, 0);

    await startServer();
    assert.strictEqual(called, 1);
  });

  QUnit.test('emit correct event after "push" webhook with branch', async assert => {
    const done = assert.async();
    function subscriber (notifier) {
      notifier.on('example/test/push/heads/main', function (data) {
        assert.propEqual(data, {
          owner: 'example',
          repo: 'test',
          type: 'push',
          commit: 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
          branch: 'main'
        }, 'callback data');
        done();
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    const resp = await util.request(address, util.mocks.examplePushBranch);

    assert.strictEqual(resp.statusCode, 202, 'status code');
  });

  QUnit.test('emit correct event after "push" webhook with tag', async assert => {
    const done = assert.async();
    function subscriber (notifier) {
      notifier.on('example/test/push/tags/*', function (data) {
        assert.strictEqual(data.commit, 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2', 'callback data.commit');
        assert.strictEqual(data.tag, 'v3.1.1', 'callback data.tag');
        done();
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    const resp = await util.request(address, util.mocks.examplePushTag);

    assert.strictEqual(resp.statusCode, 202, 'status code');
  });

  QUnit.test('emit correct event after "push" webhook with tag and correct signature', async assert => {
    const done = assert.async();
    function subscriber (notifier) {
      notifier.on('example/test/push/tags/*', function (data) {
        assert.strictEqual(data.commit, 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2', 'callback data.commit');
        assert.strictEqual(data.tag, 'v3.1.1', 'callback data.tag');
        done();
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    process.env.WEBHOOK_SECRET = util.mocks.securePushTagSigned.secret;
    const resp = await util.request(address, util.mocks.securePushTagSigned);

    assert.strictEqual(resp.statusCode, 202, 'status code');
  });

  QUnit.test('exec shell script after after "push" webhook with branch', async assert => {
    function subscriber (notifier, exec) {
      notifier.on('example/test/push/heads/*', exec);
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);
    util.writeShellExec(tmpDir, 'example.sh', `#!/bin/bash
echo "Received arg $1" > "${tmpDir}/example.out";
    `);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    util.request(address, util.mocks.examplePushBranch);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(
        fs.readFileSync(`${tmpDir}/example.out`, 'utf8').toString().trim(),
        'Received arg f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2'
      );
    }, 500);
  });

  QUnit.test('run shell scripts sequentially through a queue', async assert => {
    function subscriber (notifier, exec) {
      notifier.on('example/test/push/heads/*', exec);
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);
    util.writeShellExec(tmpDir, 'example.sh', `#!/bin/bash
SELF="$1"
OUT="${tmpDir}/example.out"
echo "$SELF: 0..." >> "$OUT"
sleep 0.1
echo "$SELF: 1..." >> "$OUT"
sleep 0.1
echo "$SELF: 2..." >> "$OUT"
sleep 0.1
echo "$SELF: 3..." >> "$OUT"
sleep 0.1
echo "$SELF: 4..." >> "$OUT"
sleep 0.1
echo "$SELF: Done!" >> "$OUT"
    `);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    util.request(address, util.mocks.examplePushA);
    util.request(address, util.mocks.examplePushB);
    util.request(address, util.mocks.examplePushC);

    assert.timeout(3000);
    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(
        fs.readFileSync(`${tmpDir}/example.out`, 'utf8').toString().trim(),
        `aaaaaaaa: 0...
aaaaaaaa: 1...
aaaaaaaa: 2...
aaaaaaaa: 3...
aaaaaaaa: 4...
aaaaaaaa: Done!
bbbbbbbb: 0...
bbbbbbbb: 1...
bbbbbbbb: 2...
bbbbbbbb: 3...
bbbbbbbb: 4...
bbbbbbbb: Done!
cccccccc: 0...
cccccccc: 1...
cccccccc: 2...
cccccccc: 3...
cccccccc: 4...
cccccccc: Done!`
      );
    }, 2500);
  });

  QUnit.test('secure notifier ignores "push" webhook with tag and no signature', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    process.env.WEBHOOK_SECRET = util.mocks.securePushTagUnsigned.secret;
    const resp = await util.request(address, util.mocks.securePushTagUnsigned);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
      assert.strictEqual(resp.statusCode, 202, 'status code');
    }, 500);
  });

  QUnit.test('secure notifier ignores "push" webhook with tag and bad signature', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    process.env.WEBHOOK_SECRET = util.mocks.securePushTagBadlySigned.secret;
    util.request(address, util.mocks.securePushTagBadlySigned);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
    }, 500);
  });

  QUnit.test('notifier for branch ignores "push" webhook with tag', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    util.request(address, util.mocks.examplePushTag);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
    }, 500);
  });

  QUnit.test('notifier for tag ignores "push" webhook with branch', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/test/push/tags/*', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    util.request(address, util.mocks.examplePushBranch);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
    }, 500);
  });

  QUnit.test('notifier ignores "push" webhook with different repo', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/different-test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    util.request(address, util.mocks.examplePushBranch);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
    }, 500);
  });

  QUnit.test('notifier ignores "ping" webhook', async assert => {
    let called = 0;
    function subscriber (notifier) {
      notifier.on('example/test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    const resp = await util.request(address, util.mocks.examplePing);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
      assert.strictEqual(resp.statusCode, 202, 'status code');
    }, 500);
  });

  QUnit.test('notifier ignores invalid json syntax', async assert => {
    let called = 0;
    let error = null;
    function subscriber (notifier) {
      notifier.on('error', function (e) {
        error = e;
      });
      notifier.on('example/test/push/heads/main', function () {
        called++;
      });
    }
    util.writeExportedJs(tmpDir, 'example.js', subscriber);

    const server = await startServer();
    const address = `http://localhost:${server.address().port}`;
    const resp = await util.request(address, util.mocks.badInvalidJson);

    const done = assert.async();
    setTimeout(() => {
      done();
      assert.strictEqual(called, 0);
      assert.strictEqual(error.name, 'SyntaxError', 'error');
      assert.strictEqual(resp.statusCode, 202, 'status code');
    }, 500);
  });
});
