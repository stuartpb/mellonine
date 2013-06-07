# mellonine

Dial friend and enter

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
