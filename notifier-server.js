const fs = require('fs');
const http = require('http');
const path = require('path');
const cp = require('child_process');

const async = require('async');
const debug = require('debug');

const Notifier = require('./github-notifier.js').Notifier;
const invalidSHA = /[^0-9a-f]/;

function makeExec (directory, filename) {
  const log = debug('notifier-server:script:' + filename);

  function doLog (prefix, text) {
    const parts = ('' + text).split(/\n/);
    parts.forEach(function (line) {
      if (line.length) {
        log(prefix, line);
      }
    });
  }

  // Use an async queue so that if we receive multiple events for the same repo,
  // we let the corresponding shell scripts run serially. Scripts may assume that
  // - Their project directory will not be operated on by other instances of self.
  // - No events will be skipped or considered redundant. Thus if they only react
  //   to certain commits or file changes, they can do so without state.
  // - The script exec for the "last" event reliably finishes last. This is
  //   especially important for scripts that deploy services.
  const queue = async.queue(function spawn (eventData, callback) {
    const commit = eventData.commit;
    log('spawn', commit);

    const proc = cp.spawn(directory + '/' + filename, [commit]);
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
      callback(null);
    });
  });

  queue.drain = function () {
    log('done');
  };

  return function (data) {
    if (invalidSHA.test(data.commit)) {
      log('Bad Request', data);
      return;
    }

    log('queue', data.commit);
    queue.push(data);
  };
}

/**
 * @param {Object} argv
 * @param {number} argv.port
 * @param {string} argv.directory
 * @param {boolean} [argv.debug=false]
 * @return {Promise<http.Server>}
 */
function start (argv) {
  const port = argv.port;
  const directory = argv.directory;

  const notifier = new Notifier();
  const server = http.createServer();

  debug.enable('notifier-server:error');
  if (argv.debug) {
    debug.enable('notifier-server:*');
  }

  const error = debug('notifier-server:error');
  const log = debug('notifier-server:server');

  fs.readdirSync(directory).forEach(function (file) {
    if (!/\.js$/.exec(file)) {
      return;
    }
    log('Including ' + directory + '/' + file);
    const js = directory + '/' + file;
    const sh = file.replace(/\.js$/, '.sh');
    require(js)(notifier, makeExec(directory, sh));
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

function cli () {
  const optimist = require('optimist');
  const opts = optimist
    .usage('Start a server that listens for GitHub web hooks and execute scripts from a directory\n\t$0')
    .options('port', {
      alias: 'p',
      default: 3333,
      describe: 'Port number for HTTP server'
    })
    .options('directory', {
      alias: 'd',
      default: path.join(__dirname, 'notifier.d')
    })
    .options('debug', {
      type: 'boolean',
      describe: 'Enable verbose logging'
    })
    .options('help', {
      alias: 'h',
      type: 'boolean',
      describe: 'Display usage information'
    });
  const argv = opts.argv;

  if (argv.help) {
    console.log(opts.help());
    process.exit();
  }

  start(argv);
}

module.exports = { start, cli };
