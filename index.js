var request = require('then-request');
var morgan = require('morgan');
var Promise = require('promise');
var express = require('express');
var multer = require('multer');
var mime = require('mime-types');
var bodyParser = require('body-parser');
var Parse = require('parse/node');
var stringify = require('csv-stringify');
var url = require('url');
var parseXml = require('xml2js').parseString;

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

var Entry = Parse.Object.extend('Entry');
var Comment = Parse.Object.extend('Comment');
var User = Parse.Object.extend('User');

Parse.initialize(config.parseAppID, config.parseKey);

app.use(morgan('combined'));

app.use(express.static(__dirname + '/public'))

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.post('/api/1.0/upload', singleUpload, function (req, res) {
  var file = req.file;
  var entry = new Entry();
  Promise.resolve(entry.save({
    votes: 0,
    pictures: [ 'uploads/' + file.filename ],
    description: req.body.description,
    location: new Parse.GeoPoint(+req.body.latitude, +req.body.longitude)
  })).then(function () {
    res.send({
      response: 200,
      text: 'OK'
    });
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500')
    }
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
  });
});

function postVoteRoute (increment) {
  return function (req, res) {
    res.set('Content-Type', 'text/plain');
    var after = 0;
    Promise.resolve(new Parse.Query(Entry).get(req.params.id))
    .then(function (entry) {
      var curInc = increment * (req.body.unvote ? -1 : 1);
      after = entry.get('votes') + curInc;
      if (!entry.set('votes', after)) {
        console.trace('entry set failed');
        res.status(500).send('0');
        return;
      }
      return Promise.resolve(entry.save()).then(function () {
        res.send('' + after);
      }).catch(function (err) {
        if (err) {
          console.error(err.stack || err.message || err);
        } else {
          console.trace('500')
        }
        res.status(500).send('0');
      });
    }, function (err) {
      res.status(404).send('0');
    });
  };
}

app.post('/api/1.0/upvote/:id',   jsonParser, postVoteRoute(1));
app.post('/api/1.0/downvote/:id', jsonParser, postVoteRoute(-1));

app.post('/api/1.1/vote/:id', jsonParser, function (req, res) {
  res.set('Content-Type', 'text/plain');
  var votes = req.body.votes;

  if (votes > 10 || votes < -10) res.status(400).send('');
  Promise.resolve(new Parse.Query(Entry).get(req.params.id))
    .then(function (entry) {
      entry.increment('votes', votes);
      return Promise.resolve(entry.save()).then(function () {
        res.send('');
      }).catch(function (err) {
        if (err) {
          console.error(err.stack || err.message || err);
        } else {
          console.trace('500')
        }
        res.status(500).send('');
      });
    }, function (err) {
      res.status(404).send('');
    });
});

app.get('/api/1.0/votes/:id', function (req, res) {
  res.set('Content-Type', 'text/plain');
  Promise.resolve(new Parse.Query(Entry).get(req.params.id))
  .then(function (entry) {
    res.send('' + entry.get('votes'));
  }, function (err) {
    res.status(404).send('0');
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500');
    }
    res.status(500).send('0');
  });
});

app.get('/api/1.0/getAll', function (req, res) {
  res.set('Content-Type', 'text/csv');
  var schema = [
    'objectId',
    'votes',
    'latitude',
    'longitude',
    'picture',
    'description'
  ];
  var stringifier = stringify();
  stringifier.pipe(res);
  stringifier.write(schema);
  Promise.resolve(new Parse.Query(Entry).each(function (entry) {
    var serialized = [];
    serialized.push(entry.id);
    serialized.push(entry.get('votes'));
    var loc = entry.get('location');
    serialized.push(loc.latitude);
    serialized.push(loc.longitude);
    serialized.push(entry.get('pictures')[0]);
    serialized.push(entry.get('description'));
    stringifier.write(serialized);
  })).then(function () {
    stringifier.end();
  });
});

app.get('/api/1.0/getAllJSON', function (req, res) {
  var out = [];
  Promise.resolve(new Parse.Query(Entry).each(function (entry) {
    out.push(entry)
  })).then(function () {
    res.send(out);
  });
});

app.get('/api/1.2/getAllJSON', function (req, res) {
  var out = [];
  Promise.resolve(new Parse.Query(Entry).each(function (entry) {
    out.push(getJsonFromEntry(entry));
  })).then(function () {
    res.send(out);
  });
});

app.get('/api/1.0/get/:id', function (req, res) {
  Promise.resolve(new Parse.Query(Entry).get(req.params.id)).then(function (entry) {
    res.send(getJsonFromEntry(obj));
  }, function (err) {
    res.status(404).send({
      response: 404,
      text: 'Not found'
    });
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500')
    }
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
  });
});

app.post('/api/1.0/comment/:target', jsonParser, function (req, res) {
  var comment = new Comment();

  Promise.all([
    Promise.resolve(comment.save({
      data: req.body.data,
      uuid: req.body.uuid,
      target: req.params.target,
      admin: req.body.uuid === 'admin'
    })),
  ]).then(function () {
    res.send({
      response: 200,
      text: 'OK',
    });
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500')
    }
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
  });
});

app.get('/api/1.0/getComments/:target', function (req, res) {
  var query = new Parse.Query(Comment)
    .equalTo('target', req.params.target)
    .ascending('createdAt');

  Promise.resolve(query.find()).then(function (results) {
    if (!results || !results.length) {
      return res.status(404).send({
        response: 404,
        text: 'Not found',
      });
    }

    return res.send(results);
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500')
    }
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
  });
});

app.get('/api/1.2/getComments/:target', function (req, res) {
  var query = new Parse.Query(Comment)
    .equalTo('target', req.params.target)
    .ascending('createdAt');

  Promise.resolve(query.find()).then(function (results) {
    if (!results) results = [];

    return res.send(results);
  }).catch(function (err) {
    if (err) {
      console.error(err.stack || err.message || err);
    } else {
      console.trace('500')
    }
    res.status(500).send({
      response: 500,
      text: 'Internal server error'
    });
  });
});

app.get('/api/1.3/getTags', function (req, res) {
  var src = req.query.q;
  if (!src) {
    return res.send([]);
  }

  var urlObj = url.parse('https://api.datamarket.azure.com/data.ashx/amla/text-analytics/v1/GetKeyPhrases');
  urlObj.query = { Text: src };
  console.log(url.format(urlObj))
  request('GET', url.format(urlObj), {
    headers: {
      Authorization: config.azureAuth,
    },
  }).then(function (xml) {
    console.log(xml);
    return new Promise(function (resolve, reject) {
      parseXml(xml, function (err, obj) {
        if (err) return reject(err);
        resolve(obj);
        console.log(obj);
      });
    });
  }).then(function (xmlObj) {
    res.send(xmlObj['d:GetKeyPhrases']['d:KeyPhrases'][0]['d:comment']);
  }).catch(function (err) {
    console.error(err.stack);
    res.send([]);
  });
});

app.listen(8083, '0.0.0.0', function () {
  console.log('listening on 8083');
});

function getJsonFromEntry(entry) {
  return {
    objectId: entry.id,
    description: entry.get('description'),
    location: entry.get('location'),
    picture: entry.get('pictures')[0],
    votes: entry.get('votes'),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}
