var express = require('express');
var multer = require('multer');
var mime = require('mime-types');
var bodyParser = require('body-parser');
var Parse = require('parse/node');

var config = require('./config');

var app = express();
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, __dirname + '/public/uploads')
  },
  filename: function (req, file, cb) {
    var extension = mime.extension(file.mimetype);
    var newFileName = file.originalname.replace(/[^a-zA-Z]/g, '').toLowerCase().replace(/\.[^.]*|$/, '.' + extension);
    cb(null, Date.now() + newFileName);
  }
});
var upload = multer({ storage });
var singleUpload = upload.single('picture');
var jsonParser = bodyParser.json();

var Entry = Parse.Object.extend("Entry");

Parse.initialize(config.parseAppID, config.parseKey);

app.use(express.static(__dirname + '/public'))

app.post('/api/1.0/upload', singleUpload, function (req, res) {
  var file = req.file;
  var entry = new Entry();
  console.log(file);
  entry.save({
    upvotes: 0,
    downvotes: 0,
    pictures: [ 'uploads/' + file.filename ],
    description: req.body.description,
    location: new Parse.GeoPoint(+req.body.latitude, +req.body.longitude)
  }).then(function () {
    res.send({
      response: 200,
      text: 'OK'
    });
  }).fail(function (e) {
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
    console.error(err.stack || err.message || err);
  });
});

function postVoteRoute (action, increment) {
  var key = action + 's';
  return function (req, res) {
    res.set('Content-Type', 'text/plain');
    var query = new Parse.Query(Entry);
    var after = 0;
    query.get(req.params.id).then(function (entry) {
      var curInc = increment * (req.body.unvote ? -1 : 1);
      after = entry.get(key) + curInc;
      if (!entry.set(key, after)) throw new Error('entry set failed');
      return entry.save().then(function () {
        res.send('' + after);
      }).fail(function (err) {
        console.error(err.stack || err.message || err);
        res.status(500).send('0');
      });
    }, function (err) {
      res.status(404).send('0');
    });
  };
}

app.post('/api/1.0/upvote/:id', jsonParser, postVoteRoute('upvote', 1));
app.post('/api/1.0/downvote/:id', jsonParser, postVoteRoute('downvote', -1));

function getVoteRoute (action) {
  var key = action + 's';
  return function (req, res) {
    res.set('Content-Type', 'text/plain');
    var query = new Parse.Query(Entry);
    query.get(req.params.id).then(function (entry) {
      res.send('' + entry.get(key));
    }, function (err) {
      res.status(404).send('0');
    }).fail(function (err) {
      console.error(err.stack || err.message || err);
      res.status(500).send('0');
    });
  };
}

app.get('/api/1.0/upvote/:id', getVoteRoute('upvote'));
app.get('/api/1.0/downvote/:id', getVoteRoute('downvote'));

// TODO: CSV

app.listen(8083, '0.0.0.0', function () {
  console.log('listening on 8083');
});
