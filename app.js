var express = require('express');
var twilio = require('twilio');
var redis = require('redis');
var bcrypt = require('bcrypt');

function playTones(twiml,tones) {
  
  //allow array, string, and number input
  if(!Array.isArray(tones)) {
    tones = tones.toString().split('');
  }
  
  for(var i = 0; i < tones.length; i++) {
    var tone = tones[i];
    twiml.play('/dtmf/'
      + (tone == '#' ? 'pound' : tone == '*' ? 'star' : tone)
      + '.wav');
  }

  return twiml;
}

function playToneResponse(res,tones) {
  res.type('text/xml').send(
    playTones(new twilio.TwimlResponse(), tones)
      .toString());
}

module.exports = function(cfg) {
  
  var db = redis.createClient(cfg.redis.port, cfg.redis.hostname,
    {no_ready_check: true});
  db.auth(cfg.redis.password);

  function objectify(fields,values) {
    var hfo = {};
    for (var i = 0; i < fields.length; i++) hfo[fields[i]] = values[i];
    return hfo;
  }

  var app = express();

  app.use(express.bodyParser());
  app.use(express.favicon());
  app.use('/dtmf', express.static(__dirname+'/dtmf'));

  app.get('/', function(req, res) {
    res.render('index.jade');
  });
  app.get('/success', function (req, res){
    res.render('success.jade');
  });
  app.get('/google-voice-setup', function (req, res) {
    res.render('google-voice-setup.jade');
  });
  
  var configvars = ['smsttl', 'prompt', 'sleep', 'unlockTone',
    'gatherTimeout', 'finishOnKey', 'numDigits'];
  
  app.post('/',function(req,res,next) {
    bcrypt.hash(req.body.passcode, 10, function(err, passhash) { 
      if (err) return next(err);
      var hfields = [req.body.accsid + rec.body.number + ' config',
        'passhash', passhash];
      for (var i=0; i < configvars.length; i++) {
        hfields.push(configvars[i]);
        hfields.push(req.body[configvars[i]]);
      }
      
      db.hmset(hfields, function(err,status) {
        if (err) return next(err);
        //if no err let's just assume the status is OK or otherwise fine
        else return res.redirect('/success');
      });
    });
  });

  app.post('/incoming/voice',function(req,res, next){
    var cid = req.body.AccountSid + req.body.To;
    var fields = ['sleep', 'prompt', 'unlockTone',
      'gatherTimeout', 'finishOnKey', 'numDigits'];
    
    db.multi()
      .hmget([cid + ' config'].concat(fields))
      .get(cid + ' unlocked')
      .exec(function (err, dbres) {
        if (err) return next(err);
        var hfo = objectify(fields, dbres[0]);
        var resTwiml = new twilio.TwimlResponse();
        if (hfo.sleep) {
          resTwiml.pause(hfo.sleep);
        }
        if (dbres[1]) {
          // since we don't really care about the success/failure of this
          // command that much, we run it without a callback
          db.del(appsid + ' unlocked');
          playTones(resTwiml,hfo.unlockTone);
        } else {
          var gatherattrs = {
            timeout: hfo.gatherTimeout || 5,
            finishOnKey: hfo.finishOnKey || '',
            action: '/incoming/voice/digits'
          };
          
          if (hfo.numDigits) gatherattrs.numDigits = hfo.numDigits;
          
          resTwiml.gather(gatherattrs, function (twiml) {
            twiml.say(hfo.prompt || 'Enter the passcode');
          });
        }
        
        res.type('text/xml').send(resTwiml.toString());
      });
  });

  app.post('/incoming/voice/digits', function (req, res, next) {
    var cid = req.body.AccountSid + req.body.To;
    db.hmget([cid + ' config', 'passhash', 'unlockTones'],
      function (err, hvalues) {
        
      if (err) return next(err);
      bcrypt.compare(req.body.Digits, hvalues[0], function (err, passmatch) {
        if (err) return next(err);
        if (passmatch) {
          playToneResponse(res, hvalues[1]);
        } else {
          res.type('text/xml').send(new twilio.TwimlResponse()
            .say('Passcode '
              + req.body.Digits.split('').join(' ')
              + ' not recognized')
            .toString());
        }
      });
    });
  });

  app.post('/incoming/sms',function(req,res,next){
    var cid = req.body.AccountSid + req.body.To;
    db.hmget([cid + ' config', 'passhash', 'smsttl'],
      function(err,hvalues) {
        
      if (err) return next(err);
      bcrypt.compare(req.body.Body, hvalues[0], function (err, passmatch) {
        if (err) return next(err);
        if (passmatch) {
          db.setex(cid + ' unlocked', hvalues[1], req.body.From,
            function (err, status) {
              
            if (err) return next(err);
            //if no err let's just assume the status is OK or otherwise fine
            else return res.type('text/plain').send(
              'Door will unlock automatically in the next '
                + hvalues[1] + 'seconds');
          });
        } else {
          res.type('text/plain').send(
            'Passcode "' + req.body.Body.slice(0,100)
              + (req.body.Body.length > 100 ? '...' : '')
              + '" not recognized');
        }
      });
    });
  });

  app.use(function(req,res){return res.send(404)});

  return app;
};