accuracy:

- inaccurate dimming (vs PT reference) on bounced diffuse light in the 'bounce maze' test but not the 'bounce room' test
- sky artefact at edges visible at low probe sizes (but seems to appear without it too) maybe an off-by-one error somewhere
- light leaks for bounced light
- asymetric non-bounced light in volumes without bounced light

design:

- are albedo/scattering mutually exclusive and hence combinable into a single value? (or mutually exclusive enough) where albedo kinda transitions to scattering as opacity reduces (also is opacity actually absorption? same usage just different name)

perf:

- can raytrace vs extend phase be optimally/dynamically parametrised?
- hmmmmmm what if theres a way to avoid the aspect ratio artefacts entirely? overfit one axis and reduce work AND eliminate all the aspect ratio fuckery for same quality??
