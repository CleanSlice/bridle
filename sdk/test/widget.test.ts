// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { hub, flush, resetFakes, sockets, socketIoMock } from './fakeSocket'

vi.mock('socket.io-client', () => socketIoMock())

const BridleChat = (await import('../src/BridleChat.ce.vue')).default

const valid = new Set<string>()
let wrapper: VueWrapper | null = null
// `emitted()` does not see events of a component compiled as a custom element,
// so emits are observed through their prop handlers.
let onTokenExpired = vi.fn()

async function settle(): Promise<void> {
  await flush(30)
  // ERROR_SETTLE_MS: the banner only shows an error still standing after 1.5 s.
  await vi.advanceTimersByTimeAsync(2_000)
  await flush(10)
}

function mountChat(props: Record<string, unknown>) {
  wrapper = mount(BridleChat as any, {
    props: { apiUrl: 'http://hub', agentId: 'agent', mode: 'inline', onTokenExpired, ...props },
  })
  return wrapper
}

/** The agent answers on the live socket, as it would before the token expired. */
function agentSays(text: string) {
  sockets.at(-1)!.trigger('stream_end', { messageId: `m-${text}`, text })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetFakes()
  valid.clear()
  onTokenExpired = vi.fn()
  hub.check = (auth) => (valid.has(auth.token) ? null : 'TOKEN_EXPIRED')
  // Transcript replay: nothing stored server-side, so whatever stays on screen
  // after a reconnect is what the widget kept itself.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BridleChat with a token provider', () => {
  it('renews an expired token on reconnect without a banner and keeps the conversation', async () => {
    let n = 0
    valid.add('tok-1').add('tok-2')
    const chat = mountChat({ tokenProvider: () => `tok-${++n}` })
    await settle()
    agentSays('Turbo: 256 hp on premium')
    await flush()

    valid.delete('tok-1')
    sockets.at(-1)!.drop()
    await settle()

    expect(sockets.at(-1)!.handshakes.map((h) => h.token)).toEqual(['tok-1', 'tok-1', 'tok-2'])
    expect(chat.find('.bridle__banner--error').exists()).toBe(false)
    expect(chat.text()).toContain('Turbo: 256 hp on premium')
    expect(onTokenExpired).not.toHaveBeenCalled()
  })

  it('shows a friendly expired state with Reconnect when renewal fails, never a raw code', async () => {
    const chat = mountChat({ tokenProvider: () => 'dead' })
    await settle()

    const banner = chat.find('.bridle__banner--error')
    expect(banner.text()).toContain('Your session has expired.')
    expect(banner.text()).not.toContain('TOKEN_EXPIRED')
    expect(banner.text()).toContain('Reconnect')
    expect(banner.text()).not.toContain('Reload the page')

    valid.add('dead')
    await banner.find('button').trigger('click')
    await settle()
    expect(chat.find('.bridle__banner--error').exists()).toBe(false)
  })
})

describe('BridleChat with a static token', () => {
  it('emits token-expired, and setToken reconnects keeping the conversation', async () => {
    valid.add('static-1')
    const chat = mountChat({ token: 'static-1' })
    await settle()
    agentSays('Hybrid: 219 hp combined')
    await flush()

    valid.delete('static-1')
    sockets.at(-1)!.drop()
    await settle()

    expect(onTokenExpired).toHaveBeenCalledTimes(1)
    const banner = chat.find('.bridle__banner--error')
    expect(banner.text()).toContain('Your session has expired.')
    expect(banner.text()).toContain('Reload the page')

    valid.add('static-2')
    await chat.setProps({ token: 'static-2' })
    await settle()

    expect(sockets.at(-1)!.handshakes.at(-1)!.token).toBe('static-2')
    expect(chat.find('.bridle__banner--error').exists()).toBe(false)
    expect(chat.text()).toContain('Hybrid: 219 hp combined')
  })

  it('Reconnect asks the host again through token-expired', async () => {
    const chat = mountChat({ token: 'stale' })
    await settle()
    expect(onTokenExpired).toHaveBeenCalledTimes(1)

    await chat.find('.bridle__banner--error button').trigger('click')
    expect(onTokenExpired).toHaveBeenCalledTimes(2)
  })
})

describe('BridleChat while reconnecting', () => {
  it('keeps a message typed during the reconnect and sends it after welcome', async () => {
    let n = 0
    valid.add('tok-1').add('tok-2')
    const chat = mountChat({ tokenProvider: () => `tok-${++n}` })
    await settle()

    // Socket down, renewal not answered yet: the visitor keeps typing.
    valid.delete('tok-1')
    const socket = sockets.at(-1)!
    socket.connected = false
    socket.trigger('disconnect', 'transport close')
    await flush()

    await chat.find('textarea').setValue('Is the Turbo premium only?')
    await chat.find('form').trigger('submit')
    expect(chat.text()).toContain('Is the Turbo premium only?')
    expect(socket.sent).toEqual([])

    socket.connect()
    await settle()
    expect(socket.sent).toEqual([
      { text: 'Is the Turbo premium only?', parts: [{ type: 'text', text: 'Is the Turbo premium only?' }] },
    ])
  })
})

/*
 * `enableImages` has to close both halves of the door. The capability list is
 * covered in client.test.ts; what matters here is the half a user can see -
 * and that documents still have a way in when an upload endpoint exists.
 */
describe('BridleChat with pictures turned off', () => {
  it('offers the picker and advertises images by default', async () => {
    valid.add('t')
    mountChat({ token: 't' })
    await settle()

    expect(wrapper!.find('.bridle__attach').exists()).toBe(true)
    expect(sockets.at(-1)!.handshakes[0].capabilities).toEqual(['streaming', 'images', 'files', 'ui'])
  })

  it('hides the picker and stops advertising images', async () => {
    valid.add('t')
    mountChat({ token: 't', enableImages: false })
    await settle()

    expect(wrapper!.find('.bridle__attach').exists()).toBe(false)
    expect(sockets.at(-1)!.handshakes[0].capabilities).toEqual(['streaming', 'files', 'ui'])
  })

  it('reads the flag when it arrives as an attribute string', async () => {
    // Through `init()` the value crosses an HTML attribute, so the widget sees
    // "false", not false - a plain truthiness check would miss it.
    valid.add('t')
    mountChat({ token: 't', enableImages: 'false' })
    await settle()

    expect(wrapper!.find('.bridle__attach').exists()).toBe(false)
  })

  it('keeps the picker for documents when an upload endpoint is configured', async () => {
    valid.add('t')
    mountChat({ token: 't', enableImages: false, uploadUrl: 'https://files.example.com/upload' })
    await settle()

    expect(wrapper!.find('.bridle__attach').exists()).toBe(true)
  })
})
