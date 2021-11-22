const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let tmpDirCache;

module.exports = {
  // https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#push
  mocks: {
    examplePushBranch: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-GitHub-Event': 'push'
      },
      body: {
        ref: 'refs/heads/main',
        before: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
        after: 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
        repository: {
          name: 'test',
          full_name: 'example/test',
          owner: {
            name: 'example',
            login: 'example'
          }
        },
        created: false,
        deleted: false
      }
    },
    examplePushTag: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-GitHub-Event': 'push'
      },
      body: {
        ref: 'refs/tags/v3.1.1',
        before: '0000000000000000000000000000000000000000',
        after: 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
        repository: {
          name: 'test',
          full_name: 'example/test',
          owner: {
            name: 'example',
            login: 'example'
          }
        },
        created: true,
        deleted: false
      }
    },
    examplePing: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-GitHub-Event': 'ping'
      },
      body: {
        ref: 'refs/heads/main',
        before: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
        after: 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
        repository: {
          name: 'test',
          full_name: 'example/test',
          owner: {
            name: 'example',
            login: 'example'
          }
        },
        created: false,
        deleted: false
      }
    }
  },

  getTmpDir () {
    if (!tmpDirCache) {
      tmpDirCache = fs.mkdtempSync(path.join(os.tmpdir(), 'notifier'));
    } else {
      fs.mkdirSync(tmpDirCache);
    }
    return tmpDirCache;
  },

  writeExportedJs (dir, filename, fn) {
    function wrapperSrc () {
      wrapperSrc.real.apply(this, arguments);
    }

    fs.writeFileSync(
      path.join(dir, filename),
      `module.exports = ${wrapperSrc.toString()};`
    );

    // Usually require() returns a cached export since we write the
    // exact same file path multiple times during the test run.
    // That's fine because only the 'real' property assignment matters.
    const wrapper = require(path.join(dir, filename));
    wrapper.real = fn;
  },

  writeShellExec (dir, filename, contents) {
    fs.writeFileSync(
      path.join(dir, filename),
      String(contents)
    );
    fs.chmodSync(
      path.join(dir, filename),
      0o775
    );
  },

  /**
   * @param {string} url
   * @param {Object} options
   * @param {string} options.method
   * @param {Object<string,string>} options.headers
   * @param {Object} options.body Object to encode as JSON
   */
  request (url, options) {
    const req = http.request(url, {
      method: options.method,
      headers: options.headers
    });
    req.write(JSON.stringify(options.body));
    req.end();
  }
};
