import { header } from './header';

const qrtpHeader = header('Q<indices:list-2>');
const encoded = qrtpHeader.encode({
  indices: ['ab', 'qw', 'wldfs'],
});
console.log({ encoded });
const decoded = qrtpHeader.decode('Q05552rs93jdh');
console.log({ decoded });
