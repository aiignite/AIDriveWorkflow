export interface UserLike {
  id?: string;
  name?: string;
  realName?: string | null;
  fullName?: string | null;
  employeeCode?: string | null;
  username?: string;
  email?: string;
  department?: string;
  dept?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserId(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()));
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/** 用户展示名：优先真实姓名（中文名） */
export function getUserDisplayName(user: UserLike): string {
  return firstNonEmpty(user.realName, user.fullName, user.name, user.username, user.id);
}

/** 当前登录用户展示名：realName → 账号名 → 邮箱前缀 */
export function getLoggedInUserDisplayName(
  user: UserLike | null | undefined,
  fallback = '用户',
): string {
  if (!user) return fallback;
  return getUserDisplayName(user) || firstNonEmpty(user.email?.split('@')[0]) || fallback;
}

const CJK_RE = /[\u3400-\u9fff]/;

/** 头像缩写：中文取末两字，西文取首尾字母 */
export function getAvatarInitials(displayName: string, maxChars = 2): string {
  const name = displayName.trim();
  if (!name) return '?';
  if (CJK_RE.test(name)) {
    return name.length <= maxChars ? name : name.slice(-maxChars);
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, maxChars).toUpperCase();
}

/** 下拉选项：value 存 user id，label 展示真实姓名 */
export function buildUserSelectOptions(users: UserLike[]) {
  return users.map(u => {
    const label = getUserDisplayName(u);
    return {
      id: u.id,
      label,
      value: u.id || label,
      sub: u.department || u.dept || '',
    };
  });
}

function findUserByRaw(raw: string, users: UserLike[]): UserLike | undefined {
  const trimmed = raw.trim();
  if (isUserId(trimmed)) {
    return users.find(u => u.id === trimmed);
  }
  return users.find(u =>
    u.id === trimmed
    || u.name === trimmed
    || u.realName === trimmed
    || u.employeeCode === trimmed
    || u.username === trimmed,
  );
}

/** 将 responsible（user id 或 legacy 姓名）解析为展示名 */
export function resolveResponsibleDisplayName(
  raw: string | null | undefined,
  users: UserLike[],
): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const match = findUserByRaw(trimmed, users);
  return match ? getUserDisplayName(match) : trimmed;
}

function splitResponsibleParts(raw: string): string[] {
  return raw.split(',').map(part => part.trim()).filter(Boolean);
}

/** 负责人是否匹配筛选词（兼容 id 与 legacy 姓名） */
export function responsibleMatches(
  raw: string | null | undefined,
  needle: string,
  users: UserLike[],
): boolean {
  if (!needle) return true;
  if (!raw) return false;
  const n = needle.trim().toLowerCase();
  return splitResponsibleParts(raw).some(part => {
    const resolved = resolveResponsibleDisplayName(part, users);
    return part.toLowerCase().includes(n) || resolved.toLowerCase().includes(n);
  });
}

/** 当前登录用户是否为任务负责人 */
export function isCurrentUserResponsible(
  raw: string | null | undefined,
  currentUser: UserLike | null | undefined,
  users: UserLike[],
): boolean {
  if (!raw || !currentUser?.id) return false;
  return splitResponsibleParts(raw).some(part => {
    if (part === currentUser.id) return true;
    if (isUserId(part)) return false;
    return isCurrentUserResponsibleLegacy(part, currentUser, users);
  });
}

function isCurrentUserResponsibleLegacy(
  raw: string,
  currentUser: UserLike,
  users: UserLike[],
): boolean {
  const keys = [
    currentUser.id,
    currentUser.name,
    currentUser.realName,
    currentUser.username,
    currentUser.employeeCode,
    getUserDisplayName(currentUser),
  ].filter((v): v is string => Boolean(v));
  const trimmed = raw.trim();
  if (keys.some(k => k === trimmed || trimmed.includes(k) || k.includes(trimmed))) return true;
  const resolved = resolveResponsibleDisplayName(trimmed, users);
  return keys.some(k => resolved === k || resolved.includes(k) || k.includes(resolved));
}
