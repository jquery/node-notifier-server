const crypto = require('crypto');
const util = require('util');
const EventEmitter2 = require('eventemitter2').EventEmitter2;

const MAX_BODY_LENGTH = 1024 * 1024; // 1 MiB

function Notifier (config = {}, allowInsecure = false) {
  EventEmitter2.call(this, {
    wildcard: true,
    delimiter: '/'
  });

  this.webhookSecret = config.webhookSecret || '';

  // SECURITY: Server requires a secret unless explicitly started with --insecure
  // This cannot be set via config.json, only via CLI argument.
  if (this.webhookSecret === '' && allowInsecure === true) {
    this.allowInsecure = true;
  }

  // Pre-bind to ease usage as a callback
  this.handler = this.handler.bind(this);
}
util.inherits(Notifier, EventEmitter2);

/**
 * @param {http.IncomingMessage} request <https://nodejs.org/docs/latest-v12.x/api/http.html#http_class_http_incomingmessage>
 * @param {http.ServerResponse} response <https://nodejs.org/docs/latest-v12.x/api/http.html#http_class_http_serverresponse
 */
Notifier.prototype.handler = function (request, response) {
  const notifier = this;

  if (request.headers['content-type'] === 'application/x-www-form-urlencoded') {
    notifier.emit('error', 'Unsupported content type');
    response.writeHead(415);
    response.end();
    request.destroy();
    return;
  }

  request.setEncoding('utf8');

  let body = '';
  request.on('data', function onData (chunk) {
    body += chunk;

    if (body.length > MAX_BODY_LENGTH) {
      body = '';
      // SECURITY: Prevent crash/DOS through OOM by limiting the body buffer we receive.
      //
      // If you need to raise this, remember to also raise Nginx client_max_body_size.
      //
      // HTTP 413 Payload Too Large
      response.writeHead(413);
      response.end();

      request.off('data', onData);
      request.destroy();
    }
  });

  request.on('end', function onEnd () {
    // Accept the request and close the connection
    //
    // SECURITY: We decide on and close the response regardless of,
    // and prior to, any secret-based signature validation, so as to not
    // expose details about the outcome or timing of it to external clients.
    response.writeHead(202);
    response.end();

    notifier.process(request, body);
  });
};

Notifier.prototype.process = function (req, payload) {
  const secret = this.webhookSecret;
  if (!secret && !this.allowInsecure) {
    // SECURITY: Fail closed. Ignore events if server started without secret unless --insecure set.
    // Server should have refused to start, double check here just in case.
    this.emit('error', 'Missing a secret while --insecure not set.');
    return;
  }

  if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expected = Buffer.from('sha256=' + hmac.digest('hex'));
    const actual = Buffer.from(req.headers['x-hub-signature-256'] || '');
    if (actual.length !== expected.length) {
      // Invalid signature, discard misformatted signature
      // that can't be compared with timingSafeEqual()
      return;
    }
    if (!crypto.timingSafeEqual(actual, expected)) {
      // Invalid signature, discard unauthorized event
      return;
    }
  }

  const eventType = req.headers['x-github-event'];
  // Ignore ping events that are sent when a new webhook is created
  if (eventType === 'ping') {
    return;
  }

  // Delay parsing until after signature validation to reduce impact of large payloads
  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    // Invalid data, stop processing
    this.emit('error', e);
    return;
  }

  const processor = this.processors[eventType] || this.processors._default;
  const processed = processor(data);
  const event = {
    // Handle common properties
    owner: data.repository.owner.login,
    repo: data.repository.name,
    type: eventType,

    ...processed.event
  };

  // Emit event rooted on the owner/repo
  let eventName = event.owner + '/' + event.repo + '/' + event.type;
  if (processed.postfix) {
    eventName += '/' + processed.postfix;
  }
  this.emit(eventName, event);
};

Notifier.prototype.processors = {};

Notifier.prototype.processors._default = function (data) {
  return {
    event: {}
  };
};

Notifier.prototype.processors.push = function (data) {
  const event = {
    commit: data.after
  };
  let postfix = null;

  if (/^refs\/(heads|tags)\//.test(data.ref)) {
    postfix = data.ref.slice(5);

    const refParts = data.ref.split('/');
    const refType = refParts[1];
    // Preserve slashes in namespace-like branch names
    const refDest = refParts.slice(2).join('/');

    if (refType === 'heads') {
      event.branch = refDest;
    } else if (refType === 'tags') {
      event.tag = refDest;
    }
  }

  return {
    postfix: postfix,
    event: event
  };
};

exports.Notifier = Notifier;
