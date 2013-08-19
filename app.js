var express = require('express');
var twilio = require('twilio');
var redis = require('redis');
var bcrypt = require('bcrypt');

// A bcrypt hash that no input will yield (for timing purposes, so invalid
// requests take just as long to fail as valid ones).
var impossibleHash =
  '$2a$10$00000000000000000000000000000000000000000000000000000';

// Insert TwiML to the node given to play the given sequence of DTMF tones.
function playTones(twiml,tones) {

  // allow array, string, and number input
  if(!Array.isArray(tones)) {
    tones = tones.toString().split('');
  }

  // Add a TwiML Play verb for each tone in the sequence.
  for(var i = 0; i < tones.length; i++) {
    var tone = tones[i];
    twiml.play('/dtmf/'
      + (tone == '#' ? 'pound' : tone == '*' ? 'star' : tone)
      + '.wav');
  }

  return twiml;
}

// Construct the app based on the passed-in configuration parameters.
module.exports = function appctor(cfg) {

  // Connect to Redis
  var db = redis.createClient(cfg.redis.port, cfg.redis.hostname,
    {no_ready_check: true});
  db.auth(cfg.redis.password);

  // Create an object, matching a list of keys to a list of values.
  function objectify(fields,values) {
    var hfo = {};
    for (var i = 0; i < fields.length; i++) hfo[fields[i]] = values[i];
    return hfo;
  }

  // Create the app
  var app = express();

  // Parse incoming request bodies
  app.use(express.bodyParser());

  // Use the Connect favicon.
  app.use(express.favicon());

  // Serve our DTMF tone .WAV files from /dtmf/
  app.use('/dtmf', express.static(__dirname+'/dtmf'));

  // Paths for the main three user-facing pages.
  app.get('/', function(req, res) {
    res.render('index.jade');
  });
  app.get('/success', function (req, res){
    res.render('success.jade');
  });
  app.get('/google-voice-setup', function (req, res) {
    res.render('google-voice-setup.jade');
  });

  // The list of fields that go straight from the configuration form
  // to the database.
  var configvars = ['smsttl', 'prompt', 'sleep', 'unlockTone',
    'gatherTimeout', 'finishOnKey', 'numDigits'];

  // The route receiving the submission form for configuration.
  app.post('/',function(req,res,next) {
    // Bcrypt the passcode with 10 rounds
    bcrypt.hash(req.body.passcode, 10, function(err, passhash) {
      if (err) return next(err);

      // The parameters of the HMSET operation:
      var hfields = [
        // The key we're setting to the hash object,
        req.body.accsid + req.body.number + ' config',
        // the key/value for the passcode's bcrypt hashsum
        'passhash', passhash
      ];

      // Add all the other fields from the config form to the HMSET operation
      // parameters as key/value pairs
      for (var i=0; i < configvars.length; i++) {
        hfields.push(configvars[i]);
        hfields.push(req.body[configvars[i]]);
      }

      // Set the config object in the database
      db.hmset(hfields, function(err,status) {
        if (err) return next(err);
        //if no err let's just assume the status is OK or otherwise fine
        else return res.redirect('/success');
      });
    });
  });

  // The route for recieving a call from Twilio.
  app.post('/incoming/voice',function(req,res, next){

    // The combined ID to identify this client.
    var cid = req.body.AccountSid + req.body.To;

    // The fields we need from the database, for this client,
    // to respond to the first phase of the call.
    var fields = ['sleep', 'prompt', 'unlockTone',
      'gatherTimeout', 'finishOnKey', 'numDigits'];

    // Get the configuration fields we need for our response from the database,
    // and check at the same time to see if the door is currently unlocked
    // (via SMS) to see if we should prompt for the passcode
    db.multi()
      .hmget([cid + ' config'].concat(fields))
      .get(cid + ' unlocked')
      .exec(function (err, dbres) {
        if (err) return next(err);

        // Create an object mapping the keys we asked for to the value list
        // returned from the Redis request.
        var hfo = objectify(fields, dbres[0]);

        // Create our TwiML response.
        var resTwiml = new twilio.TwimlResponse();

        // If this client is configured to sleep before answering the call,
        // insert a pause at the top of the response so Twilio will wait.
        if (hfo.sleep) {
          resTwiml.pause(hfo.sleep);
        }

        // If the door is currently "unlocked"
        if (dbres[1]) {

          // Re-lock the door by deleting the unlock record
          db.del(cid + ' unlocked', function (err, status) {
            if (err) return next(err);
            //if no err let's just assume the status is OK or otherwise fine

            // Once we've gotten confirmation that the door re-lock has
            // completed successfully and without errors, play the tone
            // sequence that unlocks the door
            playTones(resTwiml,hfo.unlockTone);
          });

        // If there's no "unlock" record stating that this call should bypass
        // passcode entry and unlock immediately
        } else {

          // The options/attributes of the Gather TwiML verb that gathers
          // the passcode
          var gatherattrs = {

            // The time to wait before gathering. Defaults to 5 seconds.
            timeout: hfo.gatherTimeout || 5,

            // A key to mark as ending the sequence (by default, only wait)
            finishOnKey: hfo.finishOnKey || '',

            // Where to POST the results to.
            action: '/incoming/voice/digits'
          };

          // If there's a maximum number of digits set to gather,
          // add that maximum to the Gather verb attributes
          if (hfo.numDigits) gatherattrs.numDigits = hfo.numDigits;

          // Add the Gather prompt to the response
          resTwiml.gather(gatherattrs, function (twiml) {
            twiml.say(hfo.prompt || 'Enter the passcode');
          });
        }

        // Send the response we've built to Twilio
        res.type('text/xml').send(resTwiml.toString());
      });
  });

  // The route for responding to passcodes.
  app.post('/incoming/voice/digits', function (req, res, next) {

    // The combined ID to identify this client.
    var cid = req.body.AccountSid + req.body.To;

    // Get the hash of the passcode, and the tone sequence to play if the
    // passcode sent matches the stored hashed passcode, from the database
    db.hmget([cid + ' config', 'passhash', 'unlockTone'],
      function (err, hvalues) {

      if (err) return next(err);

      // Match the stored passcode (or, if no client was found with the
      // given credentials, compare an invalid passcode) with the entered
      // passcode
      bcrypt.compare(req.body.Digits, hvalues[0] || impossibleHash,
        function (err, passmatch) {

        if (err) return next(err);

        // Create our TwiML response.
        var resTwiml = new twilio.TwimlResponse();

        // If the passcode matches
        if (passmatch) {

          // Play the tone that unlocks the door
          playTones(resTwiml, hvalues[1]);

        // If the passcode didn't match
        } else {

          // Tell the user what passcode was heard, and that it was
          // not recognized as correct
          resTwiml.say('Passcode '
            // (inserting a space between each digit so Twilio reads it
            // as a sequence of digits rather than one number)
            + req.body.Digits.split('').join(' ')
            + ' not recognized');
        }

        // Send the response we've built to Twilio
        res.type('text/xml').send(resTwiml.toString());
      });
    });
  });

  // The route for responding to SMS messages.
  app.post('/incoming/sms', function (req,res,next) {

    // The combined ID to identify this client.
    var cid = req.body.AccountSid + req.body.To;

    // Get the hash of the passcode and the duration for successful
    // SMS unlocks from the database
    db.hmget([cid + ' config', 'passhash', 'smsttl'],
      function(err,hvalues) {

      if (err) return next(err);

      // Match the stored passcode (or, if no client was found with the
      // given credentials, compare an invalid passcode) with the entered
      // passcode
      bcrypt.compare(req.body.Body, hvalues[0] || impossibleHash,
        function (err, passmatch) {

        if (err) return next(err);

        // If the passcode matches
        if (passmatch) {

          // Set a record in the database marking that the door is unlocked,
          // expiring after the unlock duration is up
          db.setex(cid + ' unlocked', hvalues[1], req.body.From,
            function (err, status) {

            if (err) return next(err);
            //if no err let's just assume the status is OK or otherwise fine

            // Respond to the text message by telling the texter how long the
            // door will be waiting to open
            else return res.type('text/plain').send(
              'Door will unlock automatically in the next '
                + hvalues[1] + ' seconds');
          });

        // If the passcode doesn't match
        } else {
          // Echo the text body (or the first 100 characters of it if it was
          // really long) back to the user and tell them it wasn't recognized
          // as the correct passcode
          res.type('text/plain').send(
            'Passcode "' + req.body.Body.slice(0,100)
              + (req.body.Body.length > 100 ? '...' : '')
              + '" not recognized');
        }
      });
    });
  });

  // Respond with a 404 code for any other requests
  app.use(function(req,res){return res.send(404)});

  return app;
};
