export class KeyValueStore<Data> {
  #db: Promise<IDBDatabase>;
  #storeName;

  constructor(name = 'keyval-store') {
    this.#storeName = name;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.result.createObjectStore(name);

    this.#db = this.#promisifyRequest(request);
  }

  #promisifyRequest<T>(transaction: IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
      transaction.onsuccess = () => resolve(transaction.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  #promisifyTransaction(transaction: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  }

  #getStore(mode: 'readonly' | 'readwrite') {
    return this.#db.then((db) => db.transaction(this.#storeName, mode).objectStore(this.#storeName));
  }

  get(key: IDBValidKey): Promise<Data | undefined> {
    return this.#getStore('readonly').then((store) => this.#promisifyRequest(store.get(key)));
  }

  set(key: IDBValidKey, value: Data) {
    return this.#getStore('readwrite').then((store) => {
      store.put(value, key);
      return this.#promisifyTransaction(store.transaction);
    });
  }

  setMany(entries: [IDBValidKey, Data][]) {
    return this.#getStore('readwrite').then((store) => {
      entries.forEach((entry) => store.put(entry[1], entry[0]));
      return this.#promisifyTransaction(store.transaction);
    });
  }

  delete(key: IDBValidKey) {
    return this.#getStore('readwrite').then((store) => {
      store.delete(key);
      return this.#promisifyTransaction(store.transaction);
    });
  }

  clear() {
    return this.#getStore('readwrite').then((store) => {
      store.clear();
      return this.#promisifyTransaction(store.transaction);
    });
  }

  keys() {
    return this.#getStore('readwrite').then((store) => this.#promisifyRequest(store.getAllKeys()));
  }

  values(): Promise<Data[]> {
    return this.#getStore('readwrite').then((store) => this.#promisifyRequest(store.getAll()));
  }

  entries(): Promise<[IDBValidKey, Data][]> {
    return this.#getStore('readwrite').then((store) =>
      Promise.all([this.#promisifyRequest(store.getAllKeys()), this.#promisifyRequest(store.getAll())]).then(
        ([keys, values]) => keys.map((key, i) => [key, values[i]]),
      ),
    );
  }
}
