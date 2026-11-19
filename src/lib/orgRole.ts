const ADMIN_ROLES = new Set(['org:admin', 'admin']);

/**
 * True when the caller may change organization settings.
 * - API-key callers have no Clerk identity (`req.auth` unset) and act as the organization itself.
 * - A Clerk token with no organization is a personal workspace, owned by its user.
 * - A Clerk token with an organization needs the admin role; one that carries an organization
 *   but no readable role is denied. Both claim shapes are read (`org_role`, and `o.rol` in v2 tokens).
 */
export function isOrgAdmin(req: any): boolean {
    const auth = req.auth;
    if (!auth) return true;

    const role = auth.org_role ?? auth.o?.rol;
    if (role) return ADMIN_ROLES.has(role) || ADMIN_ROLES.has(`org:${role}`);

    const inOrganization = Boolean(auth.org_id ?? auth.o?.id);
    return !inOrganization;
}
