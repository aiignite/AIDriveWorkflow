/** 将后端返回的相对文件路径转换为可访问 URL（同源部署下直接可用）。 */
export function toAbsoluteMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return url;
}
