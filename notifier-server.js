var mailer,
	root = require( "path" ).dirname( __filename ),
	directory = root + "/notifier.d",
	os = require( "os" ),
	opts = require( "optimist" )
		.usage( "Start a server to listen for github post receives and execute scripts from a directory\n\t$0" )
		.options( "p", {
			alias: "port",
			"default": 3333,
			describe: "Port number for server"
		})
		.options( "d", {
			alias: "directory",
			"default": directory
		})
		.boolean( "debug" )
		.describe( "debug", "Enable Debug" ),
	argv = opts.argv,
	port = argv.p,
	http = require( "http" ),
	Notifier = require( "git-notifier" ).Notifier,
	notifier = new Notifier(),
	server = http.createServer(),
	fs = require( "fs" ),
	proc = require( "child_process" );
var debug = require( "debug" );
var async = require( "async" );

debug.enable( "notifier-server:error" );

if (argv.debug) {
	debug.enable( "notifier-server:*" );
}

var error = debug( "notifier-server:error" );

var log = debug( "notifier-server:server" ),
	invalidSHA = /[^0-9a-f]/;

if ( fs.existsSync( "./mail-config.json" ) ) {
	log( "Loading E-Mail Component" );
	mailer = require( "./notify-mail.js" );
} else {
	// without mail config, mailer is a noop
	mailer = function() {};
}

directory = argv.d;

if ( argv.h ) {
	console.log( opts.help() );
	process.exit();
}

function makeExec( filename ) {
	var log = debug( "notifier-server:script:" + filename );
	var queue = async.queue(function spawn(eventData, callback) {
		var commit = eventData.commit;
		log( "spawn", commit );
		var output = "",
			exit = -1,
			started = Date.now();

		var process = proc.spawn( directory + "/" + filename, [ commit ] );
		process.stdout.on( "data", function( data ) {
			output += data;
			doLog( "out", data );
		});
		process.stderr.on( "data", function( data ) {
			output += data;
			doLog( "err", data );
		});
		process.on( "exit", function( code ) {
			exit = code;
			log( "exit", code );
		});
		process.on( "close", function() {
			var subject = os.hostname() + ": ";
			if (exit) {
				subject += "FAILED ";
			}
			subject += "Deployment: " + filename + " " + commit + " " + ((Date.now() - started)/1000).toFixed(0) + "s";
			mailer( subject, output + "\nExit Code: " + exit );
			callback( null, {
				subject: subject,
				filename: filename,
				eventData: eventData,
				output: output,
				exit: exit,
				time: Date.now() - started,
				started: started
			});
		});
	});

	queue.drain = function() { log( "done" ); };

	function doLog( prefix, text ) {
		var parts = ("" + text).split(/\n/);
		parts.forEach(function( line ) {
			if ( line.length ) {
				log( prefix, line );
			}
		});
	}

	return function( data, callback ) {
		if ( invalidSHA.test( data.commit ) ) {
			log( "Bad Request", data );
			return;
		}

		log( "queue", data.commit );
		if (callback) {
			queue.push( data, callback );
		} else {
			queue.push( data );
		}
	};
}

fs.readdirSync( directory ).forEach( function( file ) {
	if ( !/\.js$/.exec( file ) ) {
		return;
	}
	log( "Including " + directory + "/" + file );
	var js = directory + "/" + file,
		sh = file.replace( /\.js$/, ".sh" );
	require( js )( notifier, makeExec( sh ) );
});

server.on( "request", notifier.handler );
server.on( "error", error );
notifier.on( "error", error );

log( "Setting up post-receive server on port " + port );
server.listen( port );
