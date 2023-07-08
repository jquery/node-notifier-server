const fs = require('fs');
const http = require('http');
const path = require('path');
const cp = require('child_process');

const program = require('commander');

const Notifier = require('./github-notifier.js').Notifier;
const invalidSHA = /[^0-9a-f]/;

function makeLogger (logFn, namespace) {
  return function log (message) {
    if (message instanceof Error) {
      message = message.stack;
    }
    for (const line of String(message).split('\n')) {
      logFn(`[${namespace}] ${line}`);
    }
  };
}

function makeExec (directory, filename, log) {
  function doLog (prefix, text) {
    const parts = ('' + text).split(/\n/);
    for (const line of parts) {
      if (line.length) {
        log(prefix, line);
      }
    }
  }

  // Use an async queue so that if we receive multiple events for the same repo,
  // we let the corresponding shell scripts run serially. Scripts may assume that:
  // - Their project directory will not be operated on by other instances of self.
  // - No events will be skipped or considered redundant. Thus if they only react
  //   to certain commits or file changes, they can do so without state.
  // - The script exec for the "last" event reliably finishes last. This is
  //   especially important for scripts that deploy services.
  let queue = Promise.resolve();
  function spawn (eventData, callback) {
    const commit = eventData.commit;
    log('spawn', commit);

    const proc = cp.spawn(path.join(directory, filename), [commit]);
    proc.stdout.on('data', function (data) {
      doLog('out', data);
    });
    proc.stderr.on('data', function (data) {
      doLog('err', data);
    });
    proc.on('exit', function (code) {
      log('exit', code);
    });
    proc.on('close', function () {
      // Ignore errors
      log('done');
      callback();
    });
  }

  return function (data) {
    if (invalidSHA.test(data.commit)) {
      log('Invalid commit SHA1', data);
      return;
    }

    log('queue', data.commit);
    queue = queue.then(function () {
      return new Promise(function (resolve) {
        spawn(data, resolve);
      });
    });
  };
}

/**
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} opts.directory
 * @param {boolean} [opts.debug=false]
 * @param {Function} [opts.logFn]
 * @return {Promise<http.Server>}
 */
function start (opts) {
  const port = opts.port;
  const directory = opts.directory;
  const logFn = opts.logFn || console.log.bind(console);

  const config = {
    webhookSecret: ''
  };
  const confFile = path.join(__dirname, 'config.json');
  if (fs.existsSync(confFile)) {
    config.webhookSecret = require('./config.json').webhookSecret || '';
  }
  if (process.env.WEBHOOK_SECRET) {
    config.webhookSecret = process.env.WEBHOOK_SECRET;
  }

  // Limits:
  // * Timeout: 5s max socket inactivity <https://nodejs.org/api/http.html#servertimeout>.
  // * Headers timeout: 60s in total [default] <https://nodejs.org/api/http.html#serverheaderstimeout>.
  // * Keep-alive timeout: 5s [default] <https://nodejs.org/api/http.html#serverkeepalivetimeout>.
  // * Body length: 200KB (enforced by github-notifier.js#Notifier-handler).
  const server = http.createServer();
  server.timeout = 5000;

  const notifier = new Notifier(config);

  const error = makeLogger(logFn, 'notifier-server:error');
  const log = opts.debug ? makeLogger(logFn, 'notifier-server:debug') : function () {};

  fs.readdirSync(directory).forEach(function (file) {
    if (!/\.js$/.test(file)) {
      return;
    }
    const js = path.join(directory, file);
    log('Including ' + js);
    const sh = file.replace(/\.js$/, '.sh');
    const logScript = opts.debug ? makeLogger(logFn, 'notifier-server:script:' + sh) : function () {};
    require(js)(notifier, makeExec(directory, sh, logScript));
  });

  server.on('request', notifier.handler);
  server.on('error', error);
  notifier.on('error', error);

  return new Promise(function (resolve, reject) {
    server.on('error', function (e) {
      reject(e);
    });
    server.on('listening', function () {
      log('The notifier-server is listening on port ' + server.address().port);
      resolve(server);
    });
    server.listen(port);
  });
}

/** @param {string} value */
function parseOptPort (value) {
  const num = +value;
  if (num < 1024 || num > 49151) {
    throw new program.InvalidOptionArgumentError('Port must be between 1024-49151.');
  }
  return num;
}

/** @param {string} value */
function parseOptDir (value) {
  try {
    const stat = fs.statSync(value);
    if (stat.isDirectory()) {
      return value;
    }
  } catch (e) {
  }

  throw new program.InvalidOptionArgumentError('Directory must exist.');
}

function cli () {
  program._name = 'notifier-server';
  program
    .description('Start a server that listens for GitHub web hooks and execute scripts from a directory')
    .option('-p, --port <number>', 'port number for HTTP server', parseOptPort, 3333)
    .option('-d, --directory <path>', 'directory with subscriber scripts', parseOptDir,
      path.join(__dirname, 'notifier.d')
    )
    .option('--debug', 'enable verbose logging')
    // --help is included by default
    // The parse() method will exit early for help or invalid arg error.
    .parse(process.argv);

  const opts = program.opts();
  start(opts);
}

module.exports = { start, cli };
