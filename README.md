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

## Configuration

mellonine uses [envigor](https://github.com/stuartpb/envigor) configuration for
**port** and **redis**.

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
