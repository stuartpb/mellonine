# mellonine

My apartment building's front door security system is designed so that each
tenant's phone number is listed in the system, and, when a tenant has a guest,
the visitor can look up the tenant's name in the building directory and dial a
corresponding code for that tenant (usually the last four digits of that
tenant's phone number). Once dialed, the system will call that tenant's phone,
and, if the call is answered, it will connect the tenant's phone to the
intercom in the antechamber where the visitor is standing, at which point the
tenant can verify the visitor's identity and unlock the door by dialing '9' on
their phone's keypad.

In practice, what I've found is that, half of the time, visitors bypass this
system altogether (by being let in by another resident coming in the door, or
by the concierge, or by walking in as a pizza delivery person is walking out).
In the cases where visitors do use the system to gain access, I'm indisposed,
or my phone is across the room, or I need to wash my hands, and I can't answer
the call.

This app is designed to handle these calls for me, by prompting the visitor for
a passcode, then respoding with a '9' dialtone to let them in (or refusing them
if the passcode is incorrect).

The name comes from "mellon", the Elvish word for friend that opens the doors
to the Mines of Moria, and "nine", the DTMF digit that opens the doors to my
apartment building.

## Setting up the app

1. Host the app somewhere Internet-accessible. I personally use Heroku, but you
   can also use Nodejitsu or any other hosting provider that can serve
   Node apps written for [twelve-factor methodology](http://12factor.net/).
2. Set the appropriate environment variables for your instance according to
   the "Configuration" section below.
3. Create a Twilio account at https://twilio.com, if you haven't already, and
   set a number to receive incoming calls.
4. Set the number to request the root path of your app (eg.
   http://mellonine.herokuapp.com/ ) with the 'GET' method for incoming calls.
5. Set your tenant number in the apartment building's security system to your
   Twilio number.
   - If you already have a number in the system that's tied to a Google Voice
     account, you can set your account up to forward calls from the security
     system to the Twilio number. See "Setting up Google Voice" below.

## Configuration

- `PORT`: The port the app should listen to requests on. Services like Heroku
  set this variable automatically.
- `PASSCODE_DIGITS`: The passcode people should enter to gain access (eg.
  '12345'). Note that while this app doesn't place any limit on passcode
  lengths, some security systems (including the one my building uses) stop
  recognizing key presses after a certain number of tones have been played, so
  that may be a limiting factor.
- `SUCCESS_DIGITS`: The number to dial on successful passcode entry. If this
  variable isn't set, '9' will be used by default.
- `PASSCODE_ENTRY_TIMEOUT`: How many seconds to wait until gathering all
  entered input as the passcode. If this variable isn't set, the Twilio default
  of 5 seconds will be used.
- `ANSWER_WAIT`: If set, the app will wait for the number of seconds
  specified before picking up the call. This can be used in a scenario like
  Google Voice, where multiple phones can be configured to ring for a call
  simultaneously, to allow the other phones a period of time in which they can
  pick up the call.

## Setting up Google Voice

1. Go to https://www.google.com/voice#phones and click "Add a number".
2. Go to your Twilio number's configuration, set it to use URLs and not
   applications, and set the Voice Request URL to
   http://tempanswer.herokuapp.com/incoming (POST).
3. Once the number has been added and Google says you need to verify your
   phone, start the process. When given the number that you will need to dial
   to verify your phone, go to http://tempanswer.herokuapp.com/,
   enter your Twilio phone number and the two-digit confirmation code Google
   Voice is displaying that it will prompt for, then press "Connect" on the
   Google Voice screen.
4. Once Google Voice succesfully verifies your number, uncheck the box that
   marks the new phone for general call forwarding on Google Voice.
5. Configure your Twilio number to point to mellonine again.
6. Add the number the building's security system calls from to your Google
   Contacts, and add it to a group exclusively for calling your Twilio number.
7. On https://www.google.com/voice#groups , edit the settings for the group
   that you just set up for calling your Twilio number. Under "When people in
   this group call you: Ring my:", uncheck all phones on your account other
   than your Twilio number. Also make sure that call screening is Off.

## Roadmap

Right now, this is only configured to serve access to my own apartment:
however, with a bit of tweaking, it could be changed to serve access for any
number of Twilio accounts and/or numbers concurrently, with a different
passcode configurable for each.

## Application security

Currently the app rejects neither phone calls nor HTTP requests. This leads to
potential brute force discovery of the passcode on multiple fronts. Below is a
roadmap for authentication tactics that could be implemented.

All values should be checked using a constant-time comparison function to deter
discovering the correct values through timing attacks. (For many values, there
are easier ways to discover the correct values, like what IP Twilio requests
originate from, but it's still good practice and it doesn't cost more than a
few microseconds.)

I'm fully aware that a scenario where somebody mounts an elaborate brute-force
timing-attack to discover the passcode I personally use to open my apartment's
front door, instead of just following somebody in when they swipe their keyfob,
is a total [crypto-nerd fantasy](http://xkcd.com/538/). A security guard who
knows who the building's residents are should always be the primary level of
security, with everything else regarded as a mild deterrent.

### Authenticating HTTP requests

In lieu of something like an HMAC mechanism to verify that a request is coming
from the authorized Twilio endpoint (a la Textmarks), requests could check for
a matching account SID on the request, all other fields that should be present
in a Twilio request being set to sane values, and the requestor's IP matching
Twilio's.

### Authenticating calls

Calls could be confirmed to be originating from an approved number (the front
door PBX) by checking against the From and ForwardedFrom parameters. However,
it's also possible that a carrier may forward the call from a number and not
provide the forwarding information, so this should be an optional mechanism.
