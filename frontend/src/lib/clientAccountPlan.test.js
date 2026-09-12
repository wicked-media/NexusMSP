/* Native React createRoot requires act; these are not Testing Library utilities. */
/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { AccountPlanCanvas } from '../components/clients/ClientStudioWidgets';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('@/App', () => ({ API: '/api', useAuth: () => ({ token: 'test' }) }), { virtual: true });
jest.mock('@/components/ui/card', () => ({ Card: ({ children, ...props }) => <div {...props}>{children}</div> }), { virtual: true });
jest.mock('@/components/ui/button', () => ({ Button: ({ children, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button> }), { virtual: true });
jest.mock('@/components/ui/input', () => ({ Input: props => <input {...props} /> }), { virtual: true });
jest.mock('@/components/ui/dialog', () => ({}), { virtual: true });
jest.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }) => <label {...props}>{children}</label> }), { virtual: true });
jest.mock('@/components/ui/textarea', () => ({ Textarea: props => <textarea {...props} /> }), { virtual: true });
jest.mock('@/components/NexusWorkflowDialog', () => ({ children }) => <div>{children}</div>, { virtual: true });
jest.mock('@/lib/serviceTierVisuals', () => ({}), { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let host, root;
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

test('a late response cannot populate another client account plan', async () => {
  let resolveOld;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ data: { goals: ['Current client goal'] } });
  await act(async () => root.render(<AccountPlanCanvas clientId="old" />));
  await act(async () => root.render(<AccountPlanCanvas clientId="current" />));
  await act(async () => resolveOld({ data: { goals: ['Wrong client goal'] } }));
  expect(host.querySelector('input').value).toBe('Current client goal');
  expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true);
});

test('load failure disables editing and exposes retry instead of an empty saveable plan', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<AccountPlanCanvas clientId="client" />));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="account-plan-save"]')).toBeNull();
  expect(host.textContent).toContain('Retry loading plan');
});

test('an existing plan cannot be replaced with a starter and double save is guarded', async () => {
  axios.get.mockResolvedValue({ data: { goals: ['Keep this'] } });
  let resolveSave;
  axios.post.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  await act(async () => root.render(<AccountPlanCanvas clientId="client" />));
  expect(host.querySelector('[data-testid="account-plan-ai-generate"]').disabled).toBe(true);
  const save = host.querySelector('[data-testid="account-plan-save"]');
  await act(async () => { save.click(); save.click(); });
  expect(axios.post).toHaveBeenCalledTimes(1);
  await act(async () => resolveSave({ data: { saved: true } }));
});
