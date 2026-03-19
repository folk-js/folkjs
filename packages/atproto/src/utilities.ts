import {
  AtUri,
  isValidDid,
  type AtUriString,
  type DidString,
  type HandleString,
  type NsidString,
  type RecordKeyString,
} from '@atproto/syntax';

const didCache = new Map<HandleString, DidString>();

export async function resolveDidFromHandle(handle: HandleString): Promise<DidString | null> {
  const did = didCache.get(handle);
  if (did !== undefined) return did;

  try {
    const url = new URL('https://slingshot.microcosm.blue/xrpc/com.atproto.identity.resolveHandle');
    url.searchParams.set('handle', handle);

    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Failed to resolve handle:`, handle);
      return null;
    }

    const { did } = await response.json();
    if (isValidDid(did)) {
      didCache.set(handle, did);
      return did;
    }
    return null;
  } catch (error) {
    console.error(handle, error);
    return null;
  }
}

const recordCache = new Map<AtUriString, AnyATRecord>();

// https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ahdhoaan3xa3jiuq4fg4mefid&collection=app.bsky.feed.like&rkey=3lv4ouczo2b2a
export async function fetchRecord<R extends AnyATRecord = AnyATRecord>(atUri: AtUri | string): Promise<R | null> {
  try {
    if (typeof atUri === 'string') {
      atUri = new AtUri(atUri);
    }
    const uriString = atUri.toString();
    const record = recordCache.get(uriString);
    if (record !== undefined) return record as R;

    const url = new URL('https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord');
    url.searchParams.set('repo', atUri.did);
    url.searchParams.set('collection', atUri.collection);
    url.searchParams.set('rkey', atUri.rkey);

    const recordResponse = await fetch(url);

    if (!recordResponse.ok) {
      console.warn(`Failed to fetch record:`, atUri);
      return null;
    }

    const recordData = await recordResponse.json();

    recordCache.set(uriString, recordData);
    return recordData;
  } catch (error) {
    console.error(atUri, error);
    return null;
  }
}

interface BacklinkResponse {
  total: number;
  records: Backlink[];
  cursor: string;
}

interface Backlink {
  did: DidString;
  collection: NsidString;
  rkey: RecordKeyString;
}

// https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=at%3A%2F%2Fdid%3Aplc%3Azcanytzlaumjwgaopolw6wes%2Fnetwork.cosmik.collection%2F3mfrzrpx6fw26&source=network.cosmik.collectionLink%3Acollection.uri&limit=100
export async function fetchBacklinks(atUri: AtUri | string, source: NsidString, path: string): Promise<AnyATRecord[]> {
  try {
    if (typeof atUri === 'string') {
      atUri = new AtUri(atUri);
    }
    const url = new URL('https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks');
    url.searchParams.set('subject', atUri.toString());
    url.searchParams.set('source', source + ':' + path);
    url.searchParams.set('limit', '10');

    const recordResponse = await fetch(url);

    if (!recordResponse.ok) {
      console.warn(`Failed to fetch record:`, atUri);
      return [];
    }

    const response: BacklinkResponse = await recordResponse.json();
    const records = await Promise.all(
      response.records.map((bl) => fetchRecord(AtUri.make(bl.did, bl.collection, bl.rkey))),
    );
    return records.filter((record) => record !== null);
  } catch (error) {
    console.error(atUri, error);
    return [];
  }
}

export type AnyATRecord = {
  cid: string;
  uri: AtUriString;
  value: any;
};
