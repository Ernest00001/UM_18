// Access is assigned separately; registration review also requires a leadership office.
export const ACCESS_ROLES = [
  ['owner', 'System administrator'],
  ['secretary', 'Membership and records'],
  ['treasurer', 'Finance management'],
  ['welfare', 'Assigned welfare cases'],
  ['read_only', 'Directory access']
];

export const EXECUTIVE_OFFICES = [
  {code:'president', label:'President', roles:['read_only'], permissions:['registrations.review','finance.read','audit.read'], description:'Review member requests, oversee the association and read permitted reports. The initial President account is provisioned separately as system administrator.'},
  {code:'vice_president', label:'Vice President', roles:['read_only'], permissions:['registrations.review','finance.read','audit.read'], description:'Review member requests and support association leadership and permitted reports.'},
  {code:'secretary', label:'Secretary', roles:['secretary'], permissions:[], description:'Maintain approved member records, contact history and events.'},
  {code:'assistant_secretary', label:'Assistant Secretary', roles:['secretary'], permissions:[], description:'Support approved member records, contact history and events.'},
  {code:'treasurer', label:'Treasurer', roles:['treasurer'], permissions:[], description:'Contributions, receipts, expenses and financial reports.'},
  {code:'assistant_treasurer', label:'Assistant Treasurer', roles:['treasurer'], permissions:[], description:'Support contributions, receipts, expenses and financial reports.'},
  {code:'pro', label:'PRO', roles:['read_only'], permissions:['contacts.read','contacts.write','events.write','documents.write'], description:'Member outreach, contact follow-ups and events.'},
  {code:'financial_secretary', label:'Financial Secretary', roles:['treasurer'], permissions:[], description:'Maintain contribution records and financial reports.'},
  {code:'assistant_financial_secretary', label:'Assistant Financial Secretary', roles:['treasurer'], permissions:[], description:'Support contribution records and financial reports.'},
  {code:'community_event_manager', label:'Community / Event Manager', roles:['read_only'], permissions:['events.write','documents.write'], description:'Organise community events, attendance and event documents.'},
  {code:'auditor_general', label:'Auditor General', roles:['read_only'], permissions:['finance.read','finance.export','audit.read'], description:'Inspect financial records, export finance reports and review permitted audit history.'}
];

export function canReviewRegistrations(account) {
  return !!(account && account.active!==false && account.permissions?.includes('registrations.review') &&
    (account.office_codes||[]).some(code=>code==='president'||code==='vice_president'));
}

export function validOfficeCodes(codes) {
  return Array.isArray(codes) && codes.length <= EXECUTIVE_OFFICES.length &&
    new Set(codes).size === codes.length &&
    codes.every(code => EXECUTIVE_OFFICES.some(office => office.code === code));
}

export function officeLabels(codes = []) {
  return EXECUTIVE_OFFICES.filter(office => codes.includes(office.code)).map(office => office.label);
}

export function suggestedAccess(codes = []) {
  const offices = EXECUTIVE_OFFICES.filter(office => codes.includes(office.code));
  return {
    roles: [...new Set(offices.flatMap(office => office.roles))],
    permissions: [...new Set([...offices.flatMap(office => office.permissions),...(offices.length?['office_reports.write']:[])])]
  };
}

export const ACCESS_ROLE_PERMISSIONS = {
  secretary:['directory.read','members.write','contacts.read','contacts.write','events.write','members.import','directory.export','documents.write'],
  treasurer:['directory.read','finance.read','finance.write','finance.export','documents.write'],
  welfare:['directory.read','welfare.read','welfare.write','documents.write'],
  read_only:['directory.read']
};

const area = (page, label, permission) => ({page, label, permission});
export const OFFICE_WORKSPACES = [
  {code:'leadership', label:'Leadership', office_codes:['president','vice_president'], description:'The President and Vice President review member requests and share association oversight and permitted reports.', areas:[area('overview','Overview','directory.read'),area('registrations','Member requests','registrations.review'),area('members','Members','directory.read'),area('reports','Reports','directory.read'),area('audit','Audit history','audit.read')]},
  {code:'secretariat', label:'Secretariat', office_codes:['secretary','assistant_secretary'], description:'The Secretary and Assistant Secretary work together on approved member records, contact history and events.', areas:[area('members','Members','directory.read'),area('contacts','Contact history','contacts.read'),area('events','Events','directory.read'),area('documents','Documents','directory.read'),area('reports','Reports','directory.read')]},
  {code:'treasury', label:'Treasury', office_codes:['treasurer','assistant_treasurer'], description:'The Treasurer and Assistant Treasurer share contribution, receipt and expense records.', areas:[area('monthly','Contribution','finance.read'),area('special','Special contribution','finance.read'),area('payments','Payments','finance.read'),area('expenses','Expenses','finance.read'),area('reports','Reports','directory.read')]},
  {code:'financial_secretariat', label:'Financial Secretariat', office_codes:['financial_secretary','assistant_financial_secretary'], description:'The Financial Secretary and Assistant Financial Secretary share contribution records and financial reports.', areas:[area('payments','Payments','finance.read'),area('monthly','Contribution','finance.read'),area('special','Special contribution','finance.read'),area('reports','Reports','directory.read')]},
  {code:'public_relations', label:'Public Relations', office_codes:['pro'], description:'Coordinate member outreach, contact follow-ups and events.', areas:[area('contacts','Contact history','contacts.read'),area('members','Members','directory.read'),area('events','Events','directory.read'),area('documents','Documents','directory.read')]},
  {code:'community_events', label:'Community and Events', office_codes:['community_event_manager'], description:'Coordinate community events, attendance and event documents.', areas:[area('events','Events','directory.read'),area('documents','Documents','directory.read')]},
  {code:'audit', label:'Audit', office_codes:['auditor_general'], description:'Review the shared financial records, reports and permitted audit history.', areas:[area('payments','Payments','finance.read'),area('expenses','Expenses','finance.read'),area('reports','Reports','directory.read'),area('audit','Audit history','audit.read')]}
];

export function officeWorkspaces(codes = []) {
  return OFFICE_WORKSPACES.filter(workspace => workspace.office_codes.some(code => codes.includes(code)));
}
