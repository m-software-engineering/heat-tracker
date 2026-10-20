/** Masks a project key to its prefix and last 4 chars, e.g. `pk_…a1b2`. */
export const maskProjectKey = (key: string) => {
  const prefix = /^[A-Za-z]+_/.exec(key)?.[0] ?? "";
  const rest = key.slice(prefix.length);
  return rest.length > 8 ? `${prefix}…${rest.slice(-4)}` : `${prefix}…`;
};

/** Drops the host part of an IP: IPv4 keeps /24, IPv6 keeps the first 3 groups. */
export const truncateIp = (ip: string) => {
  const v4 = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.0`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::`;
  return "unknown";
};
