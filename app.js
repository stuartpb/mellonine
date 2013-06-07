var express = require('express');
var twilio = require('twilio');

function playTones(twiml,tones){
  
  //allow array, string, and number input
  if(!Array.isArray(tones)){
    tones = tones.toString().split('');
  }
  
  for(var i = 0; i < tones.length; tones++){
    var tone = tones[i];
    twiml.play('/dtmf/'
      + (tone == '#' ? 'pound' : tone == '*' ? 'star' : tone)
      + '.wav');
  }
  
  return twiml;
}

function playToneResponse(res,tones){
  res.type('text/xml').send(
    playTones(new twilio.TwimlResponse(), tones)
      .toString());
}

module.exports = function(cfg){
  var app = express();
  
  app.use(express.bodyParser());
  app.use(express.favicon());
  app.use('/dtmf',express.static(__dirname+'/dtmf'));
  
  app.get('/incoming',function(req,res){
    // respond with tones for verifying number to Google Voice
    if(process.env.RESPOND_TONES) {
      playToneResponse(res,process.env.RESPOND_TONES);
    } else {
      res.type('text/xml').send(new twilio.TwimlResponse()
        .gather({
          timeout: process.env.PASSCODE_ENTRY_TIMEOUT || 5
        }, function(twiml){
          twiml.say('Enter the passcode, followed by pound');
        }).toString());
    }
  });

  app.post('/incoming',function(req,res){
    console.log(req.body);
    if (req.body.Digits == process.env.PASSCODE_DIGITS) {
      playToneResponse(res,9);
    } else {
      res.type('text/xml').send(new twilio.TwimlResponse()
        .say('Passcode not recognized')
        .toString());
    }
  });
  
  return app;
};