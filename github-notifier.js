const crypto = require('crypto');
const querystring = require('querystring');
const util = require('util');
const EventEmitter2 = require('eventemitter2').EventEmitter2;

// As of Jan 2022, a typical push event with 1 commit sends 15 KB of JSON.
const MAX_BODY_LENGTH = 200 * 1000; // 200 KB

function Notifier (config = {}) {
  EventEmitter2.call(this, {
    wildcard: true,
    delimiter: '/'
  });

  this.webhookSecret = config.webhookSecret || '';

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

  let body = '';
  function onData (chunk) {
    body += chunk;

    if (body.length > MAX_BODY_LENGTH) {
      notifier.emit('error', 'Payload too large');

      response.writeHead(413); // HTTP 413 Payload Too Large
      response.end();

      request.off('data', onData);
      request.off('end', onEnd);
      request.destroy();
    }
  }

  function onEnd () {
    let payload;
    let data;
    try {
      if (request.headers['content-type'] === 'application/x-www-form-urlencoded') {
        payload = querystring.parse(body).payload;
      } else {
        payload = body;
      }
      data = JSON.parse(payload);
    } catch (error) {
      // Invalid data, stop processing
      response.writeHead(400);
      response.end();
      notifier.emit('error', error);
      return;
    }

    // Accept the request and close the connection
    // SECURITY: We decide on and close the response regardless of,
    // and prior to, any secret-based signature validation, so as to not
    // expose details about this to external clients.
    response.writeHead(202);
    response.end();

    notifier.process({
      payload: payload,
      data: data,
      headers: request.headers
    });
  }

  request.setEncoding('utf8');
  request.on('data', onData);
  request.on('end', onEnd);
};

Notifier.prototype.process = function (req) {
  const secret = this.webhookSecret;
  if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(req.payload);
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

  const processor = this.processors[eventType] || this.processors._default;
  const processed = processor(req);
  const event = {
    // Handle common properties
    owner: req.data.repository.owner.login,
    repo: req.data.repository.name,
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

Notifier.prototype.processors._default = function (req) {
  return {
    event: {}
  };
};

Notifier.prototype.processors.push = function (req) {
  const event = {
    commit: req.data.after
  };
  let postfix = null;

  if (/^refs\/(heads|tags)\//.test(req.data.ref)) {
    postfix = req.data.ref.slice(5);

    const refParts = req.data.ref.split('/');
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
