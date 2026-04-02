accuracy:

- sky artefact at edges visible at low probe sizes (but seems to appear without it too) maybe some off-by-one errors somewhere (very low priority)
- asymetric non-bounced light in volumes without bounced light (possibly related to aspect ratio math)

design:

- RGB albedo: currently nonemissive shapes can only be black. RGB albedo would let shapes have color independent of emission (a red wall reflecting only red light, etc).
  - texture format: rgba8unorm (4 bytes/px) is the natural choice — albedo is LDR (0–1), no HDR needed. rgb9e5 can't be a render target. alpha channel free for future use.
  - bandwidth: material texture goes 1→4 bytes/px, but it's only read at probe res (bounce shader) and screen res (PT/blit). negligible vs the rgba16float world texture (8 bytes/px). total bandwidth increase ~2-3%.
  - vertex data: 28→36 bytes/vertex (3 extra floats for albedoRGB).
  - display: blit would need a `reflected = bounceColor × opacity` term using the bounce texture (which already carries RGB). the bounce already stores `fluence × albedo / 2π` — with RGB albedo this naturally becomes `fluence × albedoRGB / 2π`, giving colored bounce for free.
  - the tricky part: how to display opaque surfaces lit by GI. options explored during bounce work: (C) read bounce texture with nearest-neighbor masked by opacity — works but had 1px edge issues. could revisit with better masking. (D) add bounce to world emission before seeding — changes the world texture mid-frame, messy. (E) separate "lit surface" render pass composited on top — cleanest but adds a pass.

perf:

- hmmmmmm what if theres a way to avoid the aspect ratio artefacts entirely? overfit one axis and reduce work AND eliminate all the aspect ratio fuckery for same quality??
