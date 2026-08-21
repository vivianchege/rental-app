export const ROLES = {
  LANDLORD: 'LANDLORD',
  MANAGER: 'MANAGER',
};

export const PERMISSIONS = {
  VIEW_DASHBOARD: 'dashboard.view',
  VIEW_PROPERTIES: 'property.view',
  MANAGE_PROPERTIES: 'property.manage',
  VIEW_TENANTS: 'tenant.view',
  MANAGE_TENANTS: 'tenant.manage',
  VIEW_RENT: 'rent.view',
  RECORD_RENT: 'rent.record',
  APPROVE_RENT: 'rent.approve',
  VIEW_EXPENSES: 'expense.view',
  CREATE_EXPENSES: 'expense.create',
  APPROVE_EXPENSES: 'expense.approve',
  VIEW_MAINTENANCE: 'maintenance.view',
  MANAGE_MAINTENANCE: 'maintenance.manage',
  VIEW_REPORTS: 'report.view',
  EXPORT_REPORTS: 'report.export',
  MANAGE_USERS: 'user.manage',
  MANAGE_SETTINGS: 'settings.manage',
};

const landlordPermissions = new Set(Object.values(PERMISSIONS));
const managerPermissions = new Set([
  PERMISSIONS.VIEW_DASHBOARD,
  PERMISSIONS.VIEW_PROPERTIES,
  PERMISSIONS.VIEW_TENANTS,
  PERMISSIONS.VIEW_RENT,
  PERMISSIONS.RECORD_RENT,
  PERMISSIONS.VIEW_MAINTENANCE,
  PERMISSIONS.MANAGE_MAINTENANCE,
  PERMISSIONS.VIEW_EXPENSES,
  PERMISSIONS.CREATE_EXPENSES,
]);

export function hasPermission(role, permission, customPermissions = []) {
  if (Array.isArray(customPermissions) && customPermissions.includes(permission)) return true;
  if (role === ROLES.LANDLORD) return landlordPermissions.has(permission);
  if (role === ROLES.MANAGER) return managerPermissions.has(permission);
  return false;
}

export function normalizeRole(role) {
  const normalized = String(role || '').toUpperCase();
  return Object.values(ROLES).includes(normalized) ? normalized : null;
}
