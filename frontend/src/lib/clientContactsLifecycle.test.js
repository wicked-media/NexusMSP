import fs from 'fs';
import path from 'path';
import vm from 'vm';

const source = fs.readFileSync(path.join(__dirname, '../pages/ClientsPage.jsx'), 'utf8');
const start = source.indexOf('function ClientContactsPanel(');
const logic = source.slice(start, source.indexOf('  if (loadError) return', start));

function harness(get, put = jest.fn(), { loading = false } = {}) {
  const setters = [], dependencies = [];
  const onCountChange = jest.fn();
  let stateIndex = 0;
  const toast = { error: jest.fn(), success: jest.fn() };
  const run = vm.runInNewContext(`${logic} return {load, makePrimary}; } ClientContactsPanel`, {
    useMemo: fn => fn(), useRef: value => ({ current: value }),
    useState: value => {
      const set = jest.fn();
      const initial = stateIndex++ === 1 ? loading : value;
      setters.push(set);
      return [initial, set];
    },
    useCallback: (fn, deps) => { dependencies.push(deps); return fn; }, useEffect: () => {},
    axios: { get, put }, API: '/api', toast,
  });
  return { ...run({ clientId: 'client', token: 'test', onCountChange }), setters, dependencies, onCountChange, toast };
}

test('contact count callback identity is not a fetch dependency', () => {
  const h = harness(jest.fn());
  expect(h.dependencies[0]).not.toContain(h.onCountChange);
});

test('a superseded contact request cannot replace the latest result', async () => {
  let resolveOld;
  const get = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ data: [{ id: 'current' }] });
  const h = harness(get);
  const old = h.load();
  await h.load();
  resolveOld({ data: [{ id: 'old' }] });
  await old;
  expect(h.setters[0]).toHaveBeenCalledTimes(1);
  expect(h.setters[0]).toHaveBeenCalledWith([{ id: 'current' }]);
  expect(h.onCountChange).toHaveBeenCalledTimes(1);
});

test('failed loads expose failure without replacing contacts with an empty success', async () => {
  const h = harness(jest.fn().mockRejectedValue(new Error('offline')));
  await h.load();
  expect(h.setters[0]).not.toHaveBeenCalled();
  expect(h.setters[6]).toHaveBeenLastCalledWith(true);
  expect(h.onCountChange).not.toHaveBeenCalled();
});

test('making a contact primary uses the scoped contact route then refreshes the card data', async () => {
  const put = jest.fn().mockResolvedValue({});
  const get = jest.fn().mockResolvedValue({ data: [{ id: 'contact-1', name: 'Ada Lovelace', is_primary: true }] });
  const h = harness(get, put);

  await h.makePrimary({ id: 'contact-1', name: 'Ada Lovelace', is_primary: false });

  expect(put).toHaveBeenCalledWith(
    '/api/clients/client/contacts/contact-1',
    { is_primary: true },
    { headers: { Authorization: 'Bearer test' } },
  );
  expect(h.toast.success).toHaveBeenCalledWith('Ada Lovelace is now the primary contact');
  expect(h.setters[0]).toHaveBeenCalledWith([{ id: 'contact-1', name: 'Ada Lovelace', is_primary: true }]);
  expect(h.onCountChange).toHaveBeenCalledWith(1);
});
