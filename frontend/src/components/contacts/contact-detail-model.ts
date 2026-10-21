import type { User } from '../../domain/types';

export interface ContactDepartmentDetail {
  /** Stable department identifier; the view never uses it to query organization data. */
  id: string;
  /** Display path supplied by the integration layer; it may be one known department name. */
  path: string | readonly string[];
  primary?: boolean;
}

export interface ContactDetail {
  userId: string;
  displayName: string;
  avatar?: string;
  email?: string;
  phone?: string;
  departments?: readonly ContactDepartmentDetail[];
}

export interface ContactDetailLabels {
  title: string;
  close: string;
  userId: string;
  email: string;
  phone: string;
  departments: string;
  primaryDepartment: string;
  sendMessage: string;
}

export interface ContactDetailRow {
  key: 'userId' | 'email' | 'phone';
  label: string;
  value: string;
}

export interface ContactDepartmentRow {
  id: string;
  path: string;
  primary: boolean;
}

export interface ContactDetailViewModel {
  displayName: string;
  rows: ContactDetailRow[];
  departments: ContactDepartmentRow[];
}

/** Converts the preserved directory profile without inventing unavailable hierarchy segments. */
export function contactDetailFromUser(user: User): ContactDetail {
  return {
    userId: user.id,
    displayName: user.name,
    avatar: user.avatar,
    email: user.email,
    phone: user.mobile,
    departments: (user.memberships ?? []).map(membership => ({
      id: membership.orgUnitId,
      path: membership.orgUnitName ?? membership.orgUnitId,
      primary: membership.primary
    }))
  };
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function departmentPath(path: ContactDepartmentDetail['path']): string | undefined {
  if (typeof path === 'string') return optionalText(path);
  const segments = path.map(segment => segment.trim()).filter(Boolean);
  return segments.length ? segments.join(' / ') : undefined;
}

/** Projects nullable host data into rows that are always safe to render. */
export function buildContactDetailViewModel(
  contact: ContactDetail,
  labels: ContactDetailLabels
): ContactDetailViewModel {
  const rows: ContactDetailRow[] = [{ key: 'userId', label: labels.userId, value: contact.userId.trim() }];
  const email = optionalText(contact.email);
  const phone = optionalText(contact.phone);
  if (email) rows.push({ key: 'email', label: labels.email, value: email });
  if (phone) rows.push({ key: 'phone', label: labels.phone, value: phone });

  const departments = (contact.departments ?? []).flatMap(department => {
    const path = departmentPath(department.path);
    return path ? [{ id: department.id, path, primary: department.primary === true }] : [];
  });

  return {
    displayName: contact.displayName.trim() || contact.userId.trim(),
    rows,
    departments
  };
}
