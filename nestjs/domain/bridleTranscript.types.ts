export type BridleTranscriptRoles = 'user' | 'assistant'

export interface IBridleTranscriptMessage {
  id: string
  role: BridleTranscriptRoles
  text: string
  /** Unix epoch milliseconds. */
  ts: number
}
