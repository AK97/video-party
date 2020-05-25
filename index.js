//// Setup ////

var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var fs = require('fs');
var session = require('express-session');
var siofu = require("socketio-file-upload");
// var fileUpload = require('express-fileupload');
var favicon = require('serve-favicon');


const url = 'localhost:69/';
var port = process.env.PORT || 69;

//// Helper Functions & Classes ////

function currentTime() { //returns current time in "[HH:MM] " 24hr format (string)
    var d = new Date();
    return '['+d.toTimeString().substr(0,5)+'] ';
}

function generatePartyCode() {
	return (
		'vp' + Math.random().toString(36).substr(2, 6)
	);
}

class QueueItem {
    constructor(type, link, title, added_by) {
        this.type = type;
        this.link = link;
        this.title = title;
        this.added_by = added_by;
        this.urlcode = generatePartyCode();
        this.nowPlaying = false;

        switch(type) {
            case 'mp4 video':
                this.typeLabel = 'video/mp4';
                break;
            case 'Youtube video':
                this.typeLabel = 'youtube'; //TO BE CHANGED
                break;
            default:
                this.typeLabel = '';
                break;
        }
    }
}

class Party {
    constructor(host) {
        this.host = host; //host's session ID
        this.filepath = '';
        this.code = generatePartyCode();
        this.members = {}; //store members by socketid:username because nicknames aren't important enough to track accross refreshes. allowing people to rename themself is okay.
        this.message_log = []; //complete message history
        this.message_log.push('Invite friends using the party code!');
        this.message_log.push('Party Code: ' + this.code);
        this.currentStatus = [0,true];
        this.queue = [];
    }
    playNow(filepath, nowPlaying) {
        this.filepath = filepath;
        this.nowPlaying = nowPlaying;
    }
}

//// Database ////

var parties = {
    'vptestr1':new Party(),
    'vptestr2':new Party()
}; //contains all active rooms as partyid:Party

//// Express Functions ////

app.use('/styles',express.static(__dirname + '/styles')); //provide client with (static) stylesheets
app.use(favicon(__dirname + '/images/favicon.ico')); //serve favicon

// app.use(fileUpload());

sessionDef = session({
	secret: 'secret-key', //apparently this should be some actual secret string. not sure why but eventually we can make it something random.
	saveUninitialized: true,
	resave: true,
});

app.use(sessionDef);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
    
});

app.get('/vp*', (req, res) => {
    let attempt = req.path.substr(1);
    if (Object.keys(parties).includes(attempt)) {
        res.sendFile(__dirname + '/party.html');
    }
    else {
        res.send('Sorry, this party does not exist');
    }
});

app.use(siofu.router);

// app.post('/upload', function(req, res) {
//     let uploadedFile = req.files.forUpload; // the uploaded file object
//     console.log(uploadedFile);

//     uploadedFile.mv('/media/'+newFileName)

// });

app.get('/video*', (req, res) => { //upon request for /video(partycode)(videocode) -- this will be req'd by a partyroom's video tag
    //forcing every video to have a unique url might prevent cookie issues in browser
    let attempt = req.path.substr(6,8); //just partycode
    let vidcode = req.path.substr(14); //just videocode
    // for (var qi = 0; qi < parties[attempt].queue.length; qi++) {
    //     if (parties[attempt].queue[qi].urlcode == vidcode) {
    //         var path = parties[attempt].filepath;
    //     }
    // }
    var path = parties[attempt].filepath;
    // var path = 'media/movie.mp4';
    var fileSize = fs.statSync(path).size; //get the size of the video
    var range = req.headers.range;
    //console.log(req.headers);
    if (range) {
        //the range property is a string="bytes=0-" where 0 corresponds to which part of the video is being requested
        var parts = range.replace(/bytes=/, "").split("-"); //string of number that tells which byte to start loading at
        var start = parseInt(parts[0], 10); //convert string to int (base 10)
        //var end = fileSize-1; //in bytes; so could be like 1000000 to load 1mb at a time
        const end = parts[1] 
            ? parseInt(parts[1], 10)
            : fileSize-1;
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

var indexsocket = io.of('/indexns'); //clientside: socket = io('/home');
var partysocket = io.of('/partyns'); //this namespace is for all game rooms. each will have its own socket room and role rooms.

//putting the express session into socket context
io.use(function(socket, next) {
	sessionDef(socket.request, socket.request.res || {}, next);
});

indexsocket.on('connection', (socket) => {
    console.log('user reached homepage with session ID' + socket.request.session.id);

    socket.on('join party', (code) => {
        //check if exists then instruct a redirect
        // console.log(parties);
        // console.log(parties[code])
        if (parties[code]) {
            socket.emit('go to party', code)
        }
        else {
            socket.emit('join error', 'Sorry, that is an invalid code');
        }
    });

    socket.on('create party', () => {
        let host = socket.request.session.id;
        let party = new Party(host);
        parties[party.code] = party;
        socket.emit('go to party', party.code);
        //check if the custom party code is already in use
        // else {
        //     socket.emit('create error', 'Sorry, that party code is taken');
        // }
    });

    socket.on('disconnect', () => {
        console.log('user disconnected with id ' + socket.request.session.id);
    });

});

partysocket.on('connection', (socket) => {
    console.log('user reached a party page with socket ID ' + socket.id)
    let attemptedConnect = socket.handshake.headers.referer.toString(); //not for use beyond next line
    let roomToConnect = attemptedConnect.split('/').pop();
    
    //join chat room
    socket.join(roomToConnect);
    if (parties[roomToConnect]) {
        parties[roomToConnect].members[socket.id] = "Anonymous";
        socket.emit('messagePopulate', parties[roomToConnect].message_log); //give joiner complete message history
        partysocket.to(roomToConnect).emit('userPopulate', (Object.values(parties[roomToConnect].members))); //update everyone in the room's userlist
        socket.emit('queue update', parties[roomToConnect].queue); //give joiner queue
        if (parties[roomToConnect].nowPlaying) { //if there's something playing...
            socket.emit('start playing', 'video'+roomToConnect+parties[roomToConnect].nowPlaying); //load up currently playing video
            socket.emit('statusUpdate', parties[roomToConnect].currentStatus); //catchup the joiner to position in video
        }
    }
    
    var uploader = new siofu();
    uploader.dir = 'media';
    uploader.listen(socket);

    uploader.on("start", (event) => {
        console.log('new file upload starting from user with socket id: ' + socket.id + ' in party ' + roomToConnect)
    });
    
    uploader.on("saved", function(event){
        //a file has been uploaded. add it to queue
        console.log(event)
        socket.emit('upload success', event.file.name+' has been added to the library')
        parties[roomToConnect].queue.push(new QueueItem('mp4 video', event.file.pathName, event.file.name, parties[roomToConnect].members[socket.id]));
        //refresh everyone's queues
        partysocket.to(roomToConnect).emit('queue update', parties[roomToConnect].queue);
    });

    uploader.on("error", function(event){
        console.log("Error from uploader", event);
    });

    socket.on('play request', (q) => {
        console.log('player request:')
        console.log(parties[roomToConnect].queue[q].typeLabel)
        if (parties[roomToConnect].queue[q].typeLabel = 'video/mp4') {
            parties[roomToConnect].playNow(parties[roomToConnect].queue[q].link, parties[roomToConnect].queue[q].urlcode);
            partysocket.to(roomToConnect).emit('start playing', 'video'+roomToConnect+parties[roomToConnect].nowPlaying);
        }
        console.log(parties[roomToConnect].filepath);
    });
    socket.on('actionPerform', (videoStatus) => {
        parties[roomToConnect].currentStatus = videoStatus;
        console.log('user ' + socket.id + ' changed video status to ' + videoStatus);
        socket.to(roomToConnect).emit('statusUpdate', videoStatus);
    });
    socket.on('name set', (nick) => {
        console.log('user ' +socket.id+ ' sets name to ' + nick); //print the chat message event
        parties[roomToConnect].members[socket.id] = nick;
        partysocket.to(roomToConnect).emit('userPopulate', (Object.values(parties[roomToConnect].members))); //update everyone in the room's userlist
    });
    socket.on('chat sent', (msg) => {
        if (msg.trim().length !== 0) {
            console.log('message sent by ' + socket.id + ': ' + msg); //print the chat message event
            formatted_msg = currentTime() + parties[roomToConnect].members[socket.id] + ': ' + msg;
            parties[roomToConnect].message_log.push(formatted_msg);
            partysocket.to(roomToConnect).emit('chat dist', formatted_msg); //send message to everyone including sender
        }
    });
    socket.on('disconnect', () => {
        console.log('user disconnected with socket id ' + socket.id);
        if (parties[roomToConnect]) { //if room still exists..
            delete parties[roomToConnect].members[socket.id]; //remove from list of users currently here
            partysocket.to(roomToConnect).emit('userPopulate', (Object.values(parties[roomToConnect].members))); //update everyone in the room's userlist
        }
    })
});

http.listen(port, () => {
    console.log('listening on *:'+port);
});