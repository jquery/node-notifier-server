[![Build Status](https://github.com/jquery/node-notifier-server/actions/workflows/CI.yaml/badge.svg)](https://github.com/jquery/node-notifier-server/actions/workflows/CI.yaml)
[![Tested with QUnit](https://img.shields.io/badge/tested_with-qunit-9c3493.svg)](https://qunitjs.com/)

# node-notifier-server

Each subscriber `.js` file in the `notifier.d/` directory should export a function that takes a notify `notifier` object, and an `exec` callback to call the shell script of the same name should be executed.

## Examples

### foo.js

```javascript
module.exports = function (notifier, exec) {
  notifier.on('repo-owner/repo-name/push/heads/main', exec);
};
```

### foo.sh

```shell
#!/bin/bash
cd /var/lib/some-service
git fetch origin
echo "Checking out $1"
git checkout --force "$1"
npm ci
nohup /etc/init.d/some-service restart &
```

## API

## Content type

Use of the `application/json` content type is required.

Support for the `application/x-www-form-urlencoded` format was removed in node-notifier 4.0.0 as a security hardening measure.

### `WEBHOOK_SECRET` environment variable

When operating a public notifier server, it is recommended to only use [secure webhooks](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks). To enable these, set the `WEBHOOK_SECRET` environment variable on your server, and configure your source of webhooks (e.g. GitHub.com) to use these to add signatures to delivered events.

When the `WEBHOOK_SECRET` environment variable is set, any received events that do not carry a valid signature are ignored.

The secret can alternatively be configured via a `config.json` file in this directory, shaped as follows:

```json
{
  "webhookSecret": ""
}
```

### `notifier.on(eventPath, callback)`

Parameters:
* `eventPath {string}`: Slash-separated string containing 4 segments:
  - repo owner,
  - repo name,
  - webhook event type,
  - webhook event ref (this may contain additional slashes)

  For example, `jquery/api.jquery.com/push/heads/main` would subscribe to the https://github.com/jquery/api.jquery.com repository, for a "push" event, with reference `refs/heads/main`.

  You can use a wildcard within the string to listen for many possible references.
  This is especially useful when subscribing for tags.
  For example, `example/test/push/tags/*` would listen for any tags, and `example/test/push/heads/*` would listen for any branches.

* `callback {Function}`

  Called after a matching webhook is received, and passed a `data` parameter.

* `callback.data {Object}`:
  For all events:
  - `owner {string}`: repo owner.
  - `repo {string}`: repo name.
  - `type {string}`: webhook event type.

  For "push" events:
  - `commit {string}`: The head SHA1 of the pushed commit reference.
  - `branch {string|undefined}`: The branch name, if a branch was pushed.
  - `tag {string|undefined}`: The tag name, if a tag was pushed.

### `subscriber(notifier, exec)`

This is the interface that exported subscriber scripts in the `notifier.d/` directory should follow.

It is called once, when the server initially starts up.

Parameters:

* `notifier {Notifier}`

* `exec {Function}`: This is a preset callback to use with `notifier.on()`, for the common use case of invoking a shell script after a "push" event. It will run a shell script by the name of `<basename>.sh` in the same directory (e.g. `foo.sh` for a `foo.js` subscriber), and pass it one shell argument: `data.commit` (the SHA1 of the pushed reference).
