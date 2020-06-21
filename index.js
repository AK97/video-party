//// Setup ////

var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var fs = require('fs');
var session = require('express-session');
var siofu = require("socketio-file-upload");
// var fileUpload = require('express-fileupload');
const YouTube = require('simple-youtube-api');
const youtube = new YouTube('AIzaSyA_oVYr4MflQ9GLEEMiAl-jsTZ9Xd6_8m8');

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
function generateID() {
    return (
		Math.random().toString(36).substr(2, 8)
	);
}

function getYouTubeVideoTitle(video_url_id) {
    let vid = 'https://www.youtube.com/watch?' + video_url_id;
    youtube.getVideo(vid)
    .then(video => {
        console.log(video.title);
        return video.title;
    })
    .catch(console.log);
}

class QueueItem {
    constructor(type, link, title, added_by, added_in) {
        this.type = type;
        this.filepath = link; //for uploads this is path. for links this is a video id
        this.title = title;
        this.added_by = added_by;
        //this.nowPlaying = false;
        //added_in is the code for the party this QI is in
        switch(type) {
            case 'mp4 video':
                this.typeLabel = 'video/mp4';
                this.url = 'video' + added_in + generatePartyCode();
                this.thumbnail = 'mp4thumb.png'
                break;
            case 'Youtube video':
                this.typeLabel = 'video/youtube';
                this.url = 'https://www.youtube.com/watch?'+link;
                this.thumbnail = 'https://img.youtube.com/vi/'+link.substr(2)+'/0.jpg'
                break;
            default:
                this.typeLabel = '';
                break;
        }
    }
    info() {
        return [this.typeLabel, this.url];
    }
}

class Party {
    constructor(host) {
        this.host = host; //host's session ID
        this.code = generatePartyCode();
        this.members = {}; //store members by socketid:username because nicknames aren't important enough to track accross refreshes. allowing people to rename themself is okay.
        this.message_log = []; //complete message history
        this.message_log.push('Invite friends using the party code!');
        this.message_log.push('Party Code: ' + this.code);
        this.currentStatus = [0,true];
        this.queue = [];
        this.callCode = generatePartyCode(); //socket room for video call
        this.inCall = {}; //users in the call {vchat_id:socket}
    }
    playNow(queue_item) {
        this.nowPlaying = queue_item;
    }
}

//// Database ////

var parties = {
    'vptestr1':new Party(),
    'vptestr2':new Party()
}; //contains all active rooms as partyid:Party

//// Express Functions ////

app.use('/styles',express.static(__dirname + '/styles')); //provide client with (static) stylesheets
app.use('/images',express.static(__dirname + '/images')); //provide client with (static) images (contains favicon)

// app.use(fileUpload());

sessionDef = session({
	secret: 'secret-key', //apparently this should be some actual secret string. not sure why but eventually we can make it something random.
	saveUninitialized: true,
	resave: true,
});

app.use(sessionDef);

app.get('/', (req, res) => {
    console.log('A user is attempting to connect to the homepage')
    res.sendFile(__dirname + '/index.html');
});

app.get('/vp*', (req, res) => {
    let attempt = req.path.substr(1);
    console.log('A user is attempting to connect to: ' + attempt);
    if (Object.keys(parties).includes(attempt)) {
        console.log('Connection attempt valid, redirecting...');
        req.session.roomToConnect = attempt;
        res.sendFile(__dirname + '/party.html');
    }
    else {
        console.log('Connection attempt invalid.');
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
    console.log('Request made for ', path);

    //forcing every video to have a unique url might prevent cookie issues in browser
    let attempt = req.path.substr(6,8); //just partycode
    let vidcode = req.path.substr(14); //just videocode

    var path = parties[attempt].nowPlaying.filepath;
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
    console.log('User connected to homepage [session id]: ' + socket.request.session.id);

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
        console.log('New party created: ', party.code, '; redirecting user...');
        socket.emit('go to party', party.code);
        //check if the custom party code is already in use
        // else {
        //     socket.emit('create error', 'Sorry, that party code is taken');
        // }
    });

    socket.on('disconnect', () => {
        // console.log('user disconnected with id ' + socket.request.session.id);
        // not sure why i should care
    });
});

partysocket.on('connection', (socket) => {
    let attemptedConnect = socket.handshake.headers.referer.toString(); //finding the room idd
    let roomToConnect = attemptedConnect.split('/').pop().substr(0,8);
    console.log('A user has connected to party page: ', socket.handshake.headers.referer, ', parsed as ', roomToConnect);
    console.log('[session id]: ' + socket.request.session.id);
    console.log('[socket id]: ' + socket.id);
    socket.vchat_id = generateID(); //assign a vchat_id to the user.
                                    //eventually used as DOM elem id's, so removing some of the characters that socket normally puts in id's.
    //join chat room
    socket.join(roomToConnect);
    if (parties[roomToConnect]) {
        parties[roomToConnect].members[socket.id] = "Anonymous";
        socket.emit('messagePopulate', parties[roomToConnect].message_log); //give joiner complete message history
        partysocket.in(roomToConnect).emit('userPopulate', (parties[roomToConnect].members)); //update everyone in the room's userlist
        socket.emit('queue update', parties[roomToConnect].queue); //give joiner queue
        if (parties[roomToConnect].nowPlaying) { //if there's something playing...
            console.log('Providing connector with info: ', parties[roomToConnect].nowPlaying.info());
            socket.emit('start playing', parties[roomToConnect].nowPlaying.info()); //load up currently playing video
            socket.emit('statusUpdate', parties[roomToConnect].currentStatus); //catchup the joiner to position in video
        }
    }
    
    var uploader = new siofu();
    uploader.dir = 'media';
    uploader.listen(socket);

    uploader.on("start", (event) => {
        console.log('Starting file upload from [socket id]: ' + socket.id + ' in ' + roomToConnect)
    });
    
    uploader.on("saved", function(event){
        //a file has been uploaded. add it to queue
        console.log('File finished uploading from [socket id]: ' + socket.id + ' in ' + roomToConnect)
        console.log(event)
        socket.emit('upload success', event.file.name+' has been added to the library')
        parties[roomToConnect].queue.push(new QueueItem('mp4 video', event.file.pathName, event.file.name, parties[roomToConnect].members[socket.id], roomToConnect));
        //refresh everyone's queues
        partysocket.in(roomToConnect).emit('queue update', parties[roomToConnect].queue);
    });

    uploader.on("error", function(event){
        console.log('Upload error from [socket id]: ', socket.id, event);
    });

    socket.on('link add', (link) => {
        if (parties[roomToConnect]) { //make sure room still exists, as always..
            //check if it's a youtube link
            if (link.toUpperCase().includes('YOUTUBE') || link.toUpperCase().includes('YOUTU.BE')) {
                //get the unique youtube video id
                let youtube_url = link.match(/(?:\/|%3D|v=|vi=)([0-9A-z-_]{11})(?:[%#?&]|$)/gm);
                if (youtube_url) {
                    socket.emit('link success');
                    console.log('Youtube Video added to library by [socket id]:, ', socket.id, ' ', youtube_url[0]);
                    youtube.getVideo('https://www.youtube.com/watch?' + youtube_url[0]) //get the title from youtube
                        .then(video => { //once we've gotten the title we can add this to the queue
                            console.log('Added YT vid has title: ', video.title);
                            parties[roomToConnect].queue.push(new QueueItem('Youtube video', youtube_url[0], video.title, parties[roomToConnect].members[socket.id], roomToConnect));
                            partysocket.in(roomToConnect).emit('queue update', parties[roomToConnect].queue);
                        })
                }
                else {
                    console.log('Invalid (YT) Link Error: ', link, ' parsed as ', youtube_url);
                    socket.emit('link error', 'This does not appear to be a valid youtube link.');
                }
            }
            else {
                console.log('Invalid (non-YT) Link Error: ', link;
                socket.emit('link error', 'Sorry. Only YouTube videos are supported at this time.');
            }
        }
    });
    socket.on('play request', (q) => {
        console.log('Play requested by [socket id]: ', socket.id, '; ', parties[roomToConnect].queue[q].typeLabel);
        if (parties[roomToConnect].queue[q].typeLabel == 'video/mp4' || parties[roomToConnect].queue[q].typeLabel == 'video/youtube') {
            parties[roomToConnect].playNow(parties[roomToConnect].queue[q]);
            console.log(parties[roomToConnect].nowPlaying.info());
            partysocket.in(roomToConnect).emit('start playing', parties[roomToConnect].nowPlaying.info());
        }
        console.log(parties[roomToConnect].nowPlaying.filepath);
    });
    socket.on('actionPerform', (videoStatus) => {
        parties[roomToConnect].currentStatus = videoStatus;
        console.log('User ' + socket.id + ' changed video status to ' + videoStatus);
        socket.to(roomToConnect).emit('statusUpdate', videoStatus);
    });
    socket.on('name set', (nick) => {
        console.log('User ' + socket.id + ' sets name to ' + nick);
        parties[roomToConnect].members[socket.id] = nick;
        partysocket.in(roomToConnect).emit('userPopulate', (parties[roomToConnect].members)); //update everyone in the room's userlist
    });
    socket.on('chat sent', (msg) => {
        if (msg.trim().length !== 0) {
            console.log('Message has been sent by ' + socket.id);
            formatted_msg = currentTime() + parties[roomToConnect].members[socket.id] + ': ' + msg;
            parties[roomToConnect].message_log.push(formatted_msg);
            partysocket.to(roomToConnect).emit('chat dist', formatted_msg); //send message to everyone except sender
        }
    });

    // VIDEO CHAT
    socket.on('join video call', (data, acknowledge) => {
        console.log('User is joining the video call ', roomToConnect, ' [socket id]: ' + socket.id);
        socket.join(parties[roomToConnect].callCode); //socket room for party's video chatters
        partysocket.to(parties[roomToConnect].callCode).emit('add peer', {'id':socket.id, 'name':parties[roomToConnect].members[socket.id], 'vchat_id':socket.vchat_id, 'offerer':true});
        //let currently_in_call = parties[roomToConnect].inCall; //list of sockets already in the call
        for (var p in parties[roomToConnect].inCall) {
            socket.emit('add peer', {'id':parties[roomToConnect].inCall[p].id, 'name':parties[roomToConnect].members[parties[roomToConnect].inCall[p].id], 'vchat_id':p, 'offerer':false});
        }
        parties[roomToConnect].inCall[socket.vchat_id] = socket;
        socket.emit('remove peer', {peer_id:socket.id, vchat_id:socket.vchat_id}); //tell joiner to remove themself. this removes the remotebox which is created unecessarily for themself in DOM.
        console.log('The call now has ', Object.keys(parties[roomToConnect].inCall).length, ' members');
        acknowledge();
    });
    socket.on('ping ice', (config) => {
        //config contains peer_id and ice_candidate
        //send ice candidate to the original caller
        partysocket.to(config.peer_id).emit('pong ice',{'peer_id': socket.id, 'ice_candidate': config.ice_candidate, 'vchat_id':socket.vchat_id});
    })
    socket.on('session description req', (config) => {
        partysocket.to(config.peer_id).emit('session description', {'peer_id': socket.id, 'session_description': config.session_description, 'vchat_id':socket.vchat_id});
    })
    socket.on('leave vchat', (data, acknowledge) => {
        delete parties[roomToConnect].inCall[socket.vchat_id]; //remove from list of users in video call
        console.log('User is leaving the video call ', roomToConnect, ' [socket id]: ' + socket.id);
        console.log('The call now has ', Object.keys(parties[roomToConnect].inCall).length, ' members');
        partysocket.to(parties[roomToConnect].callCode).emit('remove peer', {peer_id:socket.id, vchat_id:socket.vchat_id}); //tell everyone to disconnect from leaver
        for (p in parties[roomToConnect].inCall) {
            socket.emit('remove peer', {'peer_id':parties[roomToConnect].inCall[p].id, 'vchat_id':p});
        }
        acknowledge();
    });
    socket.on('disconnect', () => {
        console.log('User disconnected from party page ', roomToConnect, ' [socket id]: ' + socket.id);
        if (parties[roomToConnect]) { //if room still exists..
            delete parties[roomToConnect].members[socket.id]; //remove from list of users currently here
            delete parties[roomToConnect].inCall[socket.vchat_id]; //remove from list of users in video call
            partysocket.to(parties[roomToConnect].callCode).emit('remove peer', {peer_id:socket.id, vchat_id:socket.vchat_id}); //disconnect from anybody in video call
            partysocket.to(roomToConnect).emit('userPopulate', (parties[roomToConnect].members)); //update everyone in the room's userlist
        }
    })
});

http.listen(port, () => {
    console.log('listening on *:'+port);
});