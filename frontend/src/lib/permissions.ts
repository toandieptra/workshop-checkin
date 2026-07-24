export type Permission = string;

/** Shared aliases for the backend permission catalog. */
export const PERMISSIONS = {
  guestsView: "guests.read",
  guestsCreate: "guests.write",
  guestsEdit: "guests.write",
  guestsDelete: "guests.delete",
  guestsImport: "guests.write",
  guestsExport: "guests.export",
  guestsCheckin: "checkin.manage",
  larkSync: "lark.sync",
  workshopsView: "workshops.read",
  workshopsCreate: "workshops.write",
  workshopsEdit: "workshops.write",
  workshopsDelete: "workshops.delete",
  formsView: "registration_forms.read",
  formsCreate: "registration_forms.write",
  formsEdit: "registration_forms.write",
  formsDelete: "registration_forms.write",
  reportsView: "checkin.read",
  reportsExport: "guests.export",
  zbsView: "zbs.read",
  zbsManage: "zbs.manage",
  connectionsView: "zalo_connections.read",
  connectionsManage: "zalo_connections.manage",
  usersView: "users.manage",
  usersManage: "users.manage",
} as const;

export function hasPermission(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes("*") || permissions.includes(permission);
}
