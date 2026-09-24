/**
 * Reverse-proxy identity that may stand in for a browser session.
 *
 * The shipped browser authentication asks the operator to carry a launch token
 * from the host's terminal to whichever device will browse the GUI. A local
 * reverse proxy that terminates TLS and injects the caller's verified identity
 * — Tailscale Serve's `tailscale-user-login`, for example — already knows who
 * the client is, so that handoff is redundant for the deployment it fronts.
 * This module lets such a header authenticate a request directly.
 *
 * The header is trusted only when the request arrived over loopback, which is
 * the one path the proxy owns: the shipped server binds loopback and the proxy
 * dials it from the same machine, while anything arriving on a network
 * interface could have written the header itself. A request that cannot prove a
 * loopback peer therefore falls back to the launch token and cookie, so an
 * all-interface deployment stays fail-closed.
 */

import z from '@deepseek-ai/schemastery'
import { isLoopbackHostname } from './loopback-hostname.ts'
import type { ConnectionTrustRequest } from './rpc.ts'

/** Proxy-supplied identity accepted in place of a launch-token exchange. */
export interface ProxyIdentityConfig {
  /**
   * Request header carrying the proxy-verified login, e.g.
   * `tailscale-user-login`. Empty (the default) disables the feature and
   * leaves browser authentication unchanged.
   */
  header?: string
  /**
   * Logins this deployment accepts from that header, compared
   * case-insensitively. Empty accepts every login the proxy verified, which
   * suits a single-owner network; declare the owner explicitly before the
   * proxy's network is shared with anyone else, because a node shared into it
   * would otherwise authenticate as an operator.
   */
  allow?: string[]
}

/** Validated proxy identity: the header to read and the logins accepted from it. */
export interface ResolvedProxyIdentity {
  /** Lowercased header name to read the login from. */
  readonly header: string
  /** Lowercased accepted logins; empty accepts any non-empty value. */
  readonly allow: readonly string[]
}

/** Schema for the proxy-identity config block. */
export const ProxyIdentityConfigSchema: z<ProxyIdentityConfig> = z.object({
  header: z.string().default(''),
  allow: z.array(String).default([]),
})

// RFC 9110 field-name token, restricted to the lowercase the comparison uses.
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/

/**
 * Validate the proxy-identity block and normalize it for per-request use.
 * @param config - configured block, or undefined when the feature is unset.
 * @returns the normalized block, or undefined when no header is configured.
 */
export function resolveProxyIdentityConfig(
  config: ProxyIdentityConfig | undefined,
): ResolvedProxyIdentity | undefined {
  const header = config?.header?.trim().toLowerCase() ?? ''
  if (header === '') return undefined
  // Config boundary: the value is read verbatim from request headers, so a
  // name request handling could never carry fails the load loudly here rather
  // than silently authenticating nobody.
  if (!HEADER_NAME_PATTERN.test(header)) {
    throw new Error(
      `client-connection: proxyIdentity.header ${JSON.stringify(header)} is not a bare HTTP field name`,
    )
  }
  const allow = (config?.allow ?? [])
    .map(login => login.trim().toLowerCase())
    .filter(login => login !== '')
  return { header, allow }
}

/**
 * Whether a socket peer address proves the request came from this machine.
 *
 * Node reports `::ffff:127.0.0.1` for a dual-stack loopback listener, and the
 * keyword and IPv6 spellings never reach {@link isLoopbackHostname}, which
 * classifies WHATWG hostnames rather than socket addresses.
 * @param address - `socket.remoteAddress`, absent on a Fetch representation.
 * @returns true only for a loopback peer.
 */
export function isLoopbackPeer(address: string | null | undefined): boolean {
  if (address === undefined || address === null) return false
  const mapped = '::ffff:'
  const normalized = address.startsWith(mapped) ? address.slice(mapped.length) : address
  return normalized === '::1' || isLoopbackHostname(normalized)
}

function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Decide whether one request carries a proxy identity this deployment trusts.
 * @param request - request headers plus the delivering socket, when the carrier exposes one.
 * @param identity - normalized config, or undefined when the feature is off.
 * @returns true only for a loopback-peer request carrying an accepted login.
 */
export function isTrustedProxyIdentity(
  request: ConnectionTrustRequest,
  identity: ResolvedProxyIdentity | undefined,
): boolean {
  if (identity === undefined) return false
  // The proxy is the only thing that writes this header and the only thing
  // that may reach the server over loopback, so a peer that is not loopback
  // could have written the header itself.
  if (!isLoopbackPeer(request.socket?.remoteAddress)) return false
  const login = header(request.headers, identity.header)?.trim().toLowerCase()
  if (login === undefined || login === '') return false
  return identity.allow.length === 0 || identity.allow.includes(login)
}
