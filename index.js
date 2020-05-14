var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var fs = require('fs');

var Log = require('log');
var log = new Log('info');

var port = 69;

function currentTime() { //returns current time in "[HH:MM] " 24hr format (string)
  var d = new Date();
  return '['+d.toTimeString().substr(0,5)+'] ';
}

var currentStatus = [0, true];

var nicknames = {};

var all_messages = []; //there needs to be some kind of room instantiation for this to make sense in the future

app.use('/styles',express.static(__dirname + '/styles')); //provide client with (static) stylesheets

io.on('connection', (socket) => {
	console.log('user joined with ID ' + socket.id)
  nicknames[socket.id] = "Anonymous";
  socket.emit('messagePopulate', all_messages); //give joiner complete message history
	socket.emit('statusUpdate', currentStatus); //catchup the joiner to position in video
	socket.on('actionPerform', (videoStatus) => {
		currentStatus = videoStatus;
		console.log('user ' + socket.id + ' changed video status to ' + videoStatus);
		io.emit('statusUpdate', currentStatus);
	});
  socket.on('name set', (nick) => {
    console.log('user ' +socket.id+ ' sets name to ' + nick); //print the chat message event
    nicknames[socket.id] = nick;
  });
  socket.on('chat sent', (msg) => {
    if (msg.trim().length !== 0) {
      console.log('message send by ' + socket.id + ': ' + msg); //print the chat message event
      formatted_msg = currentTime() + nicknames[socket.id] + ': ' + msg;
      all_messages.push(formatted_msg);
      io.emit('chat dist', formatted_msg); //send message to everyone including sender
    }
  });
	socket.on('disconnect', () => {
		console.log('user disconnected with id ' + socket.id);
	})
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/video', (req, res) => { //upon request for /video...
  var path = 'media/movie.mp4';
  var stat = fs.statSync(path);
  var fileSize = stat.size; //get the size of the video
  var range = req.headers.range;
  if (range) {
  	var parts = range.replace(/bytes=/, "").split("-");
  	var start = parseInt(parts[0], 10);
  	var end = parts[1]
  		? parseInt(parts[1], 10)
  		: fileSize-1;
  	var chunkSize = (end-start)+1;
  	var file = fs.createReadStream(path, {start,end});
	var head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(206, head);
    file.pipe(res);
  	}
  	else { //starts here first time
    	var head = {
      	'Content-Length': fileSize,
      	'Content-Type': 'video/mp4',
    } //establish head
    res.writeHead(200, head)
    fs.createReadStream(path).pipe(res)
  }
});

http.listen(port, () => {
  console.log('listening on *:'+port);
});