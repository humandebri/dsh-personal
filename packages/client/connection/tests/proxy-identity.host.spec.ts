/** Reverse-proxy identity authentication for the Connection carrier. */

import { describe, expect, it } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BrowserAuth } from '../src/browser-auth.ts'
import {
  isLoopbackPeer,
  isTrustedProxyIdentity,
  resolveProxyIdentityConfig,
  type ResolvedProxyIdentity,
} from '../src/proxy-identity.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'

/** The authority Serve fronts, and the login this deployment accepts. */
const AUTHORITY = 'hude.tail06a7cd.ts.net:443'
const LOGIN_HEADER = 'tailscale-user-login'
const OWNER = 'owner@example.com'

const identity: ResolvedProxyIdentity = { header: LOGIN_HEADER, allow: [OWNER] }

interface RequestInit {
  login?: string | undefined
  peer?: string | null | undefined
  url?: string | undefined
  method?: string | undefined
}

function request(init: RequestInit = {}): ConnectionIndexRequest {
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers: {
      host: AUTHORITY,
      ...init.login === undefined ? {} : { [LOGIN_HEADER]: init.login },
    },
    socket: { remoteAddress: init.peer === undefined ? '127.0.0.1' : init.peer },
  }
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end() {},
    },
    state,
  }
}

function createAuth(proxyIdentity?: ResolvedProxyIdentity): Promise<BrowserAuth> {
  return BrowserAuth.create(
    {},
    new RecordCredentials() as unknown as CredentialProvider,
    30,
    proxyIdentity,
  )
}

describe('resolveProxyIdentityConfig', () => {
  it('leaves the feature off when unset or when the header is blank', () => {
    expect(resolveProxyIdentityConfig(undefined)).toBeUndefined()
    expect(resolveProxyIdentityConfig({})).toBeUndefined()
    expect(resolveProxyIdentityConfig({ header: '   ' })).toBeUndefined()
  })

  it('normalizes the header name and accepted logins', () => {
    expect(resolveProxyIdentityConfig({
      header: '  Tailscale-User-Login ',
      allow: [' Owner@Example.com ', ''],
    })).toEqual({ header: LOGIN_HEADER, allow: [OWNER] })
  })

  it('fails the load on a name no request could carry', () => {
    expect(() => resolveProxyIdentityConfig({ header: 'bad header' }))
      .toThrow(/not a bare HTTP field name/u)
    expect(() => resolveProxyIdentityConfig({ header: 'x:y' }))
      .toThrow(/not a bare HTTP field name/u)
  })
})

describe('isLoopbackPeer', () => {
  it('accepts every spelling a loopback listener reports', () => {
    expect(isLoopbackPeer('127.0.0.1')).toBe(true)
    expect(isLoopbackPeer('::1')).toBe(true)
    expect(isLoopbackPeer('::ffff:127.0.0.1')).toBe(true)
  })

  it('refuses network peers, including a mapped non-loopback address', () => {
    expect(isLoopbackPeer('100.65.238.107')).toBe(false)
    expect(isLoopbackPeer('::ffff:100.65.238.107')).toBe(false)
    expect(isLoopbackPeer('192.168.1.5')).toBe(false)
    expect(isLoopbackPeer(undefined)).toBe(false)
    expect(isLoopbackPeer(null)).toBe(false)
    expect(isLoopbackPeer('')).toBe(false)
  })
})

describe('isTrustedProxyIdentity', () => {
  it('accepts the configured login from the local proxy', () => {
    expect(isTrustedProxyIdentity(request({ login: OWNER }), identity)).toBe(true)
    expect(isTrustedProxyIdentity(request({ login: OWNER.toUpperCase() }), identity)).toBe(true)
  })

  it('authenticates nobody while the feature is off', () => {
    expect(isTrustedProxyIdentity(request({ login: OWNER }), undefined)).toBe(false)
  })

  it('refuses the header when the peer could have written it itself', () => {
    expect(isTrustedProxyIdentity(request({ login: OWNER, peer: '100.65.238.107' }), identity)).toBe(false)
    expect(isTrustedProxyIdentity(request({ login: OWNER, peer: null }), identity)).toBe(false)
  })

  it('refuses a login the deployment does not list', () => {
    expect(isTrustedProxyIdentity(request({ login: 'guest@example.com' }), identity)).toBe(false)
    expect(isTrustedProxyIdentity(request({ login: '' }), identity)).toBe(false)
    expect(isTrustedProxyIdentity(request(), identity)).toBe(false)
  })

  it('accepts any verified login when no list is declared', () => {
    const open: ResolvedProxyIdentity = { header: LOGIN_HEADER, allow: [] }
    expect(isTrustedProxyIdentity(request({ login: 'anyone@example.com' }), open)).toBe(true)
  })
})

describe('BrowserAuth with a trusted proxy identity', () => {
  it('serves the index for a request carrying no cookie and no launch token', async () => {
    const auth = await createAuth(identity)
    expect(auth.authorizeIndex(request({ login: OWNER }), response().value)).toBe(true)
  })

  it('redirects a stale launch URL to the clean root instead of answering 401', async () => {
    const auth = await createAuth(identity)
    const res = response()
    expect(auth.authorizeIndex(request({ login: OWNER, url: '/?token=stale' }), res.value)).toBe(false)
    expect(res.state).toMatchObject({ status: 303, headers: { location: '/' } })
    expect(res.state.headers?.['set-cookie']).toBeUndefined()
  })

  it('still answers 401 without a usable identity', async () => {
    const auth = await createAuth(identity)

    const anonymous = response()
    expect(auth.authorizeIndex(request(), anonymous.value)).toBe(false)
    expect(anonymous.state.status).toBe(401)

    const remote = response()
    expect(auth.authorizeIndex(request({ login: OWNER, peer: '100.65.238.107' }), remote.value)).toBe(false)
    expect(remote.state.status).toBe(401)

    const wrongLogin = response()
    expect(auth.authorizeIndex(request({ login: 'guest@example.com' }), wrongLogin.value)).toBe(false)
    expect(wrongLogin.state.status).toBe(401)
  })

  it('reports an authenticated session to the /api trust fence', async () => {
    const auth = await createAuth(identity)
    expect(auth.isAuthenticated(request({ login: OWNER }))).toBe(true)
    expect(auth.isAuthenticated(request({ login: OWNER, peer: '100.65.238.107' }))).toBe(false)
  })

  it('leaves launch-token and cookie authentication intact', async () => {
    const auth = await createAuth(identity)
    const launch = new URL(auth.authenticatedUrl(`http://${AUTHORITY}`))
    const exchange = response()
    expect(auth.authorizeIndex(
      request({ url: `${launch.pathname}${launch.search}`, login: undefined }),
      exchange.value,
    )).toBe(false)
    expect(exchange.state.status).toBe(303)
    const cookie = exchange.state.headers?.['set-cookie']?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('token exchange did not set a cookie')
    expect(auth.isAuthenticated(request({ login: undefined }))).toBe(false)
    expect(auth.isAuthenticated({
      ...request({ login: undefined }),
      headers: { host: AUTHORITY, cookie },
    })).toBe(true)
  })
})
