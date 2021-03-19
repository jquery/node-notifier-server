Each `.js` file in the `notifier.d/` directory should export a function that takes a notify `server` object, and a callback function to call when it wants to execute the shell file of the same name.

Examples:

## foo.js
```javascript
module.exports = function( server, exec ) {
  server.on( "jquery/some-service/push/heads/main", exec );
};
```

## foo.sh
```shell
#!/bin/bash
cd /var/lib/some-service
git fetch origin
echo "Checking out $1"
git checkout --force $1
npm ci
nohup /etc/init.d/some-service restart &
```
