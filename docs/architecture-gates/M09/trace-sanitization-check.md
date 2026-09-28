# Legacy Run trace sanitization — partial M09 evidence

`m09:traces:sanitize` requires a stopped runtime, an explicit offline opt-in and PostgreSQL runtime ownership. Each bounded transaction removes extra JSON fields only after validating the retained `sequence/type/at` and matching the row sequence. A repeat run is a no-op; malformed core metadata blocks rather than fabricating history. `m09:traces:audit` remains the read-only Gate check and must report zero invalid rows on staging.

The embedded and isolated local PostgreSQL E2E exercise legacy body removal, repeat and malformed-core rejection. This does not prove historical WAL, backup or exported Bundle expiry, and no staging audit has been completed.
