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

While most of the database security issues of the original application have
been resolved by moving the configuration to stateless request parameters,
there are still two holes:

1. Requests are logged, meaning configuration details can still be discovered
   by gaining access to the logs (although the leaking of the passcodes can be
   mitigated by submitting a bcrypted hash of the passcode as "bcryptPasshash"
   instead of the plaintext "passcode" parameter).
2. Unlock tokens are free to be read and set, meaning that, if you know a token
   is currently in the system and its identifier is sufficiently weak, you may
   find it via brute force and subsequently set it at will.

I consider both of these acceptable risks.
