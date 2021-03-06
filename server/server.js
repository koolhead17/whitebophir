var app = require('http').createServer(handler)
	, sockets = require('./sockets.js')
	, path = require('path')
	, url = require('url')
	, nodestatic = require("node-static")
	, createSVG = require("./createSVG.js");


var io = sockets.start(app);

/**
 * Folder from which static files will be served
 * @const
 * @type {string}
 */
var WEBROOT = path.join(__dirname, "../client-data");

/**
 * Port on which the application will listen
 * @const
 * @type {number}
 */
var PORT = parseInt(process.env['PORT']) || 8080;

app.listen(PORT);
console.log("Server listening on " + PORT);

var CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

var fileserver = new nodestatic.Server(WEBROOT, {
	"headers": {
		"X-UA-Compatible": "IE=Edge",
		"Content-Security-Policy": CSP,
	}
});

function serveError(request, response, err) {
	console.warn("Error serving '" + request.url + "' : " + err.status + " " + err.message);
	fileserver.serveFile('error.html', err.status, {}, request, response);
}

function logRequest(request) {
	console.log(JSON.stringify({
		event: 'connection',
		ip: request.connection.remoteAddress,
		original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
		user_agent: request.headers['user-agent'],
		referer: request.headers['referer'],
		url: request.url
	}));
}

function handler(request, response) {
	try {
		handleRequest(request, response);
	} catch (err) {
		console.trace(err);
		response.writeHead(500, { 'Content-Type': 'text/plain' });
		response.end(err.toString());
	}
}

function handleRequest(request, response) {
	var parsedUrl = url.parse(request.url, true);
	var parts = parsedUrl.pathname.split('/');
	if (parts[0] === '') parts.shift();

	if (parts.length === 0) {
		fileserver.serveFile("index.html", 200, {}, request, response);
	} else if (parts[0] === "boards") {
		// "boards" refers to the root directory
		if (parts.length === 1 && parsedUrl.query.board) {
			// '/boards?board=...' This allows html forms to point to boards
			var headers = { Location: 'boards/' + encodeURIComponent(parsedUrl.query.board) };
			response.writeHead(301, headers);
			response.end();
		} else if (parts.length === 2 && request.url.indexOf('.') === -1) {
			// If there is no dot and no directory, parts[1] is the board name
			fileserver.serveFile("board.html", 200, {}, request, response);
			logRequest(request);
		} else { // Else, it's a resource
			request.url = "/" + parts.slice(1).join('/');
			fileserver.serve(request, response, function (err, res) {
				if (err) serveError(request, response, err);
			});
		}
	} else if (parts[0] === "download") {
		var boardName = encodeURIComponent(parts[1]),
			history_file = "../server-data/board-" + boardName + ".json",
			headers = {
				"Content-Type": "application/json",
				"Content-Disposition": 'attachment; filename="' + boardName + '.wbo"'
			};
		var promise = fileserver.serveFile(history_file, 200, headers, request, response);
		promise.on("error", function (err) {
			console.error("Error while downloading history", err);
			response.statusCode = 404;
			response.end("ERROR: Unable to serve history file\n");
		});
	} else if (parts[0] === "preview") {
		var boardName = encodeURIComponent(parts[1]),
			history_file = path.join(__dirname, "..", "server-data", "board-" + boardName + ".json");
		createSVG.renderBoard(history_file, function (err, svg) {
			if (err) {
				response.writeHead(404, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify(err));
			}
			response.writeHead(200, {
				"Content-Type": "image/svg+xml",
				"Content-Security-Policy": CSP,
			});
			response.end(svg);
		});
	} else {
		fileserver.serve(request, response, function (err, res) {
			if (err) serveError(request, response, err);
		});
	}
}


