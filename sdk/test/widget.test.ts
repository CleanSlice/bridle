// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { hub, flush, resetFakes, sockets, socketIoMock, TIMERS_WITH_PERFORMANCE } from './fakeSocket'

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
      {
        text: 'Is the Turbo premium only?',
        parts: [{ type: 'text', text: 'Is the Turbo premium only?' }],
        // Since 0.16.0 every send carries an id, so the hub can acknowledge it.
        clientMessageId: expect.any(String),
      },
    ])
  })
})

/*
 * The agent's request limit is full (CLEAN-224). The hub says so through the
 * acknowledgement of a send, or ahead of one with `agent_limit`. Either way
 * the visitor keeps what they wrote, sees when to try again, and nothing
 * leaves the widget until the wait is over - by any of its five send paths.
 */
describe('BridleChat when the agent has reached its message limit', () => {
  const DRAFT = 'Is the Turbo premium only?'
  let onLimit = vi.fn()

  beforeEach(() => {
    // The outer hook already installed fake timers, and a second install is a
    // no-op until the first is undone.
    vi.useRealTimers()
    vi.useFakeTimers(TIMERS_WITH_PERFORMANCE)
    // Local 10:00, so a wait of a few hours stays inside the same day.
    vi.setSystemTime(new Date(2026, 10, 3, 10, 0, 0))
    onLimit = vi.fn()
    valid.add('t')
  })

  async function mountLimitChat(props: Record<string, unknown> = {}) {
    const chat = mountChat({ token: 't', onLimit, ...props })
    await settle()
    return chat
  }

  const socket = () => sockets.at(-1)!
  const refuse = (retryAfterMs: number, window = 'minute') => {
    hub.ack = () => ({ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs, window })
  }
  /** The hub announces a full hour window to a chat that is only reading. */
  async function announceLimit(retryAfterMs = 600_000, window = 'hour') {
    socket().trigger('agent_limit', { type: 'agent_limit', agentId: 'agent', limited: true, retryAfterMs, window })
    await flush()
  }
  async function typeAndSubmit(chat: VueWrapper, text = DRAFT) {
    await chat.find('textarea').setValue(text)
    await chat.find('form.bridle__input').trigger('submit')
    await flush()
  }
  const draftOf = (chat: VueWrapper) => (chat.find('textarea').element as HTMLTextAreaElement).value
  const clock = (ms: number) =>
    new Date(Date.now() + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  it('a refused send puts the draft back, leaves no bubble or typing dots, and shows the notice', async () => {
    refuse(42_000)
    const chat = await mountLimitChat()
    await typeAndSubmit(chat)

    expect(socket().sent).toHaveLength(1)
    expect(draftOf(chat)).toBe(DRAFT)
    expect(chat.find('.bridle__msg--user').exists()).toBe(false)
    expect(chat.find('.bridle__typing').exists()).toBe(false)

    const notice = chat.find('.bridle__limit')
    expect(notice.text()).toContain('This agent has reached its message limit.')
    expect(notice.text()).toContain('Try again in 0:42.')
    // A limit is a state to wait out, not a failure: no red banner.
    expect(chat.find('.bridle__banner--error').exists()).toBe(false)
    expect(onLimit).toHaveBeenCalledTimes(1)
    expect(onLimit).toHaveBeenCalledWith({ limited: true, retryAfterMs: 42_000, window: 'minute' })
  })

  it('a refused send puts the attachments back as well', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(String(url).includes('upload') ? { url: 'https://files.example.com/spec.pdf' } : { messages: [] }),
        { status: 200 },
      ),
    ))
    refuse(42_000)
    const chat = await mountLimitChat({ uploadUrl: 'https://files.example.com/upload', accept: '*/*' })

    const picker = chat.find('.bridle__file-input')
    Object.defineProperty(picker.element, 'files', {
      configurable: true,
      value: [new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })],
    })
    await picker.trigger('change')
    await flush(30)
    expect(chat.find('.bridle__attachment-name').text()).toBe('spec.pdf')

    await typeAndSubmit(chat, 'See the spec')
    expect((socket().sent[0] as { parts: { type: string }[] }).parts.map((p) => p.type)).toEqual(['file', 'text'])
    expect(chat.find('.bridle__attachment-name').text()).toBe('spec.pdf')
    expect(draftOf(chat)).toBe('See the spec')
    expect(chat.find('.bridle__msg--user').exists()).toBe(false)
  })

  it('keeps the message field editable and marks Send unavailable, described by the notice', async () => {
    const chat = await mountLimitChat()
    await announceLimit()

    const textarea = chat.find('textarea')
    expect(textarea.attributes('disabled')).toBeUndefined()
    await textarea.setValue('still typing')
    expect(draftOf(chat)).toBe('still typing')

    const button = chat.find('form.bridle__input button[type="submit"]')
    expect(button.attributes('aria-disabled')).toBe('true')
    const describedBy = button.attributes('aria-describedby')!
    expect(chat.find(`#${describedBy}`).text()).toContain('Try again in 10:00.')
  })

  it('shows the notice on connect when the hub announces a full window, before anything is typed', async () => {
    hub.afterWelcome = () => [
      ['agent_limit', { type: 'agent_limit', agentId: 'agent', limited: true, retryAfterMs: 600_000, window: 'hour' }],
    ]
    const chat = await mountLimitChat()

    // `settle()` let 2 s of the wait pass.
    expect(chat.find('.bridle__limit').text()).toContain('Try again in 9:58.')
    expect(onLimit).toHaveBeenCalledWith({ limited: true, retryAfterMs: 600_000, window: 'hour' })
  })

  it('Send button: nothing leaves while limited', async () => {
    const chat = await mountLimitChat()
    await announceLimit()
    await typeAndSubmit(chat)

    expect(socket().sent).toEqual([])
    expect(draftOf(chat)).toBe(DRAFT)
    expect(chat.find('.bridle__msg--user').exists()).toBe(false)
  })

  it('Enter: nothing leaves while limited, and the notice nudges', async () => {
    const chat = await mountLimitChat()
    await announceLimit()
    await chat.find('textarea').setValue(DRAFT)
    await chat.find('textarea').trigger('keydown', { key: 'Enter' })

    expect(socket().sent).toEqual([])
    expect(draftOf(chat)).toBe(DRAFT)
    expect(chat.find('.bridle__limit').classes()).toContain('bridle__limit--nudge')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(chat.find('.bridle__limit').classes()).not.toContain('bridle__limit--nudge')
  })

  it('suggestion chips: off while limited, and a click sends nothing', async () => {
    const chat = await mountLimitChat({ suggestions: ['What trims are there?'] })
    await announceLimit()
    await chat.find('textarea').setValue('my own words')

    const chip = chat.find('.bridle__suggestion')
    expect(chip.attributes('disabled')).toBeDefined()
    // Past the disabled attribute, straight at the handler.
    chip.element.removeAttribute('disabled')
    await chip.trigger('click')

    expect(socket().sent).toEqual([])
    expect(draftOf(chat)).toBe('my own words')
  })

  it('sendMessage(): nothing leaves while limited, and limit fires again with the remaining wait', async () => {
    const chat = await mountLimitChat()
    await announceLimit()
    await chat.find('textarea').setValue('my own words')
    await vi.advanceTimersByTimeAsync(60_000)

    ;(chat.vm as unknown as { sendMessage: (text: string) => void }).sendMessage('from the host page')
    await flush()

    expect(socket().sent).toEqual([])
    expect(draftOf(chat)).toBe('my own words')
    expect(onLimit).toHaveBeenLastCalledWith({ limited: true, retryAfterMs: 540_000, window: 'hour' })
  })

  describe('UI form', () => {
    const form = {
      messageId: 'm-form',
      text: 'Where are you?',
      parts: [
        { type: 'text', text: 'Where are you?' },
        {
          type: 'ui',
          uiId: 'city',
          components: [{ type: 'input', name: 'city', label: 'City', default: 'Kyiv' }],
        },
      ],
    }

    it('a refused form is not marked submitted and can be sent again later', async () => {
      refuse(42_000)
      const chat = await mountLimitChat()
      socket().trigger('message', form)
      await flush()

      await chat.find('form.bridle__ui').trigger('submit')
      await flush()

      expect(socket().sent).toHaveLength(1)
      expect(chat.find('form.bridle__ui').classes()).not.toContain('bridle__ui--submitted')
      expect(chat.find('.bridle__ui-submit').text()).toBe('Apply')
      expect(chat.find('.bridle__msg--user').exists()).toBe(false)
      expect(chat.find('.bridle__typing').exists()).toBe(false)
      expect(chat.find('.bridle__limit').exists()).toBe(true)
    })

    it('submit: off while limited, and nothing leaves', async () => {
      const chat = await mountLimitChat()
      socket().trigger('message', form)
      await announceLimit()

      expect(chat.find('.bridle__ui-submit').attributes('disabled')).toBeDefined()
      await chat.find('form.bridle__ui').trigger('submit')
      await flush()

      expect(socket().sent).toEqual([])
      expect(chat.find('form.bridle__ui').classes()).not.toContain('bridle__ui--submitted')
      expect(chat.find('.bridle__msg--user').exists()).toBe(false)
    })
  })

  describe('messages queued while the socket was down', () => {
    async function queueWhileOffline(chat: VueWrapper) {
      socket().connected = false
      socket().trigger('disconnect', 'transport close')
      await flush()
      await typeAndSubmit(chat)
      expect(chat.text()).toContain(DRAFT)
      expect(socket().sent).toEqual([])
    }

    it('are not flushed after welcome while limited: they go back to the message field', async () => {
      const chat = await mountLimitChat()
      await queueWhileOffline(chat)
      await announceLimit()

      socket().connect()
      await flush(30)

      expect(socket().sent).toEqual([])
      expect(chat.find('.bridle__msg--user').exists()).toBe(false)
      expect(chat.find('.bridle__typing').exists()).toBe(false)
      expect(draftOf(chat)).toBe(DRAFT)
    })

    it('are rolled back when the flush itself is refused', async () => {
      const chat = await mountLimitChat()
      await queueWhileOffline(chat)
      refuse(42_000)

      socket().connect()
      await flush(30)

      expect(socket().sent).toHaveLength(1)
      expect(chat.find('.bridle__msg--user').exists()).toBe(false)
      expect(chat.find('.bridle__typing').exists()).toBe(false)
      expect(draftOf(chat)).toBe(DRAFT)
      expect(chat.find('.bridle__limit').exists()).toBe(true)
    })
  })

  it('renders both labels with {time} replaced, counts down, and leaves when the wait ends', async () => {
    refuse(42_000)
    const chat = await mountLimitChat({ limitLabel: 'The agent is busy.', limitRetryLabel: 'Back in {time}.' })
    await typeAndSubmit(chat)

    expect(chat.find('.bridle__limit').text()).toContain('The agent is busy.')
    expect(chat.find('.bridle__limit').text()).toContain('Back in 0:42.')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(chat.find('.bridle__limit').text()).toContain('Back in 0:41.')

    await vi.advanceTimersByTimeAsync(41_000)
    expect(chat.find('.bridle__limit').text()).toContain('You can send your message now.')
    expect(chat.find('.bridle__limit').text()).not.toContain('Back in')
    expect(chat.find('form.bridle__input button[type="submit"]').attributes('aria-disabled')).toBeUndefined()
    expect(onLimit).toHaveBeenLastCalledWith({ limited: false })
    expect(onLimit).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(2_100)
    expect(chat.find('.bridle__limit').exists()).toBe(false)
    // Nothing went out by itself: the one frame on the wire is the refused send.
    expect(socket().sent).toHaveLength(1)
    expect(draftOf(chat)).toBe(DRAFT)

    hub.ack = (payload) => ({ status: 'accepted', messageId: payload.clientMessageId, ts: Date.now() })
    await chat.find('form.bridle__input').trigger('submit')
    await flush()
    expect(socket().sent).toHaveLength(2)
    expect(chat.find('.bridle__msg--user').text()).toContain(DRAFT)
    expect(draftOf(chat)).toBe('')
  })

  it('a refusal right after the wait reads as the same notice again, with the new wait', async () => {
    refuse(5_000)
    const chat = await mountLimitChat()
    await typeAndSubmit(chat)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(chat.find('.bridle__limit').text()).toContain('You can send your message now.')

    refuse(30_000)
    await chat.find('form.bridle__input').trigger('submit')
    await flush()
    expect(chat.find('.bridle__limit').text()).toContain('Try again in 0:30.')

    // The "you can send" line's own timer must not take the new notice down.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(chat.find('.bridle__limit').text()).toContain('Try again in 0:27.')
    expect(draftOf(chat)).toBe(DRAFT)
  })

  it('an hour or more shows the time of day instead of a running clock', async () => {
    const chat = await mountLimitChat()
    const wait = 2 * 60 * 60 * 1000
    const expected = `Try again after ${clock(wait)}.`
    await announceLimit(wait, 'day')

    expect(chat.find('.bridle__limit').text()).toContain(expected)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(chat.find('.bridle__limit').text()).toContain(expected)
  })

  it('says "tomorrow" when the wait ends on the next local day', async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 30, 0))
    const chat = await mountLimitChat()
    const wait = 2 * 60 * 60 * 1000
    const expected = `Try again tomorrow after ${clock(wait)}.`
    await announceLimit(wait, 'day')

    expect(chat.find('.bridle__limit').text()).toContain(expected)
  })

  it('announces the notice once: the ticking time is not in the live region', async () => {
    const chat = await mountLimitChat()
    await announceLimit(42_000, 'hour')

    const status = chat.find('[role="status"]')
    const announced = status.text()
    expect(announced).toContain('This agent has reached its message limit.')
    expect(announced).toContain('Try again in 0:42.')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(chat.find('.bridle__limit').text()).toContain('Try again in 0:32.')
    expect(status.text()).toBe(announced)

    await vi.advanceTimersByTimeAsync(32_000)
    expect(status.text()).toBe('You can send your message now.')
  })

  it('leaves early when the hub says room was made', async () => {
    const chat = await mountLimitChat()
    await announceLimit()
    socket().trigger('agent_limit', { type: 'agent_limit', agentId: 'agent', limited: false })
    await flush()

    expect(chat.find('form.bridle__input button[type="submit"]').attributes('aria-disabled')).toBeUndefined()
    expect(onLimit).toHaveBeenLastCalledWith({ limited: false })
    await vi.advanceTimersByTimeAsync(2_100)
    expect(chat.find('.bridle__limit').exists()).toBe(false)
  })

  it('"New chat" does not clear the wait', async () => {
    const chat = await mountLimitChat()
    await announceLimit()

    await chat.find('.bridle__menu-trigger').trigger('click')
    await chat.find('.bridle__menu-item').trigger('click')
    await settle()

    expect(sockets.length).toBe(2)
    expect(chat.find('.bridle__limit').text()).toContain('Try again in 9:5')
    await typeAndSubmit(chat)
    expect(socket().sent).toEqual([])
    expect(draftOf(chat)).toBe(DRAFT)
  })

  it('AGENT_OFFLINE from the acknowledgement renders the line the hub used to send', async () => {
    hub.ack = () => ({ status: 'rejected', code: 'AGENT_OFFLINE' })
    const chat = await mountLimitChat()
    await typeAndSubmit(chat)

    expect(chat.find('.bridle__msg--assistant').text()).toContain('Agent is not connected. Please try again later.')
    // Nothing regresses: the visitor's message stays where it was.
    expect(chat.find('.bridle__msg--user').text()).toContain(DRAFT)
    expect(chat.find('.bridle__typing').exists()).toBe(false)
    expect(chat.find('.bridle__limit').exists()).toBe(false)
    expect(chat.find('.bridle__banner--error').exists()).toBe(false)
    expect(onLimit).not.toHaveBeenCalled()
  })

  it('still renders the plain line a hub sends to a widget it takes for an old build', async () => {
    const chat = await mountLimitChat()
    await typeAndSubmit(chat)
    expect(chat.find('.bridle__typing').exists()).toBe(true)

    const line = 'This agent has reached its message limit. Try again in about 40 seconds.'
    socket().trigger('message', { messageId: 'm-limit', text: line })
    await flush()

    expect(chat.find('.bridle__msg--assistant').text()).toContain(line)
    expect(chat.find('.bridle__typing').exists()).toBe(false)
  })

  it('stops its timers when the element is removed', async () => {
    const chat = await mountLimitChat()
    await announceLimit()
    await chat.find('textarea').trigger('keydown', { key: 'Enter' })

    chat.unmount()
    wrapper = null
    expect(vi.getTimerCount()).toBe(0)
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
