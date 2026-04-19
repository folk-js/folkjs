import { FolkAtlas } from '../folk-atlas.ts';
import { FolkAtlasRegion } from '../folk-atlas-region.ts';
import { FolkAtlasShape } from '../folk-atlas-shape.ts';

// Children must be defined BEFORE the parent: <folk-atlas>'s connectedCallback
// inspects its existing children with `instanceof FolkAtlasShape` /
// `FolkAtlasRegion`, which only succeeds once those constructors are
// registered (otherwise children are still HTMLUnknownElement at parse time).
FolkAtlasRegion.define();
FolkAtlasShape.define();
FolkAtlas.define();

export { FolkAtlas, FolkAtlasRegion, FolkAtlasShape };
