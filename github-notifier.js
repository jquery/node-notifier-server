const querystring = require('querystring');
const util = require('util');
const EventEmitter2 = require('eventemitter2').EventEmitter2;

function xHeader (str) {
  str = str.substring(2);

  return str.replace(/-([a-z])/gi, function (all, letter) {
    return letter.toUpperCase();
  });
}

function Notifier () {
  EventEmitter2.call(this, {
    wildcard: true,
    delimiter: '/'
  });

  this.handler = this.handler.bind(this);
}
util.inherits(Notifier, EventEmitter2);

Notifier.prototype.handler = function (request, response) {
  const notifier = this;
  let data = '';
  const headers = {};

  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    data += chunk;
  });

  request.on('end', function () {
    try {
      if (request.headers['content-type'] === 'application/x-www-form-urlencoded') {
        data = querystring.parse(data);
        data = data.payload;
      }
      data = JSON.parse(data);
    } catch (error) {
      // Invalid data, stop processing
      response.writeHead(400);
      response.end();
      notifier.emit('error', error);
      return;
    }

    // Accept the request and close the connection
    response.writeHead(202);
    response.end();

    // Parse the headers
    Object.keys(request.headers).forEach(function (header) {
      if (/^x-/.test(header)) {
        headers[xHeader(header)] = request.headers[header];
      }
    });

    notifier.process({
      data: data,
      headers: headers
    });
  });
};

Notifier.prototype.process = function (payload) {
  const eventType = payload.headers.githubEvent;

  // Ignore ping events that are sent when a new webhook is created
  if (eventType === 'ping') {
    return;
  }

  // Handle event-specific processing
  const processor = this.processors[eventType] || this.processors._default;
  const eventInfo = processor(payload);
  const event = eventInfo.data;

  // Handle common properties
  const repository = payload.data.repository;
  event.type = eventType;
  event.owner = repository.owner.login || repository.owner.name;
  event.repo = repository.name;
  event.payload = payload.data;

  // Emit event rooted on the owner/repo
  let eventName = event.owner + '/' + event.repo + '/' + event.type;
  if (eventInfo.postfix) {
    eventName += '/' + eventInfo.postfix;
  }
  this.emit(eventName, event);
};

Notifier.prototype.processors = {};

Notifier.prototype.processors._default = function (payload) {
  return {
    data: {}
  };
};

Notifier.prototype.processors.pull_request = function (payload) {
  const pullRequest = payload.data.pull_request;
  const base = pullRequest.base.sha;
  const head = pullRequest.head.sha;

  return {
    data: {
      pr: payload.data.number,
      base: base,
      head: head,
      range: base + '..' + head
    }
  };
};

Notifier.prototype.processors.push = function (payload) {
  const raw = payload.data;
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
