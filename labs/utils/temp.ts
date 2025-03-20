import { header } from './header';

const qrtpHeader = header`QRTPB<indices:pair(/)>:<hash:fixed(16)><payload>`;
const encoded = qrtpHeader.encode({
  indices: [0, 555],
  hash: '1234567890',
  payload: 'some random payload',
});
// Output: QRTPB0/555:1234567890521523some random payload
const decoded = qrtpHeader.decode('QRTPB0/555:1234567890521523some random payload');
// output: { indices: [0, 555], hash: '1234567890', payload: 'some random payload' }
