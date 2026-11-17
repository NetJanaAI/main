/** True for an org admin, or for a caller with no org role (a personal workspace owner). */
export function isOrgAdmin(req: any): boolean {
    const orgRole = req.auth?.org_role;
    return !orgRole || orgRole === 'org:admin' || orgRole === 'admin';
}
