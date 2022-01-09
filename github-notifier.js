const crypto = require('crypto');
const querystring = require('querystring');
const util = require('util');
const EventEmitter2 = require('eventemitter2').EventEmitter2;

function Notifier () {
  EventEmitter2.call(this, {
    wildcard: true,
    delimiter: '/'
  });

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

  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    body += chunk;
  });

  request.on('end', function () {
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
  });
};

Notifier.prototype.process = function (req) {
  const secret = process.env.WEBHOOK_SECRET;
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

  // Handle event-specific processing
  const processor = this.processors[eventType] || this.processors._default;
  const eventInfo = processor(req);
  const event = eventInfo.data;

  // Handle common properties
  const repository = req.data.repository;
  event.type = eventType;
  event.owner = repository.owner.login || repository.owner.name;
  event.repo = repository.name;

  // Emit event rooted on the owner/repo
  let eventName = event.owner + '/' + event.repo + '/' + event.type;
  if (eventInfo.postfix) {
    eventName += '/' + eventInfo.postfix;
  }
  this.emit(eventName, event);
};

Notifier.prototype.processors = {};

Notifier.prototype.processors._default = function (req) {
  return {
    data: {}
  };
};

Notifier.prototype.processors.push = function (req) {
  const raw = req.data;
  const refParts = raw.ref.split('/');
  const type = refParts[1];

  const data = { commit: raw.after };

  if (type === 'heads') {
    // Handle namespaced branches
    data.branch = refParts.slice(2).join('/');
  } else if (type === 'tags') {
    data.tag = refParts[2];
  }

  return {
    postfix: raw.ref.substr(5),
    data: data
  };
};

exports.Notifier = Notifier;
