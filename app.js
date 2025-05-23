var express = require('express');
var twilio = require('twilio');
var redis = require('redis');
var bcrypt = require('bcrypt');
var serveFavicon = require('serve-favicon');

// Construct the app based on the passed-in configuration parameters.
module.exports = async function appctor(cfg) {

  // Connect to Redis
  var db = redis.createClient({url: cfg.redis.url});
  await db.connect();

  // Create the app
  var app = express();

  // Parse incoming request bodies
  app.use(express.json());
  app.use(express.urlencoded());

  // Use the Connect favicon.
  app.use(serveFavicon("favicon.png"));

  // Render the landing page for configuration.
  app.get('/', function(req, res) {
    res.render('index.pug');
  });

  function voiceRoute (req, res, next) {
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
      var resTwiml = new twilio.twiml.VoiceResponse();

      // If this client is configured to sleep before answering the call,
      // insert a pause at the top of the response so Twilio will wait.
      if (sleep) resTwiml.pause(sleep);

      // If the door is currently "unlocked"
      if (unlock !== null) {

        // Re-lock the door by deleting the unlock record
        db.del('unlock/'+unlockToken, function (err, status) {
          if (err) return next(err);
          //if no err let's just assume the status is OK or otherwise fine

          // Once we've gotten confirmation that the door re-lock has
          // completed successfully and without errors, play the tone
          // sequence that unlocks the door
          resTwiml.play({digits: unlockTone});

          // Send the response we've built to Twilio
          res.type('text/xml').send(resTwiml.toString());
        });

      // If there's no "unlock" record stating that this call should bypass
      // passcode entry and unlock immediately
      } else {

        var actionParams = [];
        ["bcryptPasshash","passcode","unlockTone"].forEach(function(param){
          if (req.query[param]) actionParams.push(param + '='
            + encodeURIComponent(req.query[param]));
          });
        var actionUrl = '/digits?' + actionParams.join('&');

        // The options/attributes of the Gather TwiML verb that gathers
        // the passcode
        var gatherattrs = {

          // The time to wait before gathering. Defaults to 5 seconds.
          timeout: gatherTimeout,

          // A key to mark as ending the sequence (by default, only wait)
          finishOnKey: finishOnKey,

          // Where to POST the results to.
          action: actionUrl
        };

        // If there's a maximum number of digits set to gather,
        // add that maximum to the Gather verb attributes
        if (numDigits) gatherattrs.numDigits = numDigits;

        // Add the Gather prompt to the response
        resTwiml.gather(gatherattrs, function (twiml) {
          twiml.say(prompt);
        });

        // Send the response we've built to Twilio
        res.type('text/xml').send(resTwiml.toString());
      }
    }

    // If the request includes an SMS token we should check for,
    // check to see if the door is currently unlocked (via SMS)
    // to see if we should immediately unlock instead of prompting
    // for the passcode
    if (unlockToken) db.get('unlock/'+unlockToken, respond);
    // If there's no token, just prompt for the passcode
    else respond();
  }

  // The route for recieving a call from Twilio.
  app.get('/voice',voiceRoute);
  app.post('/voice',voiceRoute);

  // The route for responding to passcodes.
  function digitsRoute (req, res, next) {
    var digits = req.body.Digits || '';

    var bcryptPasshash = req.query.bcryptPasshash;
    var passcode = req.query.passcode;
    var unlockTone = req.query.unlockTone || '9';

    function evaluate(err,passmatch) {
      if (err) return next(err);

      // Create our TwiML response.
      var resTwiml = new twilio.twiml.VoiceResponse();

      // If the passcode matches
      if (passmatch) {

        // Play the tone that unlocks the door
        resTwiml.play({digits: unlockTone});

      // If the passcode didn't match
      } else {

        // Tell the user what passcode was heard, and that it was
        // not recognized as correct
        resTwiml.say('Passcode '
          // (inserting a space between each digit so Twilio reads it
          // as a sequence of digits rather than one number)
          + digits.split('').join(' ')
          + ' not recognized');
      }

      // Send the response we've built to Twilio
      res.type('text/xml').send(resTwiml.toString());
    }

    if (bcryptPasshash) bcrypt.compare(req.body.Digits, evaluate);
    else evaluate(null, passcode == req.body.Digits);
  }
  app.get('/digits', digitsRoute);
  app.post('/digits', digitsRoute);

  // The route for responding to SMS messages.
  function smsRoute (req, res, next) {
    var body = req.body.Body || '';

    var bcryptPasshash = req.query.bcryptPasshash;
    var unlockToken = req.query.unlockToken;
    var passcode = req.query.passcode;
    var ttl = req.query.ttl || 300;

    function evaluate(err,passmatch) {
      if (err) return next(err);

      // If the passcode matches
      if (passmatch) {
        if(!unlockToken) {
          return res.type('text/plain')
            .send("Can't unlock without unlockToken");
        }

        // Set a record in the database marking that the door is unlocked,
        // expiring after the unlock duration is up
        db.setex('unlock/'+unlockToken, ttl, req.body.From || '',
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
          'Passcode "' + body.slice(0,100)
            + (body.length > 100 ? '...' : '')
            + '" not recognized');
      }
    }

    if (bcryptPasshash) bcrypt.compare(req.body.Body, evaluate);
    else evaluate(null, passcode && passcode == req.body.Body);
  }
  app.get('/sms', smsRoute);
  app.post('/sms', smsRoute);

  // Respond with a 404 code for any other requests
  app.use(function(req,res){return res.send(404)});

  return app;
};
