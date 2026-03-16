interface UrlMetadata {
  url: string; // URL
  title: string;
  description: string;
}

type CollectionAccessType = 'OPEN' | 'CLOSED';

interface User {
  did: string; // Decentralized identifier
  handle: string; // User handle (e.g., alice.bsky.social)
  displayName?: string; // Display name
  avatar?: string; // Avatar image URL
  description?: string; // Bio/description
}

interface UrlCard {
  id: string;
  type: 'URL';
  url: string;
  uri?: string; // AT Protocol URI
  cardContent: UrlMetadata;
  libraryCount: number; // Users who saved this card
  urlLibraryCount: number; // Users who saved this URL (any card)
  urlInLibrary?: boolean; // If authenticated, whether user saved this URL
  createdAt: string; // ISO 8601 datetime
  updatedAt: string; // ISO 8601 datetime
  author: User;
  note?: {
    id: string;
    text: string;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Collection {
  id: string;
  uri?: string; // AT Protocol URI
  name: string;
  author: User;
  description?: string;
  accessType?: CollectionAccessType; // OPEN or CLOSED
  cardCount: number;
  createdAt: string; // ISO 8601 datetime
  updatedAt: string; // ISO 8601 datetime
}

type CardSorting = {
  sortBy: 'updatedAt';
  sortOrder: 'desc' | 'asc';
};

interface CollectionPage {
  id: string;
  uri?: string;
  name: string;
  description?: string;
  accessType?: CollectionAccessType;
  author: User;
  urlCards: UrlCard[];
  cardCount: number;
  createdAt: string;
  updatedAt: string;
  pagination: Pagination;
  sorting: CardSorting;
}

async function fetchCollection(handle: string, recordKey: string): Promise<CollectionPage> {
  // const data = await fetch(`https://api.semble.so/api/collections/at/${handle}/${recordKey}?limit=100`, {
  //   // mode: 'no-cors',
  //   headers: {
  //     'Access-Control-Allow-Origin': '*',
  //   },
  // }).then((r) => {
  //   console.log(r);
  //   return r.json();
  // });
  // console.log(data);
  // return data;
  return {
    id: '29736cd6-5d5b-48d1-87ba-fd7448bba34e',
    uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.collection/3mfrzrpx6fw26',
    name: 'at://news',
    description: 'Collectively-sourced, weather reports of the atmosphere.',
    accessType: 'OPEN',
    author: {
      id: 'did:plc:zcanytzlaumjwgaopolw6wes',
      name: '𝕮',
      handle: 'chrisshank.com',
      avatarUrl:
        'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
      bannerUrl:
        'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
    },
    urlCards: [
      {
        id: 'f424ff75-3ee2-4c77-947f-6e02fca87aa3',
        type: 'URL',
        url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mgeme6veyp2x',
        cardContent: {
          url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
          title: 'AT Protocol Community (@atprotocol.dev)',
          description:
            'Thank you to Google @opensource.google  for joining #AtmosphereConf as a major sponsor! We appreciate your support! https://news.atmosphereconf.org/3mge5bs4n522n',
          author: 'AT Protocol Community (@atprotocol.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:lehcqqkwzcwvjvw66uthu5oq/bafkreicorvrpserhlscqioyb2imfeqrivotnr7hryl36nkole65pyghlym@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 3,
        urlInLibrary: true,
        createdAt: '2026-03-06T05:46:48.866Z',
        updatedAt: '2026-03-06T05:46:49.009Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: '33969e3f-fe09-4201-ae66-62df82bd01f2',
        type: 'URL',
        url: 'https://bsky.app/profile/pevohr.bsky.social/post/3mgahokvibk2a',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgeimvz3vk2i',
        cardContent: {
          url: 'https://bsky.app/profile/pevohr.bsky.social/post/3mgahokvibk2a',
          title: 'Paul Rohr (@pevohr.bsky.social)',
          description:
            "I've been saying for nearly a year that getting the UX right for bsky's OAuth deployment is a major inflection point for reinforcing users mental models   If we phrase things right, people will learn that this password UX controls access to my identity + slices of my atmosphere data (via my PDS)  [contains quote post or other embedded content]",
          author: 'Paul Rohr (@pevohr.bsky.social)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:sl5e4dhceock5r7f7ahnq4jm/bafkreihkeq74vxiei3tfft5pibpizqyl2cnblsbsxoppadr4qkeyrv5ur4@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-06T04:40:06.441Z',
        updatedAt: '2026-03-06T04:40:06.441Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '7e375ea2-fa6d-4cb3-9e86-6dd9e534f306',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '7e984705-c9b1-485f-b87c-50ee9939e445',
        type: 'URL',
        url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
        uri: 'at://did:plc:hu2jmpvtlecuwqnosnloplx6/network.cosmik.card/3mgeeqrxlke2y',
        cardContent: {
          url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
          title: 'AT Protocol Community (@atprotocol.dev)',
          description:
            'Thank you to Google @opensource.google  for joining #AtmosphereConf as a major sponsor! We appreciate your support! https://news.atmosphereconf.org/3mge5bs4n522n',
          author: 'AT Protocol Community (@atprotocol.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:lehcqqkwzcwvjvw66uthu5oq/bafkreicorvrpserhlscqioyb2imfeqrivotnr7hryl36nkole65pyghlym@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 3,
        urlInLibrary: true,
        createdAt: '2026-03-06T03:30:41.448Z',
        updatedAt: '2026-03-06T03:30:41.449Z',
        authorId: 'did:plc:hu2jmpvtlecuwqnosnloplx6',
        author: {
          id: 'did:plc:hu2jmpvtlecuwqnosnloplx6',
          name: 'Lyre Calliope 🧭✨',
          handle: 'captaincalliope.blue',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:hu2jmpvtlecuwqnosnloplx6/bafkreibmf27a7ju4bdfamv4xxszl5w7kqgapnz237y53f2xgoolcwjrnwy@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:hu2jmpvtlecuwqnosnloplx6/bafkreihanqn4th73js6wkae4vqflfa2h53h4klaqkyjazdqzoqru2nrlyq@jpeg',
          description:
            '🌐 Working at the intersection of movements, media, and the social web to expand collective agency\n🛠️ Seeking collaborations to reshape systems that concentrate power and shape how we live\n🧭 Field Notes @SpaceCadets.love\n\n🦻🏻 Current focus @ecosystemaction.com',
          followsYou: true,
          followerCount: 5,
          followingCount: 9,
          followedCollectionsCount: 3,
        },
      },
      {
        id: 'afe46316-1e4c-4835-a863-592b9e68c193',
        type: 'URL',
        url: 'https://bsky.app/profile/chrisshank.com/post/3mgbcmyvguc25',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge7j4eyfk2i',
        cardContent: {
          url: 'https://bsky.app/profile/chrisshank.com/post/3mgbcmyvguc25',
          title: '𝕮 (@chrisshank.com)',
          description:
            'This is a radically different idea than the advocacy I’ve seen for “data portability” and ”data sovereignty”. It’s a *restructuring* of power rather than small adjustments to existing structures.  atproto and local-first, both in their own ways, demonstrate what such a restructuring can look like.  [contains quote post or other embedded content]',
          author: '𝕮 (@chrisshank.com)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:56:55.336Z',
        updatedAt: '2026-03-06T01:56:55.336Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '729d26e6-2261-41f7-ae64-6abf0ed9c6d9',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '135105bc-34a3-4d5c-ad3a-09b67fc12a09',
        type: 'URL',
        url: 'https://alex-bsky.leaflet.pub/3mge5vds2ok26',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge7a5pqmw2v',
        cardContent: {
          url: 'https://alex-bsky.leaflet.pub/3mge5vds2ok26',
          title: "And I was afraid I wouldn't have anything to blog this week! - Alex's Blog",
          description:
            'Yup— this is a silly edge case we created because of requirements at the T&S level and at the protocol level, which we obviously need to solve at the app level by making this impossible to do unintentionally. Sorry for the unforced error here! Will be fixed soon.',
          siteName: 'alex-bsky.leaflet.pub',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:51:54.528Z',
        updatedAt: '2026-03-06T01:51:54.528Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '045cf8ae-a07e-4c3b-b889-135cf5398b71',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '8eaef874-22fe-42f3-b202-1227b998b4a4',
        type: 'URL',
        url: 'https://www.xptracker.app/blog/post/a-vision-for-portable-career-data',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge73pcklc2n',
        cardContent: {
          url: 'https://www.xptracker.app/blog/post/a-vision-for-portable-career-data',
          title: 'xptracker.app',
          description: "Create a custom, professional resume in seconds with xptracker's dynamic resume builder.",
          siteName: 'xptracker',
          imageUrl: 'http://cdn.xptracker.app/images/og-icon.jpg',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:49:25.349Z',
        updatedAt: '2026-03-06T01:49:25.481Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'b66addf4-10a5-4181-8736-3ee63288d80a',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '1f425be5-dff4-4898-a864-44c684f2bb14',
        type: 'URL',
        url: 'https://blog.muni.town/roomy-events-via-openmeet/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge72pvtxc2c',
        cardContent: {
          url: 'https://blog.muni.town/roomy-events-via-openmeet/',
          title: 'Roomy Events, by OpenMeet',
          description:
            'While Roomy is now quitely operational with a growing handful of pilot spaces, before we make a grander reveal about that particular milestone we have another exciting Report from the Atmosphere to share in the meantime.   Events for organizing  Events planning is an essential affordance in the world of organizing,',
          author: 'Erlend Sogge Heggen',
          siteName: 'Muni Blog',
          imageUrl: 'https://blog.muni.town/content/images/2026/03/Skjermbilde-2026-03-05-131408.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:48:52.280Z',
        updatedAt: '2026-03-06T01:48:52.405Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '88a41764-d192-4406-ad72-ca8fe32b8486',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '06719129-861a-4bd6-ba2a-711ba879960e',
        type: 'URL',
        url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge6oihea72c',
        cardContent: {
          url: 'https://bsky.app/profile/atprotocol.dev/post/3mge5bulsdk2n',
          title: 'AT Protocol Community (@atprotocol.dev)',
          description:
            'Thank you to Google @opensource.google  for joining #AtmosphereConf as a major sponsor! We appreciate your support! https://news.atmosphereconf.org/3mge5bs4n522n',
          author: 'AT Protocol Community (@atprotocol.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:lehcqqkwzcwvjvw66uthu5oq/bafkreicorvrpserhlscqioyb2imfeqrivotnr7hryl36nkole65pyghlym@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 3,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:42:02.140Z',
        updatedAt: '2026-03-06T01:42:02.140Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'b06e3cf8-c168-4836-95c1-eef656a985be',
          text: '#precipitation',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '33d23fc8-ee2d-4ea8-ae40-09d6cb1745b2',
        type: 'URL',
        url: 'https://bsky.app/profile/atproto.science/post/3mg3hxqgn6c2h',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge6khrpau2m',
        cardContent: {
          url: 'https://bsky.app/profile/atproto.science/post/3mg3hxqgn6c2h',
          title: 'ATProto Science (@atproto.science)',
          description:
            "The agenda for #ATScience is up! Check out the speaker list and full schedule below 👇  The range and quality of proposals we received really exceeded our expectations - thanks to everyone who submitted something!   March 27, Vancouver - can't wait to see you there ✨  Sessions include \u003E https://atproto.science/events/atmosphere2026/",
          author: 'ATProto Science (@atproto.science)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:nncebyouba4ex3775syiyvjy/bafkreiggscchrj46s542facaxzk6wbyj353seaoekznkhnj3m7htatd2y4@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:39:46.801Z',
        updatedAt: '2026-03-06T01:39:47.032Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '33b5e7a6-87c7-4b65-8213-6bd8951501fc',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '0ae8414d-cd8d-435b-a410-dc06c58b38fd',
        type: 'URL',
        url: 'https://blog.puzzmo.com/posts/2026/03/02/atproto/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge6ixrpcx2z',
        cardContent: {
          url: 'https://blog.puzzmo.com/posts/2026/03/02/atproto/',
          title: 'Wrangling atproto + Bluesky for Puzzmo.com',
          description:
            'Catch-up If you want the end-user perspective of what we have shipped read: Bluesky on Puzzmo. The TLDR: We have Bluesky follower sync We have a labeler which sets labels so you can see other Puzzmonauts on Bluesky We store your steak data in your Bluesky account We post the Cross|word midi dailies to our Bluesky account But getting to this feature set was not a linear path and I think it’s interesting to both cover the autobiographical reasons for why these exist, and the technical foundations so that more folks can consider what it means to interact with the Atmosphere.',
          author: 'Puzzmo Blog',
          siteName: 'blog.puzzmo.com',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:38:56.686Z',
        updatedAt: '2026-03-06T01:38:56.815Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'a8c82eea-f6c5-4053-a042-4d6abfaa44ba',
        type: 'URL',
        url: 'https://bsky.app/profile/ronentk.me/post/3mfrp6tovy22g',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge5y2567e2f',
        cardContent: {
          url: 'https://bsky.app/profile/ronentk.me/post/3mfrp6tovy22g',
          title: 'Ronen Tamari (@ronentk.me)',
          description:
            'Can everyone building on atproto please answer this question? 😇  [contains quote post or other embedded content]',
          author: 'Ronen Tamari (@ronentk.me)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:rtf3bjc3w2yn4syxtm4r7jt2/bafkreifrx34xnv4hkj563ntmts7entykpata27nuy6ft3hk2xzsschns6m@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:29:28.811Z',
        updatedAt: '2026-03-06T01:29:28.811Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '371c65df-bf21-4e9a-8a0c-2da0b258117e',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'ea834fed-661a-4fef-b279-b7e497da993e',
        type: 'URL',
        url: 'https://openmeet.net/cross-app-authentication-atproto',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge4wdx5jv26',
        cardContent: {
          url: 'https://openmeet.net/cross-app-authentication-atproto',
          title: 'Cross-App Authentication on AT Protocol: How Roomy and OpenMeet Share Identity',
          description:
            'The free, open-source alternative to Meetup. Create groups and events for your community — no fees, no ads, community-owned forever.',
          siteName: 'OpenMeet',
          imageUrl: 'https://openmeet.net/_astro/janke-laskowski-rVnPgM31JGw-unsplash.C6G1qS7G_2sUiMV.webp',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 5,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:10:38.337Z',
        updatedAt: '2026-03-06T01:10:38.337Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '55368c33-5f8b-4f98-aae6-b3ad6f7916be',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'a2c4eef7-0bf9-448e-8abb-631086af43de',
        type: 'URL',
        url: 'https://platform.openmeet.net/events/cincinnati-regional-at-protocol-meetup-rno3ui',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge4exjjk62m',
        cardContent: {
          url: 'https://platform.openmeet.net/events/cincinnati-regional-at-protocol-meetup-rno3ui',
          title: 'Cincinnati Regional AT Protocol Meetup',
          description:
            'Mon, Apr 13, 11:00 AM EDT · 2005, Madison Road, O’Bryonville, Evanston, Cincinnati, Hamilton County, Ohio, 45208, United States  Spring time meet to gather the regional ATprotocol enthusiasts. Locatio',
          author: 'Tom Scanlan',
          siteName: 'OpenMeet',
          imageUrl: 'https://ds1xtylbemsat.cloudfront.net/lsdfaopkljdfs/52ddfd3a1ae377e239783.jpg',
          type: 'event',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-06T01:00:54.364Z',
        updatedAt: '2026-03-06T01:00:54.364Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'ae4a4850-fd55-46db-b306-2ed00ed94d8b',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '1789786a-e234-4811-9903-bb34c4983f30',
        type: 'URL',
        url: 'https://bsky.app/profile/mackuba.eu/post/3mgd2ka6kxs2i',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mge2htbxp526',
        cardContent: {
          url: 'https://bsky.app/profile/mackuba.eu/post/3mgd2ka6kxs2i',
          title: 'Kuba Suder 🇵🇱🇺🇦 (@mackuba.eu)',
          description:
            'Around 0.5% of weekly active users are on independent PDSes right now, 1.5% if you count @ap.brid.gy - honestly more than I expected 🙂 (blue.mackuba.eu/stats/)  [contains quote post or other embedded content]',
          author: 'Kuba Suder 🇵🇱🇺🇦 (@mackuba.eu)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:oio4hkxaop4ao4wz2pp3f4cr/bafkreidcvmjwmk24rfnmdwgcnwx7i746revfkvvmtknemrr3uc4pjqmbgu@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-06T00:26:43.752Z',
        updatedAt: '2026-03-06T00:26:43.752Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '7c9d8e31-e815-4b07-a383-d9eac8426a56',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'bbafaa2d-d64c-42dc-81d2-84d0fdd68157',
        type: 'URL',
        url: 'https://bsky.app/profile/edhagen.net/post/3mgd4wkg7j22w',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgdydodbkm2c',
        cardContent: {
          url: 'https://bsky.app/profile/edhagen.net/post/3mgd4wkg7j22w',
          title: 'Ed Hagen (@edhagen.net)',
          description:
            'Wish there was a better academic publishing system? Bluesky and its underlying ATProto technology, along with services like @chive.pub and the broader @atproto.science ecosystem, could do the job. #AcademicSky 🧪 https://leaflet.pub/2f431faf-c125-4d34-ac52-e41a251da4d5  [contains quote post or other embedded content]',
          author: 'Ed Hagen (@edhagen.net)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:wadfbchvgyngydxdhms5fvq6/bafkreicymgubeq7pd6ul2ihndcer4k22zvpx674o6eqsrqfglpynb7hj4y@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-05T23:48:35.873Z',
        updatedAt: '2026-03-05T23:48:35.873Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '2569f2a5-6e22-4f2f-a2f0-872079cb31ed',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '98323041-8882-488f-96d1-a7c0fb343f20',
        type: 'URL',
        url: 'https://connectedplaces.online/reports/fr156-share-where/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgdszmlvyz2m',
        cardContent: {
          url: 'https://connectedplaces.online/reports/fr156-share-where/',
          title: 'FR#156 – Share Where?',
          description: "On Mastodon's new Share button, and protocol ownership.",
          author: 'Laurens Hof',
          siteName: 'connectedplaces.online',
          imageUrl: 'https://connectedplaces.online/wp-content/uploads/2026/02/20250706-17--764x400.jpg',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-05T22:13:30.008Z',
        updatedAt: '2026-03-05T22:13:30.008Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '97a265cd-2b2b-4bf4-bbdf-493a0ae2d1ea',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '36cdedf3-d718-4fda-beda-8e5b3a6fd441',
        type: 'URL',
        url: 'https://www.xptracker.app/blog/post/a-vision-for-portable-career-data',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mgddy2qysp2z',
        cardContent: {
          url: 'https://www.xptracker.app/blog/post/a-vision-for-portable-career-data',
          title: 'xptracker.app',
          description: "Create a custom, professional resume in seconds with xptracker's dynamic resume builder.",
          siteName: 'xptracker',
          imageUrl: 'http://cdn.xptracker.app/images/og-icon.jpg',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-05T17:44:11.727Z',
        updatedAt: '2026-03-05T17:44:11.727Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: 'cdc424c9-40c2-4528-aa84-dc3809a4553a',
        type: 'URL',
        url: 'https://bsky.app/profile/edouard.paris/post/3mgd6krs2vs2f',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgda3vzu7z2z',
        cardContent: {
          url: 'https://bsky.app/profile/edouard.paris/post/3mgd6krs2vs2f',
          title: 'Édouard 🧣🐱🫖 (@edouard.paris)',
          description:
            'So please join and test matrix.atproto.fr using your Bluesky/Blacksky/Eurosky handle, your account will have your did as ID and your profile picture.',
          author: 'Édouard 🧣🐱🫖 (@edouard.paris)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:sl7e2yuycnqjk24jdjmeuidn/bafkreicu26dngge573rxtej5kdvr2vbfzpp3vpwzxg5zct6zawspj3kjfy@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-05T16:34:46.441Z',
        updatedAt: '2026-03-05T16:34:46.441Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '726137fe-ed4b-4bec-af24-9c5436908755',
        type: 'URL',
        url: 'https://blog.muni.town/roomy-events-via-openmeet/',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mgczph6jn62z',
        cardContent: {
          url: 'https://blog.muni.town/roomy-events-via-openmeet/',
          title: 'Roomy Events, by OpenMeet',
          description:
            'While Roomy is now quitely operational with a growing handful of pilot spaces, before we make a grander reveal about that particular milestone we have another exciting Report from the Atmosphere to share in the meantime.   Events for organizing  Events planning is an essential affordance in the world of organizing,',
          author: 'Erlend Sogge Heggen',
          siteName: 'Muni Blog',
          imageUrl: 'https://blog.muni.town/content/images/2026/03/Skjermbilde-2026-03-05-131408.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-05T14:40:25.829Z',
        updatedAt: '2026-03-05T14:40:25.829Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: 'ab273093-b02c-43d2-8847-f32a63528c87',
        type: 'URL',
        url: 'https://openmeet.net/cross-app-authentication-atproto',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mgczj5zibw2x',
        cardContent: {
          url: 'https://openmeet.net/cross-app-authentication-atproto',
          title: 'Cross-App Authentication on AT Protocol: How Roomy and OpenMeet Share Identity',
          description:
            'The free, open-source alternative to Meetup. Create groups and events for your community — no fees, no ads, community-owned forever.',
          siteName: 'OpenMeet',
          imageUrl: 'https://openmeet.net/_astro/janke-laskowski-rVnPgM31JGw-unsplash.C6G1qS7G_2sUiMV.webp',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 5,
        urlInLibrary: true,
        createdAt: '2026-03-05T14:36:54.946Z',
        updatedAt: '2026-03-05T14:36:54.946Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: '74fc38a3-9838-4c70-bdda-0367191174ee',
        type: 'URL',
        url: 'https://freeq.at/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgbo24hxak22',
        cardContent: {
          url: 'https://freeq.at/',
          title: 'freeq — IRC with identity',
          description:
            'IRC server with AT Protocol (Bluesky) identity authentication. Connect with any IRC client, authenticate with your Bluesky account.',
          siteName: 'freeq.at',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-05T01:38:58.224Z',
        updatedAt: '2026-03-05T01:38:58.224Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '5a5ea389-c843-47aa-a7c4-40cd5a665792',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'a6f822b3-da16-4f1d-8665-13b4342f9fd4',
        type: 'URL',
        url: 'https://matlfb.pckt.blog/wsocial-could-change-everything-gyxk55y',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgbih2lvtw2i',
        cardContent: {
          url: 'https://matlfb.pckt.blog/wsocial-could-change-everything-gyxk55y',
          title: 'WSocial could change everything - matlfb.com',
          description:
            'In early 2026, the European Union announced its own Twitter-like platform called WSocial. The most surprising part is that it is expected to be a fork of Blu...',
          author: 'matlfb.com',
          siteName: 'matlfb.com',
          imageUrl:
            'https://pckt-blog-media.s3.us-east-2.amazonaws.com/og_image/b28df397-fa6c-416f-a8a0-1564056f5592/wsocial-could-change-everything-gyxk55y-og-2026-03-04-20-55-56.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T23:58:50.536Z',
        updatedAt: '2026-03-04T23:58:50.536Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'b3f30842-77de-43cb-8888-8b82c899777d',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '77e378ff-4de2-40c4-8c13-ffa9ce3ffa0d',
        type: 'URL',
        url: 'https://bsky.app/profile/jackvalinsky.com/post/3mgbafe66vs2w',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgbaqugbge2k',
        cardContent: {
          url: 'https://bsky.app/profile/jackvalinsky.com/post/3mgbafe66vs2w',
          title: 'Jack (@jackvalinsky.com)',
          description:
            'This is probably one of the most important issues in terms of labor, tech, UX, etc that the Atmosphere needs to solve (decentralized moderation). I would invite people to pay attention to what the @blackskyweb.xyz team and its community are doing and take notes.  [contains quote post or other embedded content]',
          author: 'Jack (@jackvalinsky.com)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:qpdjl22sgfejceds2ibabye6/bafkreig4e2ay3xkugq4fakrhcp6mmjmq2zpjviu76jzy6m5iqvxtpp4t2m@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T21:41:09.952Z',
        updatedAt: '2026-03-04T21:41:09.952Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '2c2f2ab1-8b9d-45b5-884e-38f5389b8b11',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'f108a26e-15bb-4a15-beae-8790cb88a20c',
        type: 'URL',
        url: 'https://graze.leaflet.pub/3mgascfb6uc2e',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgazvkdcge2i',
        cardContent: {
          url: 'https://graze.leaflet.pub/3mgascfb6uc2e',
          title: 'For You, For Everyone - Graze Newsletter',
          description:
            'How Graze built a "composable personalization" engine for the open social web — and why it matters right now.',
          siteName: 'graze.leaflet.pub',
          imageUrl:
            'https://leaflet.pub/lish/did%253Aplc%253Ai6y3jdklpvkjvynvsrnqfdoq/3lwrpf3vw222v/3mgascfb6uc2e/opengraph-image?e2bb7203df6d3028',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T19:38:30.223Z',
        updatedAt: '2026-03-04T19:38:30.224Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '5ada789a-38cd-41ca-9a0a-8f1c8505c34d',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'fb529d8d-7a50-410c-9032-98bb0dc8d9b5',
        type: 'URL',
        url: 'https://bsky.app/profile/did:plc:hu2jmpvtlecuwqnosnloplx6/post/3mf33eawpvs2t',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgat3zlvxn2m',
        cardContent: {
          url: 'https://bsky.app/profile/did:plc:hu2jmpvtlecuwqnosnloplx6/post/3mf33eawpvs2t',
          title: 'Lyre Calliope 🧭✨ (@captaincalliope.blue)',
          description:
            "This is a call to action! If you're interested in the future of the ATproto ecosystem and want to help shape it, click through to the announcement for info on how to get involved.  This is a large effort that's been cooking since December, and I'm excited to be a part of this initiative!  [contains quote post or other embedded content]",
          author: 'Lyre Calliope 🧭✨ (@captaincalliope.blue)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:hu2jmpvtlecuwqnosnloplx6/bafkreibmf27a7ju4bdfamv4xxszl5w7kqgapnz237y53f2xgoolcwjrnwy@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-04T17:36:51.775Z',
        updatedAt: '2026-03-04T17:36:51.957Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'be5ffd32-4229-4dd8-97f5-bc90f826116b',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '91034928-5c51-49ee-813d-f01b78fd75a8',
        type: 'URL',
        url: 'https://bsky.app/profile/knowtheory.net/post/3mgapkwdu232c',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mgat2452sc2c',
        cardContent: {
          url: 'https://bsky.app/profile/knowtheory.net/post/3mgapkwdu232c',
          title: 'Ted Han★ 韓聖安 (@knowtheory.net)',
          description:
            "My recollection of this is that even if you just pop a new ATProto account into existence and start spitting out `app.bsky.feed.post` records, they don't show up unless you actually go through a Bluesky onboarding & agreeing to ToS, so they should have an email for you through that process.",
          author: 'Ted Han★ 韓聖安 (@knowtheory.net)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:l5yz32nydpebjlcdfgycmf3x/bafkreigk5n6qtizmimpuj3z25tlclithafcu6bkpax5xyn2kge233jclji@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T17:35:46.376Z',
        updatedAt: '2026-03-04T17:35:46.376Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '44f94495-53f5-4af1-beb9-037e5182b852',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'b5a5acbf-d7ce-490d-aeab-0efcf60f0733',
        type: 'URL',
        url: 'https://www.pfrazee.com/blog/practical-decentralization',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mfpcjxqm4w2c',
        cardContent: {
          url: 'https://www.pfrazee.com/blog/practical-decentralization',
          title: 'Practical Decentralization',
          description:
            'The point of decentralization is to guarantee the rights of individuals and communities on the Internet. Pulling that off is a balancing act between practicality and ideology.',
          author: 'Paul Frazee',
          siteName: "Paul's Dev Notes",
          imageUrl: 'https://pfrazee.com/static/images/practical-decentralization/card.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 11,
        urlInLibrary: true,
        createdAt: '2026-02-25T18:25:10.933Z',
        updatedAt: '2026-02-25T18:25:10.933Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '17999cc1-fa7f-4f56-885a-c0d6ad85fe51',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '680ceeb3-c48c-46fa-9569-1290e0631867',
        type: 'URL',
        url: 'https://bnewbold.leaflet.pub/3mg25i5na5c2a',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg7qqgr4j22g',
        cardContent: {
          url: 'https://bnewbold.leaflet.pub/3mg25i5na5c2a',
          title: 'Blob AT-URIs - at:// pizza thoughts',
          description: 'mini-proposal for referencing atproto blobs in AT-URIs',
          siteName: 'bnewbold.leaflet.pub',
          imageUrl:
            'https://leaflet.pub/lish/did%253Aplc%253A44ybard66vv44zksje25o7dz/3m2x76zrtrs23/3mg25i5na5c2a/opengraph-image?e2bb7203df6d3028',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-04T07:21:56.184Z',
        updatedAt: '2026-03-04T07:21:56.184Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'fc7d4e29-f5f3-4ee4-b60a-2fe7eeb0d4a4',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'cdcef215-e7e0-4c81-996b-1c3f213ada19',
        type: 'URL',
        url: 'https://bsky.app/profile/orta.io/post/3mg6pjhzp322n',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg7qixrsxq2i',
        cardContent: {
          url: 'https://bsky.app/profile/orta.io/post/3mg6pjhzp322n',
          title: 'Orta Therox (@orta.io)',
          description:
            "Folks, this isn't some cute side-project where you can just switch out tens of thousands of paying users and force them to use atproto  It's a nice idea, but those are the sort of things only possible on new early stage projects",
          author: 'Orta Therox (@orta.io)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:t732otzqvkch7zz5d37537ry/bafkreih6a7fjvv7o3pup6lqoj6od2cod3zxgm2p2gg67vm6rammbfbb5ri@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T07:17:45.335Z',
        updatedAt: '2026-03-04T07:17:45.335Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '3ffa7125-8321-4d4d-8223-61f9802db8c1',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'ac337e0d-cbc2-4419-9403-5b4483075f14',
        type: 'URL',
        url: 'https://bsky.app/profile/erlend.sh/post/3mg7q6soc2k2d',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg7qdt7f3y2m',
        cardContent: {
          url: 'https://bsky.app/profile/erlend.sh/post/3mg7q6soc2k2d',
          title: 'Erlend Sogge Heggen (@erlend.sh)',
          description:
            'Any other atproto app devs run into this UX snafu?  User already has a bsky account; uses it to login to your app.  User was only logged in to bsky.app, not bsky.social and doesn’t have a password saved there.  User is very confused why their browser doesn’t remember their bsky password.',
          author: 'Erlend Sogge Heggen (@erlend.sh)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:ad5bwszsc5m5jpj2sfa6uzjk/bafkreidvf7osmk6mo3sfmrnval24yaql4u5ak5g47ejencf7tzy7tawaou@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T07:14:52.869Z',
        updatedAt: '2026-03-04T07:14:52.869Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'bc385176-248d-49f2-8b16-85752d47d426',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'a55b66b8-50b3-4f2e-9aad-06747934a55e',
        type: 'URL',
        url: 'https://bsky.app/profile/atproto.com/post/3mg6uscbrd223',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg7ewlqcro2i',
        cardContent: {
          url: 'https://bsky.app/profile/atproto.com/post/3mg6uscbrd223',
          title: 'AT Protocol Developers (@atproto.com)',
          description:
            'XRPC requests between atproto servers are authenticated using JWTs. There are some inconsistencies in how OAuth permissions, PDS proxy headers, and JWTs all represent the "audience" of these tokens.  This proposal gives background and describes a rough solution.  Looking for rapid feedback! https://github.com/bluesky-social/proposals/tree/main/0013-service-auth-refs',
          author: 'AT Protocol Developers (@atproto.com)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:ewvi7nxzyoun6zhxrhs64oiz/bafkreiaihtwfr2d6mjfb6drzaze2gubqtst4ymiwxowqfxpsqxpnz2t33u@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T03:50:37.706Z',
        updatedAt: '2026-03-04T03:50:37.706Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'c6727d5f-18eb-474d-addb-1db75363ec24',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '70d51730-59ce-4701-bc62-38f4f80baa47',
        type: 'URL',
        url: 'https://bsky.app/profile/tunji.dev/post/3mg73n5hha2it',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg7eq5hdnm26',
        cardContent: {
          url: 'https://bsky.app/profile/tunji.dev/post/3mg73n5hha2it',
          title: 'TJ (@tunji.dev)',
          description: 'Perfect timing!',
          author: 'TJ (@tunji.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://video.bsky.app/watch/did%3Aplc%3A6q4y7p2wft3tncsffspts3m5/bafkreiaa6sjlv5rvuwzjnc76m7ylkd4ihd5kqoh3uib4jlrrmxu4i7pucq/thumbnail.jpg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T03:47:00.896Z',
        updatedAt: '2026-03-04T03:47:00.896Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'd4d5532b-2b82-4e12-8ad2-eacaf448d1ec',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '2e4bfdf7-10d6-49ad-b7c2-63bd8c757623',
        type: 'URL',
        url: 'https://bsky.app/profile/montoulieu.dev/post/3mf5jwjjvjk22',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg75ems4vm24',
        cardContent: {
          url: 'https://bsky.app/profile/montoulieu.dev/post/3mf5jwjjvjk22',
          title: 'Pieter Montoulieu (@montoulieu.dev)',
          description:
            'Ended up adjusting some audio levels for this.  Here is the full recording of the @aetheros.computer demo from earlier this week!  youtu.be/DxXlStm_D1s https://youtu.be/DxXlStm_D1s',
          author: 'Pieter Montoulieu (@montoulieu.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:e5zplwgiznavptdxhx5n2zlp/bafkreifdu3jo67sbzmqu44tt4r7aworx2kvwknaxa3obfhzsfccub3tpwu@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-04T01:35:18.650Z',
        updatedAt: '2026-03-04T01:35:18.651Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '0095334e-ee16-4cc1-858f-16ddc567d62f',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'e4a14df3-e9ec-4e3d-b364-a80f65406dd6',
        type: 'URL',
        url: 'https://bsky.app/profile/bmann.ca/post/3mg3ymlq6hs25',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6lfzd66m2m',
        cardContent: {
          url: 'https://bsky.app/profile/bmann.ca/post/3mg3ymlq6hs25',
          title: 'Boris (@bmann.ca)',
          description: 'Uhhh...the web based emoji picker on @bsky.app is... ...missing the goose emoji??????',
          author: 'Boris (@bmann.ca)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:2cxgdrgtsmrbqnjkwyplmp43/bafkreidskikmaaujnabavqse5b7vtpsxy5howphg745jhbrhu6wxhizs2a@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T20:13:58.102Z',
        updatedAt: '2026-03-03T20:13:58.102Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'c5ae6537-f697-422b-a31f-63756e25b456',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'dc9793c9-15fb-4c55-a2a4-cfbb9f64488e',
        type: 'URL',
        url: 'https://jakesimonds.leaflet.pub/3mg4rj2c2sc2c',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6kukudft2c',
        cardContent: {
          url: 'https://jakesimonds.leaflet.pub/3mg4rj2c2sc2c',
          title: "AT friends #7: @zzstoatzz.io (aka nate!)  - Jake Simonds's Blog",
          description: 'informal chats with people building cool stuff in the open social world',
          imageUrl:
            'https://leaflet.pub/lish/did%253Aplc%253Aaurnkk6uy6axy66uqaq6dqy6/3m6gjuzizxc27/3mg4rj2c2sc2c/opengraph-image?e2bb7203df6d3028',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T20:04:12.510Z',
        updatedAt: '2026-03-03T20:04:12.510Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'a95a47af-e12e-44ba-b86f-b799948e8d85',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '3e1d0fd2-7456-443a-b944-bb7a96273964',
        type: 'URL',
        url: 'https://bsky.app/profile/burrito.space/post/3mg2pvdgncc26',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6ksyb2yt2c',
        cardContent: {
          url: 'https://bsky.app/profile/burrito.space/post/3mg2pvdgncc26',
          title: 'dietrich (@burrito.space)',
          description:
            'Atproto Amsterdam!  At @internetarchive.eu!  This Thursday!  Small gathering for the first one, register here:  luma.com/1bsf9tj3  Interested more generally in atproto events in these parts in future? Sign up here:  https://smokesignal.events/did:plc:7r5c5jhtphcpkg3y55xu2y64/3mfz5xrmt6y2l  [contains quote post or other embedded content]',
          author: 'dietrich (@burrito.space)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:7r5c5jhtphcpkg3y55xu2y64/bafkreie77ie2fhawer5havzziex2ob4qrodacbghyhbwp4krnqkcda45qq@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T20:03:19.171Z',
        updatedAt: '2026-03-03T20:03:19.171Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '00e790b8-e09d-4e43-a0ef-c9a500f62367',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'c7a11a11-d5e8-4593-9230-5641a1aca127',
        type: 'URL',
        url: 'https://bsky.app/profile/atproto.science/post/3mg3hxqgn6c2h',
        uri: 'at://did:plc:6z5botgrc5vekq7j26xnvawq/network.cosmik.card/3mg6f3clro72n',
        cardContent: {
          url: 'https://bsky.app/profile/atproto.science/post/3mg3hxqgn6c2h',
          title: 'ATProto Science (@atproto.science)',
          description:
            "The agenda for #ATScience is up! Check out the speaker list and full schedule below 👇  The range and quality of proposals we received really exceeded our expectations - thanks to everyone who submitted something!   March 27, Vancouver - can't wait to see you there ✨  Sessions include \u003E https://atproto.science/events/atmosphere2026/",
          author: 'ATProto Science (@atproto.science)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:nncebyouba4ex3775syiyvjy/bafkreiggscchrj46s542facaxzk6wbyj353seaoekznkhnj3m7htatd2y4@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T18:20:36.028Z',
        updatedAt: '2026-03-03T18:20:36.028Z',
        authorId: 'did:plc:6z5botgrc5vekq7j26xnvawq',
        author: {
          id: 'did:plc:6z5botgrc5vekq7j26xnvawq',
          name: 'Wesley Finck',
          handle: 'wesleyfinck.org',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6z5botgrc5vekq7j26xnvawq/bafkreig3weniwt64x5rmau77bgqmpo26p6qy4tusdzfccreun44nvuaczq@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6z5botgrc5vekq7j26xnvawq/bafkreiemt24ngptpxlpcfg7njx22l3ltin7iz6tet6af4eaphoutvlvu3q@jpeg',
          description: 'technical co-founder & CTO @cosmik.network\nbuilding @semble.so',
          followsYou: true,
          followerCount: 14,
          followingCount: 17,
          followedCollectionsCount: 38,
        },
      },
      {
        id: '385c53ac-e1fc-4e07-88d3-d5a90d15e79c',
        type: 'URL',
        url: 'https://thread-viewer.pages.dev/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6du2pgdw26',
        cardContent: {
          url: 'https://thread-viewer.pages.dev/',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T17:58:39.175Z',
        updatedAt: '2026-03-03T17:58:39.175Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'c2fe0cdb-120f-4451-97ce-bf5db9a57cb5',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '0a29d34c-7701-4576-b735-5248ccbee16e',
        type: 'URL',
        url: 'https://atproto.com/blog/npmx-alpha-launch',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mg6dfgpmyl2x',
        cardContent: {
          url: 'https://atproto.com/blog/npmx-alpha-launch',
          title: 'Supporting the npmx Alpha Launch - AT Protocol',
          description:
            'The launch of npmx is an incredible showcase for how open source communities can build quickly on top of atproto.',
          siteName: 'AT Protocol',
          imageUrl: 'https://atproto.com/default-social-card.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T17:50:28.633Z',
        updatedAt: '2026-03-03T17:50:28.634Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: 'cbc0a3d4-a188-40b5-b742-0d50c7eca5d6',
        type: 'URL',
        url: 'https://piccalil.li/blog/finding-an-accessibility-first-culture-in-npmx/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6csgrzym2n',
        cardContent: {
          url: 'https://piccalil.li/blog/finding-an-accessibility-first-culture-in-npmx/',
          title: 'Finding an accessibility-first culture in npmx',
          description:
            'Today is the alpha release of npmx — an alternative browser for the npm registry. Abbey Perini joined early and soon discovered accessibility was a deep part of the culture, right from the start, which was both refreshing and incredibly productive.',
          author: '-From set.studio',
          siteName: 'Piccalilli',
          imageUrl: 'https://piccalil.li/images/social-share/npmx-alpha-launch.png',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T17:39:51.161Z',
        updatedAt: '2026-03-03T17:39:51.161Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '241cc87c-86d3-4867-9d3e-f7b41e2d16d3',
        type: 'URL',
        url: 'https://bsky.app/profile/orta.io/post/3mg5fvminpc2v',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6cka6omz2c',
        cardContent: {
          url: 'https://bsky.app/profile/orta.io/post/3mg5fvminpc2v',
          title: 'Orta Therox (@orta.io)',
          description:
            "Shipping today: @puzzmo.com is an @atproto.com app!  - We have published lexicons and the Cross|word midi deploying to @puzzmo.com's registry every day  - We have user streaks deploying to user registries if they Oauth connect too  Massive write-up: https://blog.puzzmo.com/posts/2026/03/02/atproto/",
          author: 'Orta Therox (@orta.io)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:t732otzqvkch7zz5d37537ry/bafkreiageg664qhoojbgjiyzdmf46svuyhojtoxk6bdxfypcz4lnapcdhi@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T17:35:15.888Z',
        updatedAt: '2026-03-03T17:35:15.888Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'b032e76d-964e-4be4-88c6-d5868e2cd842',
        type: 'URL',
        url: 'https://bsky.app/profile/npmx.dev/post/3mg5r55bdh22s',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg6c3s5ynx2m',
        cardContent: {
          url: 'https://bsky.app/profile/npmx.dev/post/3mg5r55bdh22s',
          title: 'npmx (@npmx.dev)',
          description:
            'npmx is now in alpha: this is our story, as told by our team and friends https://npmx.dev/blog/alpha-release',
          author: 'npmx (@npmx.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:u5zp7npt5kpueado77kuihyz/bafkreicwc2m2aiw2vu5hmwr5gql235fbtr42g7hpxvoirq2c66vucgacpi@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T17:27:11.104Z',
        updatedAt: '2026-03-03T17:27:11.104Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'ac92bafd-6723-400c-a540-a870f33510e9',
        type: 'URL',
        url: 'https://eclecticisms.leaflet.pub/3mfu4f2hz7c2x',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mg64z3ytfd2x',
        cardContent: {
          url: 'https://eclecticisms.leaflet.pub/3mfu4f2hz7c2x',
          title: "Rudy's Theory of Revolution  - Eclecticisms",
          description: 'Eclecticisms Conversations Series: Episode 001 - Interview with Rudy Fraser of Blacksky',
          siteName: 'eclecticisms.leaflet.pub',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-03T15:56:12.264Z',
        updatedAt: '2026-03-03T15:56:12.265Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: 'd036d983-2072-4d5f-90ef-cf894f698877',
        type: 'URL',
        url: 'https://blog.puzzmo.com/posts/2026/03/02/atproto/',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mg63vhfext2x',
        cardContent: {
          url: 'https://blog.puzzmo.com/posts/2026/03/02/atproto/',
          title: 'Wrangling atproto + Bluesky for Puzzmo.com',
          description:
            'Catch-up If you want the end-user perspective of what we have shipped read: Bluesky on Puzzmo. The TLDR: We have Bluesky follower sync We have a labeler which sets labels so you can see other Puzzmonauts on Bluesky We store your steak data in your Bluesky account We post the Cross|word midi dailies to our Bluesky account But getting to this feature set was not a linear path and I think it’s interesting to both cover the autobiographical reasons for why these exist, and the technical foundations so that more folks can consider what it means to interact with the Atmosphere.',
          author: 'Puzzmo Blog',
          siteName: 'blog.puzzmo.com',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-03T15:36:16.164Z',
        updatedAt: '2026-03-03T15:36:16.164Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: 'fa5e7458-ff7a-4031-a60b-2bf8a75f87ef',
        type: 'URL',
        url: 'https://bsky.app/profile/atprotocol.dev/post/3mg5w7ctat222',
        uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/network.cosmik.card/3mg62tjd2cd2x',
        cardContent: {
          url: 'https://bsky.app/profile/atprotocol.dev/post/3mg5w7ctat222',
          title: 'AT Protocol Community (@atprotocol.dev)',
          description:
            'We’ll be hosting members of the @npmx.dev community as speakers at #AtmosphereConf  @zeu.dev & @patak.cat are telling us of using atproto to add social features to npmx  news.atmosphereconf.org/3mg5b3zvktc2i https://news.atmosphereconf.org/3mg5b3zvktc2i',
          author: 'AT Protocol Community (@atprotocol.dev)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:lehcqqkwzcwvjvw66uthu5oq/bafkreicorvrpserhlscqioyb2imfeqrivotnr7hryl36nkole65pyghlym@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: false,
        createdAt: '2026-03-03T15:17:17.259Z',
        updatedAt: '2026-03-03T15:17:17.259Z',
        authorId: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
        author: {
          id: 'did:plc:6i6n57nrkq6xavqbdo6bvkqr',
          name: 'Ariel M. (she/her)',
          handle: 'byarielm.fyi',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreibtlayicksllwwp7lufgcjt35rtsaabef7eal6qylnchoscixjy7u@jpeg',
          description:
            'PhD candidate @ UBuffalo • NSF GRFP\nChemE doing computational systems biology\nMulti passionate bean with too many ideas\n🫶 Lover of cats, code & crafts',
          followsYou: false,
          followerCount: 4,
          followingCount: 0,
          followedCollectionsCount: 1,
        },
      },
      {
        id: '87cc6743-5c7d-43db-b885-a84707e76b46',
        type: 'URL',
        url: 'https://discourse.atprotocol.community/t/universal-profiles-on-the-open-social-web/344',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg5ehqgsix2m',
        cardContent: {
          url: 'https://discourse.atprotocol.community/t/universal-profiles-on-the-open-social-web/344',
          title: 'Universal profiles on the open social web',
          description:
            'One of the discussions we had during the community day ahead of Eurosky was about this notion of interchangeable user profiles in the Atmosphere / Open Social Web.  @laurenshof.online even recorded the entire conversation so maybe there’s a transcript I could clean up for us? Anyhow, here’s the gist of it.  Deferred profile Right now on roomy.space if you sign up with your existing Bluesky account, we will defer to that Bluesky profile for your profile in Roomy as well, essentially recognizing t...',
          siteName: 'ATProtocol Community',
          imageUrl:
            'https://discourse.atprotocol.community/uploads/default/original/1X/10981cfe13294bace2039b5c0a527d64a2f36c5b.png',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T08:36:59.797Z',
        updatedAt: '2026-03-03T08:36:59.797Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'efecc2ae-e9e4-42ae-b13e-fdbcc7e4f2f6',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'bbdcb14d-3b59-4550-84b7-96bbc7aded29',
        type: 'URL',
        url: 'https://discourse.atprotocol.community/t/i-made-another-lexicon-this-time-for-representing-plurality/633',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg5ef3chuo2i',
        cardContent: {
          url: 'https://discourse.atprotocol.community/t/i-made-another-lexicon-this-time-for-representing-plurality/633',
          title: 'I made another lexicon, this time for representing plurality',
          description:
            'After success with the pronoun lexicon, I wanted to build on that with something to try to address something that’s been difficult for me (us) personally on social media particularly: did/plurality representation.  Like when switching fronts, posting, interacting, etc, especially on bsky and other variants. Some plural systems use emojis to designate alters or members, and we’ve largely used those too. But it still felt limited in expression, and we believed there could be more for it, like avat...',
          siteName: 'ATProtocol Community',
          imageUrl:
            'https://discourse.atprotocol.community/uploads/default/original/1X/10981cfe13294bace2039b5c0a527d64a2f36c5b.png',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T08:35:30.681Z',
        updatedAt: '2026-03-03T08:35:30.681Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '2ebe6a30-6408-4f3c-8686-178253ed2f5e',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '8b545d8b-c8aa-44c9-b972-6a0f137664dc',
        type: 'URL',
        url: 'https://bsky.app/profile/blaine.bsky.social/post/3mfujd3lyps2b',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg53xjapg62w',
        cardContent: {
          url: 'https://bsky.app/profile/blaine.bsky.social/post/3mfujd3lyps2b',
          title: 'Blaine (@blaine.bsky.social)',
          description:
            'I\'m building on atproto because building infrastructure like "Drafts and Scheduled Posts for every atproto app" is easy as 1-2-3 and as cool as alf.  Announcing alf, the atproto Latency Fabric: https://leaflet.pub/p/did:plc:3vdrgzr2zybocs45yfhcr6ur/3mfuiu2yl4k2u https://media.tenor.com/wgBqHb94jkAAAAAC/tv-shows-gordon-shumway.gif?hh=498&ww=498',
          author: 'Blaine (@blaine.bsky.social)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:3vdrgzr2zybocs45yfhcr6ur/bafkreicfwbgmdwouweqhgqlwmvgwlotkv6pvfd2cptcesimvmeayddpvee@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T06:04:45.605Z',
        updatedAt: '2026-03-03T06:04:45.605Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '4fccb10c-2530-446b-86ca-8ca49b36ef44',
        type: 'URL',
        url: 'https://bsky.app/profile/captaincalliope.blue/post/3mfvgokzd722l',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg52xosaxs2m',
        cardContent: {
          url: 'https://bsky.app/profile/captaincalliope.blue/post/3mfvgokzd722l',
          title: 'Lyre Calliope 🧭✨ (@captaincalliope.blue)',
          description:
            "The disconnect I feel between the millions upon millions of dollars worth of value I see coming from dozens of people in and around thh atproto community vs the fact that it's practically all uncompensated volunteer work is beyond frustrating.",
          author: 'Lyre Calliope 🧭✨ (@captaincalliope.blue)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:hu2jmpvtlecuwqnosnloplx6/bafkreibmf27a7ju4bdfamv4xxszl5w7kqgapnz237y53f2xgoolcwjrnwy@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T05:46:57.674Z',
        updatedAt: '2026-03-03T05:46:57.674Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'dd2edf5f-7359-49e4-bde8-4ccaa1c9672e',
          text: '#precipitation',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'e4c5bfbf-6b80-4160-8597-d6c881d3f543',
        type: 'URL',
        url: 'https://bsky.app/profile/seqre.dev/post/3mg3rg7ill22r',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg52wylyob2c',
        cardContent: {
          url: 'https://bsky.app/profile/seqre.dev/post/3mg3rg7ill22r',
          title: "Marek 'seqre' Grzelak (@seqre.dev)",
          description:
            'I may have an idea for improving the ATProto funding situation, I came up with it literally two hours ago, so please be kind 😅  The idea consists of three components: app calculating ecosystem usage, split-funding system, and (optional) custom lexicons.  More in🧵below!',
          author: "Marek 'seqre' Grzelak (@seqre.dev)",
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:ismzbuk5gulhlif4ryudy4v3/bafkreiaflucdcoprvowgt75b5tcqreobbicmq63ywxvevcfognyxhifdzu@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T05:46:34.297Z',
        updatedAt: '2026-03-03T05:46:34.297Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'c0166892-e553-4d95-8547-036241cc6eea',
          text: '#precipitation',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'ecedd701-ff53-4e4a-9752-3a95be5e3dba',
        type: 'URL',
        url: 'https://bsky.app/profile/chronotope.aramzs.xyz/post/3mfxl32o7ck2u',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg4phcojno2k',
        cardContent: {
          url: 'https://bsky.app/profile/chronotope.aramzs.xyz/post/3mfxl32o7ck2u',
          title: 'Aram Zucker-Scharff (@chronotope.aramzs.xyz)',
          description:
            "I've heard feedback on the @markpub.at lexicon! Thanks to @bmann.ca @blaine.bsky.social @thisismissem.social and others who have given really useful comments. I've published a new version for comment that is still very simple, but has more room for flexibility. Let me know what you think! markpub.at https://markpub.at/",
          author: 'Aram Zucker-Scharff (@chronotope.aramzs.xyz)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:t5xmf33p5kqgkbznx22p7d7g/bafkreidvtakzkpojqlwcbxkcduytxzm4nvxvrl6rrysofdfmrl7aplu3xu@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T02:20:56.692Z',
        updatedAt: '2026-03-03T02:20:56.692Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '1e79e5a2-5241-4bbe-9bd8-70896e16095e',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '5bec5f1a-5e16-4d68-a569-b88e855b9da5',
        type: 'URL',
        url: 'https://baldemoto.leaflet.pub/3mg4axqagds24',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg4pbwv7442i',
        cardContent: {
          url: 'https://baldemoto.leaflet.pub/3mg4axqagds24',
          title: 'Composable Trust, Part 1: Communities Without Credible Exit - Eclectic Corvine Muses',
          description:
            'We guarantee that users aren’t subject to platforms. Yet communities are still subject to their stewards. Can we fix this?',
          siteName: 'baldemoto.leaflet.pub',
          imageUrl:
            'https://leaflet.pub/lish/did%253Aplc%253Ayzvkvbuv3fdwf2hoywb3tmvy/3m2uqozpdv22d/3mg4axqagds24/opengraph-image?e2bb7203df6d3028',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T02:17:56.437Z',
        updatedAt: '2026-03-03T02:17:56.437Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '50374faa-9148-4f0d-8992-6e8a2fa6a660',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'f86ad217-efed-4ee3-8fa9-438e7c90b9a0',
        type: 'URL',
        url: 'https://bsky.app/profile/ipv.sx/post/3mg4h4tncmk2l',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg4oozp4ir2f',
        cardContent: {
          url: 'https://bsky.app/profile/ipv.sx/post/3mg4h4tncmk2l',
          title: 'Richard Barnes (@ipv.sx)',
          description:
            '@pfrazee.com @bnewbold.net if y’all ever get tired of WebSockets for one-to-many distribution, MOQT might be able to help.   https://www.ietf.org/archive/id/draft-nandakumar-atproto-atom-00.html',
          author: 'Richard Barnes (@ipv.sx)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:43l77wm7hyxizh4atc2gnrnt/bafkreigm3go2hox2b7a4glaulcz7znmtgakmmmnto4gc53r7hx4c5ppl6e@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-03T02:07:21.905Z',
        updatedAt: '2026-03-03T02:07:21.905Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'e9394d05-6895-4da5-85e9-a34747359bdc',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '95b40cf8-1b75-41ba-837f-c0d910e61d45',
        type: 'URL',
        url: 'https://bsky.app/profile/quillmatiq.com/post/3mg3ywfyk6k2t',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg4mzorzu522',
        cardContent: {
          url: 'https://bsky.app/profile/quillmatiq.com/post/3mg3ywfyk6k2t',
          title: 'Anuj Ahooja (@quillmatiq.com)',
          description:
            "We could probably solve this on atproto with an Atmosphere(?) share button that's AppView agnostic. All the mechanisms are already there 🤔  [contains quote post or other embedded content]",
          author: 'Anuj Ahooja (@quillmatiq.com)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:xgvzy7ni6ig6ievcbls5jaxe/bafkreiaumjzoigdvnldguuxu3ytpzwglqgy3dckzg5cxwqcp5yjychrf4e@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-03T01:37:32.225Z',
        updatedAt: '2026-03-03T01:37:32.225Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'a86ab3e9-3d4e-4816-b66c-252fa52e2ca6',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'abf42dd6-b7e5-4e5c-b8c2-e47d4b87be14',
        type: 'URL',
        url: 'https://secrets.atmo.social/',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg47warskk2n',
        cardContent: {
          url: 'https://secrets.atmo.social/',
          title: 'timelocked secrets',
          description:
            'Encrypt messages that can only be decrypted after a specific time. Powered by drand timelock encryption and stored on your atproto PDS.',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:42:58.362Z',
        updatedAt: '2026-03-02T21:42:58.363Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '01c73e1e-41e8-4c82-9116-a3015912eada',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'cb862282-60bc-4f45-abce-7d3494c29b2d',
        type: 'URL',
        url: 'https://leaflet.pub/p/did:plc:3vdrgzr2zybocs45yfhcr6ur/3mfuiu2yl4k2u',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mfunwzanqx22',
        cardContent: {
          url: 'https://leaflet.pub/p/did:plc:3vdrgzr2zybocs45yfhcr6ur/3mfuiu2yl4k2u',
          title: 'atproto, meet alf',
          description: 'Announcing alf, the atproto Latency Fabric for all your draft and scheduled post needs.',
          siteName: 'leaflet.pub',
          imageUrl:
            'https://leaflet.pub/p/did%253Aplc%253A3vdrgzr2zybocs45yfhcr6ur/3mfuiu2yl4k2u/opengraph-image?4c8fe174a4beabea',
          type: 'link',
        },
        libraryCount: 1,
        urlLibraryCount: 3,
        urlInLibrary: true,
        createdAt: '2026-02-27T21:32:38.315Z',
        updatedAt: '2026-02-27T21:32:38.315Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '1eb0d884-a5e8-4735-abcf-d81b9639bf73',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '7b21e3a6-f50d-48be-86b5-a1920854b3c4',
        type: 'URL',
        url: 'https://smokesignal.events/did:plc:h3wpawnrlptr4534chevddo6/3mfuv26ekbj25',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg46pyfamu22',
        cardContent: {
          url: 'https://smokesignal.events/did:plc:h3wpawnrlptr4534chevddo6/3mfuv26ekbj25',
          title: 'atproto Los Angeles first meetup!!!',
          description:
            'LA! It’s time. We’re kicking off atproto LA with a banger of an event, right before everyone heads off to Atmosphereconf!!   We’re going to have some incredible guests straight from the atprotos ...',
          siteName: 'Smoke Signal',
          type: 'event',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:21:34.242Z',
        updatedAt: '2026-03-02T21:21:34.243Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'b4aa904a-0165-4847-964c-f09ee3b679b5',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '27ba708d-027b-4252-b346-3221904a8d82',
        type: 'URL',
        url: 'https://luma.com/nt1jel7h',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg46ogrouu2g',
        cardContent: {
          url: 'https://luma.com/nt1jel7h',
          title: 'ATProtocol Meetup hosted by Letta · Luma',
          description:
            "ATProtocol SF Meetup - March 2026 The Bay Area ATProtocol community is getting together for an evening of short talks and good conversation. This month we're…",
          siteName: 'luma.com',
          imageUrl:
            'https://og.luma.com/cdn-cgi/image/format=auto,fit=cover,dpr=1,anim=false,background=white,quality=75,width=800,height=419/api/event-one?calendar_avatar=https%3A%2F%2Fimages.lumacdn.com%2Fcalendars%2Fpz%2F477d02e7-822d-4212-9b4f-5339e8c68b24.png&calendar_name=Letta%20Meetup&color0=%23202020&color1=%23c9cdd1&color2=%23ff5533&host_avatar=https%3A%2F%2Fimages.lumacdn.com%2Favatars%2Fvn%2F54c23103-dcaa-4d99-a867-7216e9a7c7af&host_name=Cameron%20Pfiffer&img=https%3A%2F%2Fimages.lumacdn.com%2Fevent-covers%2F11%2F52894230-6935-4fc0-a5b7-7ece0234ff91.png&name=ATProtocol%20Meetup%20hosted%20by%20Letta&palette_neutral=%23202020%3A94.55%2C%23c9cdd1%3A3.34&palette_vibrant=%23ff5533%3A1.11',
          type: 'event',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:20:42.344Z',
        updatedAt: '2026-03-02T21:20:42.344Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'ec5885d4-35ef-4086-be18-20e981eacbe0',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '8f183a7e-0dfa-45e8-9259-63030450bf29',
        type: 'URL',
        url: 'https://eclecticisms.leaflet.pub/3mfu4f2hz7c2x',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg46ac2zxm2i',
        cardContent: {
          url: 'https://eclecticisms.leaflet.pub/3mfu4f2hz7c2x',
          title: "Rudy's Theory of Revolution  - Eclecticisms",
          description: 'Eclecticisms Conversations Series: Episode 001 - Interview with Rudy Fraser of Blacksky',
          siteName: 'eclecticisms.leaflet.pub',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 4,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:12:47.806Z',
        updatedAt: '2026-03-02T21:12:47.806Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '939252f0-143a-4fac-aef0-01f0ed7194e3',
          text: '#flock',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '12b0eaf9-9e0a-4cf8-a2fc-72f38ebe31f0',
        type: 'URL',
        url: 'https://bsky.app/profile/why.bsky.team/post/3mfhon6ss4k2g',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg45wlm6yz2c',
        cardContent: {
          url: 'https://bsky.app/profile/why.bsky.team/post/3mfhon6ss4k2g',
          title: 'Why (@why.bsky.team)',
          description: 'What do people think about secure enclave backed identity recovery tools?',
          author: 'Why (@why.bsky.team)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:vpkhqolt662uhesyj6nxm7ys/bafkreig67rindkhj6ll6iflqy4dbevgof7pwyciueec4ywl43kbteu3yge@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:07:22.036Z',
        updatedAt: '2026-03-02T21:07:22.036Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '2e8a0b3e-cc79-476e-8bd9-471917c186f6',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '5774d726-3567-4d8e-8cef-8ece6129094d',
        type: 'URL',
        url: 'https://bsky.app/profile/saewitz.com/post/3mg2bk2gb2s2v',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg45vguxpy26',
        cardContent: {
          url: 'https://bsky.app/profile/saewitz.com/post/3mg2bk2gb2s2v',
          title: 'Daniel Saewitz (@saewitz.com)',
          description:
            'built an atproto terminal ui for setting up alternative plc rotation keys. there are two types of keys.  hardware-based: no sync software-based: synced via icloud  is anyone interested in this? I could package it up and release it, though it needs a lot of UX work.  https://tangled.org/saewitz.com/plc-touch/',
          author: 'Daniel Saewitz (@saewitz.com)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:pppqzcp436xpufbu6luy5ysh/bafkreidaidzymjnil2sw57ukvmlbte3zzhdteqlvf2oyb3twlnwm4ewjiq@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T21:06:43.751Z',
        updatedAt: '2026-03-02T21:06:43.751Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '4687b0b4-ed7f-4b71-a1c2-fdb8473590d6',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'f956ff15-55f7-470f-a3c9-33633f7452bc',
        type: 'URL',
        url: 'https://bsky.app/profile/rmendes.net/post/3mg32glpbb62j',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg452ufabo2v',
        cardContent: {
          url: 'https://bsky.app/profile/rmendes.net/post/3mg32glpbb62j',
          title: 'Ricardo (@rmendes.net)',
          description:
            'Exploring the idea of self-hosting a Bluesky PDS alongside my Indiekit instance — turning it into a dual-protocol server that federates over both ActivityPub and AT Protocol simultaneously. Inspired by Wafrn’s approach, adapted to Indiekit’s plugin architecture and Cloudron deployment. The goal: ow… https://rmendes.net/notes/2026/03/02/1ff62',
          author: 'Ricardo (@rmendes.net)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:tk6bkjdozskzgb47umfelfpq/bafkreidy5pcrpjripn7pfblwshvjxlxkvuq4bysemjwv4fm5dxhvmaji5u@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:51:51.841Z',
        updatedAt: '2026-03-02T20:51:51.841Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'a58b79b4-2c69-4481-86f3-400c15699b4d',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '5100ad7f-30b7-4ff6-b705-70dbdd442584',
        type: 'URL',
        url: 'https://bsky.app/profile/byarielm.fyi/post/3mfxra22wyk2r',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg44wtrdoa2m',
        cardContent: {
          url: 'https://bsky.app/profile/byarielm.fyi/post/3mfxra22wyk2r',
          title: 'Ariel M. (she/her) (@byarielm.fyi)',
          description:
            "ladeeedaa learning things and uhhhhh... we really need a default profile lexicon that every account uses don't we",
          author: 'Ariel M. (she/her) (@byarielm.fyi)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:6i6n57nrkq6xavqbdo6bvkqr/bafkreiapb3zv3y5inccusd4cukl4dpi3hzijby6g2ave3jtexwh734ywji@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:49:36.983Z',
        updatedAt: '2026-03-02T20:49:36.983Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '4da2f50b-fdbc-4ce4-8016-804724a03ab3',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '67aa42db-dba7-4a29-b219-a55316c94f9c',
        type: 'URL',
        url: 'https://trezy.com/blog/atproto-profile-lexicon-generics',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg44rugpzd2v',
        cardContent: {
          url: 'https://trezy.com/blog/atproto-profile-lexicon-generics',
          title: 'ATProto Has a Profile Problem. Lexicon Generics Could Help.',
          description:
            "As the Atmosphere grows beyond Bluesky, assuming every user has a Bluesky profile won't hold up. A base profile sounds like the fix, but the UX gets weird fast. Lexicon generics — a pattern built from existing ATProto concepts — could make profile-type records discoverable and translatable across apps without flattening them into a single record.",
          siteName: 'TrezyCodes',
          imageUrl:
            'https://trezy.codes/api/og?title=ATProto+Has+a+Profile+Problem.+Lexicon+Generics+Could+Help.&image=https%3A%2F%2Fimages.ctfassets.net%2F6gqb05wxpzzi%2F1wgoL2DF3GIazKmRcKL782%2F0a7c91f419f341df59c4c50239a0f6f5%2Fuser-profiles-flat-illustration-for-mobile-app-2025-10-20-04-34-46-utc.gif',
          type: 'article',
        },
        libraryCount: 1,
        urlLibraryCount: 2,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:46:49.728Z',
        updatedAt: '2026-03-02T20:46:49.729Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '908e2656-35ce-4936-bf4b-a84d02bd7aa1',
          text: '#wind',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'bb6e267e-4a1d-4a40-814c-7042169d5068',
        type: 'URL',
        url: 'https://bsky.app/profile/nicolashenin.net/post/3mg3miuyqdc2s',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg43noykpm2k',
        cardContent: {
          url: 'https://bsky.app/profile/nicolashenin.net/post/3mg3miuyqdc2s',
          title: 'Nicolas Henin 🇪🇺💙💛 (@nicolashenin.net)',
          description:
            '💥 It took 72 hours to register the second thousand accounts on @eurosky.social  🎉  I expected more movement over the weekend, but apparently, people prefer to migrate during their working hours 😁',
          author: 'Nicolas Henin 🇪🇺💙💛 (@nicolashenin.net)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:2j7yh4reb36ouvuycscpak4u/bafkreicmtdft2kz7geq4oblm7wiqffgy66hcl3evzcw3e7bdjofqybc7xy@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:26:36.255Z',
        updatedAt: '2026-03-02T20:26:36.255Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'b10e8764-e0dd-4059-b5b4-cb6dff5d564c',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: '15da9787-6b31-4f14-81aa-f97a49d5ac10',
        type: 'URL',
        url: 'https://bsky.app/profile/blackskyweb.xyz/post/3mg3q6hkaxk2r',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg43lcux7k24',
        cardContent: {
          url: 'https://bsky.app/profile/blackskyweb.xyz/post/3mg3q6hkaxk2r',
          title: 'Blacksky Algorithms (@blackskyweb.xyz)',
          description:
            'The blacksky.community web application now uses our own API servers to load posts, timelines and profiles.  When data is missing (accounts on the edges of the network, outside of our primary community, etc) we leverage  @microcosm.blue https://blacksky.community',
          author: 'Blacksky Algorithms (@blackskyweb.xyz)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:kta7dqcqoamo5ixlajxbtjps/bafkreigd2bpfa6lhwlluahlc26ddzxme4s2jsdsejibxrt4mksbuv4kh3e@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 1,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:25:16.538Z',
        updatedAt: '2026-03-02T20:25:16.538Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: 'd79e1b66-507f-45fb-ac23-51f21b3c8cca',
          text: '#clouds',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
      {
        id: 'd69d90db-1fbf-4f63-96af-27644773cc70',
        type: 'URL',
        url: 'https://bsky.app/profile/tangled.org/post/3mg2y5qymx22c',
        uri: 'at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.card/3mg43kmldsi2i',
        cardContent: {
          url: 'https://bsky.app/profile/tangled.org/post/3mg2y5qymx22c',
          title: 'Tangled (@tangled.org)',
          description:
            "today, we're announcing our €3,8M ($4.5M) seed financing round, led by byFounders with participation from Bain Capital Crypto, Antler, Thomas Dohmke (former CEO of GitHub), Avery Pennarun (CEO of Tailscale) among other incredible angels.  read more on what's next: blog.tangled.org/seed https://blog.tangled.org/seed",
          author: 'Tangled (@tangled.org)',
          siteName: 'Bluesky Social',
          imageUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:wshs7t2adsemcrrd4snkeqli/bafkreif6z53z4ukqmdgwstspwh5asmhxheblcd2adisoccl4fflozc3kva@jpeg',
          type: 'social',
        },
        libraryCount: 1,
        urlLibraryCount: 3,
        urlInLibrary: true,
        createdAt: '2026-03-02T20:24:53.062Z',
        updatedAt: '2026-03-02T20:24:53.062Z',
        authorId: 'did:plc:zcanytzlaumjwgaopolw6wes',
        note: {
          id: '4bc7803c-6368-4606-8453-1d2a856fdb94',
          text: '#precipitation',
        },
        author: {
          id: 'did:plc:zcanytzlaumjwgaopolw6wes',
          name: '𝕮',
          handle: 'chrisshank.com',
          avatarUrl:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreiacmd5abfwzcnr63nvms2v6ecgtcbhrsr6dmz7mrhr4umqvkpc55i@jpeg',
          bannerUrl:
            'https://cdn.bsky.app/img/banner/plain/did:plc:zcanytzlaumjwgaopolw6wes/bafkreid2selh3qri7znhfmy26fdxqkpg4jilf2ktrggwa573ja2cdwywk4@jpeg',
          description:
            'seeding discontent in present-day computing\n\n\nlibcomp.org • @folkjs.org\n\n\nforaging the web: https://semble.so/profile/chrisshank.com',
          followerCount: 4,
          followingCount: 4,
          followedCollectionsCount: 0,
        },
      },
    ],
    cardCount: 67,
    followerCount: 13,
    createdAt: '2026-02-26T20:26:25.872Z',
    updatedAt: '2026-03-06T05:46:50.292Z',
    isFollowing: false,
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalCount: 67,
      hasMore: false,
      limit: 100,
    },
    sorting: {
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    },
  } as any;
}

const re = /#\w+/;
function extractTag(card: UrlCard): string {
  return card.note?.text?.match(re)?.[1] || '';
}

const newsCollection = await fetchCollection('chrisshank.com', '3mfrzrpx6fw26');
const groups = Object.groupBy(newsCollection.urlCards, extractTag);
const contributors = Object.entries(Object.groupBy(newsCollection.urlCards, (card) => card.author.handle))
  .sort((a, b) => b[1]!.length - a[1]!.length)
  .map(([handle]) => `@${handle}`)
  .join(', ');

console.log(newsCollection, groups, contributors);
