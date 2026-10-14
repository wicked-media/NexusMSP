/* Native React createRoot requires act; these are not Testing Library utilities. */
/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { StakeholderMapCard } from '../components/clients/ClientStudioWidgets';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }));
jest.mock('@/App', () => ({ API: '/api', useAuth: () => ({ token: 'test' }) }), { virtual: true });
jest.mock('@/components/ui/card', () => ({ Card: ({ children, ...props }) => <div {...props}>{children}</div> }), { virtual: true });
jest.mock('@/components/ui/button', () => ({ Button: ({ children, variant: _variant, size: _size, asChild, ...props }) => asChild ? children : <button {...props}>{children}</button> }), { virtual: true });
jest.mock('@/components/ui/input', () => ({ Input: props => <input {...props} /> }), { virtual: true });
jest.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }) => <label {...props}>{children}</label> }), { virtual: true });
jest.mock('@/components/ui/textarea', () => ({ Textarea: props => <textarea {...props} /> }), { virtual: true });
jest.mock('@/components/ui/dialog', () => ({ Dialog: ({ children, open }) => open ? <div>{children}</div> : null }), { virtual: true });
jest.mock('@/components/NexusWorkflowDialog', () => ({ children, footer }) => <section>{children}{footer}</section>, { virtual: true });
jest.mock('@/lib/serviceTierVisuals', () => ({}), { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let host;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('renders accountable stakeholder context from the selected client only', async () => {
  axios.get.mockResolvedValueOnce({
    data: [{
      id: 'stakeholder-1',
      name: 'Avery Chen',
      title: 'Chief Financial Officer',
      role: 'decision_maker',
      relationship_strength: 84,
      sentiment: 75,
      notes: 'Confirm commercial outcomes before renewal review.',
    }],
  });

  await act(async () => root.render(<StakeholderMapCard clientId="client-a" />));
  await act(async () => {});

  expect(axios.get).toHaveBeenCalledWith('/api/client-studio/client-a/stakeholders', expect.objectContaining({
    headers: { Authorization: 'Bearer test' },
  }));
  expect(host.textContent).toContain('Avery Chen');
  expect(host.textContent).toContain('decision maker');
  expect(host.textContent).toContain('Positive outlook');
  expect(host.textContent).toContain('Confirm commercial outcomes before renewal review.');
});

test('does not offer a saveable empty map after a load failure', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline'));

  await act(async () => root.render(<StakeholderMapCard clientId="client-a" />));
  await act(async () => {});

  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).toContain('Nothing has been changed. Retry before editing relationship information.');
  expect(host.textContent).not.toContain('No stakeholder context recorded');
});
