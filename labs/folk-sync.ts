import PartySocket from 'partysocket';

export class FolkSync extends HTMLElement {
  static tagName = 'folk-sync';

  #socket!: PartySocket;
  #subscribers = new Map<string, Set<(value: any) => void>>();

  connectedCallback() {
    const room = this.getAttribute('room');
    if (!room) {
      console.warn('FolkSync: No room specified, using "default"');
    }

    this.#socket = new PartySocket({
      host: 'folk-sync.orionreed.partykit.dev',
      room: room ?? 'default',
    });

    this.#socket.addEventListener('message', (event) => {
      try {
        const { id, property, value } = JSON.parse(event.data);
        if (!id || !property) {
          console.warn('FolkSync: Received malformed message', event.data);
          return;
        }
        const key = `${id}:${property}`;
        this.#subscribers.get(key)?.forEach((callback) => callback(value));
      } catch (e) {
        console.error('FolkSync: Failed to process message', e);
      }
    });
  }

  sync(elementId: string, property: string, value: any) {
    if (!this.#socket) {
      console.warn('FolkSync: Attempting to sync before socket connection');
      return;
    }
    if (!elementId) {
      console.error('FolkSync: Cannot sync element without ID');
      return;
    }
    this.#socket.send(JSON.stringify({ id: elementId, property, value }));
  }

  subscribe(elementId: string, property: string, callback: (value: any) => void) {
    if (!elementId) {
      console.error('FolkSync: Cannot subscribe without element ID');
      return;
    }
    const key = `${elementId}:${property}`;
    if (!this.#subscribers.has(key)) {
      this.#subscribers.set(key, new Set());
    }
    this.#subscribers.get(key)!.add(callback);
  }

  disconnectedCallback() {
    this.#socket?.close();
    this.#subscribers.clear();
  }
}

export function sync() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalSet = descriptor.set;

    descriptor.set = function (this: HTMLElement & { [key: string]: boolean }, value) {
      if (!this.id) {
        console.error('FolkSync: Element must have an ID to use @sync', this);
        originalSet?.call(this, value);
        return;
      }

      originalSet?.call(this, value);

      const syncElement = this.closest('folk-sync') as FolkSync;
      if (!syncElement) {
        console.warn('FolkSync: Element must be inside a <folk-sync> to sync', this);
        return;
      }

      // Set up subscription if we haven't already
      if (!this[`_sync_sub_${propertyKey}`]) {
        this[`_sync_sub_${propertyKey}`] = true;
        syncElement.subscribe(this.id, propertyKey, (newValue) => {
          originalSet?.call(this, newValue);
        });
      }

      syncElement.sync(this.id, propertyKey, value);
    };

    return descriptor;
  };
}
