import fs from 'fs';
import path from 'path';
import vm from 'vm';

const source = fs.readFileSync(path.join(__dirname, '../pages/ClientsPage.jsx'), 'utf8');
const groupSource = source.slice(source.indexOf('const CLIENT_WORKSPACE_GROUPS ='), source.indexOf('const CLIENT_TAB_VALUES ='));
const groups = vm.runInNewContext(`${groupSource}; CLIENT_WORKSPACE_GROUPS`, {
  Building2: null, Users: null, HardDrive: null, DollarSign: null, FileText: null, Activity: null,
});

test('CRM navigation keeps every existing client view once', () => {
  const tabs = groups.flatMap(group => group.tabs.map(tab => tab.value));
  expect(new Set(tabs).size).toBe(tabs.length);
  const panels = [...source.matchAll(/<TabsContent value="([^"]+)"/g)].map(match => match[1]);
  expect([...tabs].sort()).toEqual([...panels].sort());
});

test('six focused CRM groups lead to their primary workflow', () => {
  expect(groups.map(group => group.label)).toEqual(['Overview', 'People', 'Service', 'Billing', 'Sales & success', 'History']);
  expect(groups.find(group => group.id === 'people').tabs[0].value).toBe('contacts');
  expect(groups.find(group => group.id === 'services').tabs[0].value).toBe('tickets');
  expect(groups.find(group => group.id === 'records').tabs[0].value).toBe('activity');
});

test('section navigation uses shared linked tabs instead of disconnected ARIA buttons', () => {
  const navigation = source.slice(source.indexOf('function ClientWorkspaceNavigation'), source.indexOf('function ClientDigitalTwinOverview'));
  expect(navigation).toContain('<TabsList');
  expect(navigation).toContain('<TabsTrigger');
  expect(navigation).toContain('value={item.value}');
  expect(navigation).not.toContain('role="tab"');
});
