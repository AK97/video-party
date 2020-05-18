//// Setup ////

var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var fs = require('fs');

var port = 69;

//// Helper Functions ////

function currentTime() { //returns current time in "[HH:MM] " 24hr format (string)
  var d = new Date();
  return '['+d.toTimeString().substr(0,5)+'] ';
}

//// Global Vars & Data ////

var currentStatus = [0, true];
var nicknames = {};
var all_messages = []; //there needs to be some kind of room instantiation for this to make sense in the future

//// Express Functions ////

app.use('/styles',express.static(__dirname + '/styles')); //provide client with (static) stylesheets

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/party.html'); //send party.html when homepage is requested
  //this will change to index html once index is built to be a room creating page
});

app.get('/video', (req, res) => { //upon request for /video...
  var path = 'media/movie.mp4';
  var fileSize = fs.statSync(path).size; //get the size of the video
  var range = req.headers.range;
  console.log(req.headers);
  if (range) {
    //the range property is as a string="bytes=0-" where 0 corresponds to which part of the video is being requested
  	var parts = range.replace(/bytes=/, "").split("-"); //string of number that tells which byte to start loading at
  	var start = parseInt(parts[0], 10); //convert string to int (base 10)
  	var end = fileSize-1;
  	var chunkSize = (end-start)+1;
    var head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      }
    res.writeHead(206, head);
    fs.createReadStream(path, {start,end}).pipe(res);
  }
  else { //starts here first time
    var head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(200, head)
    fs.createReadStream(path).pipe(res) //open the video file as a readable stream then "pipe" it to the response object (which goes to the client)
  }
});

//// Socket Functions ////

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



http.listen(port, () => {
  console.log('listening on *:'+port);
});