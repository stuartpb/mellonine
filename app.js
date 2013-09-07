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

  // The route for recieving a call from Twilio.
  app.post('/voice',function(req, res, next){
    var unlockToken = req.query.unlockToken;
    var unlockTone = req.query.unlockTone || '9';
    var sleep = req.query.sleep;
    var gatherTimeout = req.query.gatherTimeout || 5;
    var finishOnKey = req.query.finishOnKey || '';
    var numDigits = req.query.numDigits;
    var prompt = req.query.prompt || 'Enter the passcode';

    function respond(err, unlock) {
      if (err) return next(err);

      // Create our TwiML response.
      var resTwiml = new twilio.TwimlResponse();

      // If this client is configured to sleep before answering the call,
      // insert a pause at the top of the response so Twilio will wait.
      if (sleep) resTwiml.pause(sleep);

      // If the door is currently "unlocked"
      if (unlock) {

        // Re-lock the door by deleting the unlock record
        db.del('unlock/'+unlockToken, function (err, status) {
          if (err) return next(err);
          //if no err let's just assume the status is OK or otherwise fine

          // Once we've gotten confirmation that the door re-lock has
          // completed successfully and without errors, play the tone
          // sequence that unlocks the door
          playTones(resTwiml,unlockTone);
          res.type('text/xml').send(resTwiml.toString());
        });

      // If there's no "unlock" record stating that this call should bypass
      // passcode entry and unlock immediately
      } else {

        // The options/attributes of the Gather TwiML verb that gathers
        // the passcode
        var gatherattrs = {

          // The time to wait before gathering. Defaults to 5 seconds.
          timeout: gatherTimeout,

          // A key to mark as ending the sequence (by default, only wait)
          finishOnKey: finishOnKey,

          // Where to POST the results to.
          action: '/digits' + require('url').parse(req.url).query
        };

        // If there's a maximum number of digits set to gather,
        // add that maximum to the Gather verb attributes
        if (numDigits) gatherattrs.numDigits = numDigits;

        // Add the Gather prompt to the response
        resTwiml.gather(gatherattrs, function (twiml) {
          twiml.say(prompt);
        });
      }

      // Send the response we've built to Twilio
      res.type('text/xml').send(resTwiml.toString());
    }

    // Get the configuration fields we need for our response from the database,
    // and check at the same time to see if the door is currently unlocked
    // (via SMS) to see if we should prompt for the passcode
    if (unlockToken) db.get('unlock/'+unlockToken, respond);
    else respond();
  });

  // The route for responding to passcodes.
  app.post('/digits', function (req, res, next) {

    var bcryptPasshash = req.query.bcryptPasshash;
    var passcode = req.query.passcode;
    var unlockTone = req.query.unlockTone || '9';

    function evaluate(err,passmatch) {
      if (err) return next(err);

      // Create our TwiML response.
      var resTwiml = new twilio.TwimlResponse();

      // If the passcode matches
      if (passmatch) {

        // Play the tone that unlocks the door
        playTones(resTwiml, unlockTone);

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
    }

    if (bcryptPasshash) bcrypt.compare(req.body.Digits, evaluate);
    else evaluate(null,passcode == req.body.Digits);
  });

  // The route for responding to SMS messages.
  app.post('/sms', function (req, res, next) {

    var bcryptPasshash = req.query.bcryptPasshash;
    var unlockToken = req.query.unlockToken;
    var passcode = req.query.passcode;
    var ttl = req.query.ttl;

    function evaluate(err,passmatch) {
      if (err) return next(err);

      // If the passcode matches
      if (passmatch) {

        // Set a record in the database marking that the door is unlocked,
        // expiring after the unlock duration is up
        db.setex('unlock/'+unlockToken, ttl, req.body.From,
          function (err, status) {

          if (err) return next(err);
          //if no err let's just assume the status is OK or otherwise fine

          // Respond to the text message by telling the texter how long the
          // door will be waiting to open
          else return res.type('text/plain').send(
            'Door will unlock automatically in the next '
              + ttl + ' seconds');
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
    }

    if (bcryptPasshash) bcrypt.compare(req.body.Body, evaluate);
    else evaluate(null,passcode == req.body.Body);
  });

  // Respond with a 404 code for any other requests
  app.use(function(req,res){return res.send(404)});

  return app;
};
