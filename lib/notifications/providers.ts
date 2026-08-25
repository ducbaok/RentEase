import { Resend } from 'resend'
import { optionalServerEnv } from '@/lib/env'
import type { Notification, NotificationProvider, SendResult } from './types'

/**
 * Development provider: prints the message instead of sending it.
 *
 * Chosen automatically when RESEND_API_KEY is unset, which means running the
 * reminder job locally can never email a real resident by accident.
 */
export const consoleProvider: NotificationProvider = {
  name: 'console',
  async send(notification: Notification): Promise<SendResult> {
    console.info(
      `[notification:${notification.kind}] to=${notification.to} subject=${JSON.stringify(
        notification.subject,
      )}${notification.idempotencyKey ? ` key=${notification.idempotencyKey}` : ''}\n${notification.text}`,
    )
    return { delivered: true, id: null }
  },
}

export function createResendProvider(apiKey: string, from: string): NotificationProvider {
  const resend = new Resend(apiKey)
  return {
    name: 'resend',
    async send(notification: Notification): Promise<SendResult> {
      const { data, error } = await resend.emails.send({
        from,
        to: notification.to,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
      })
      if (error) {
        return { delivered: false, id: null, error: error.message }
      }
      return { delivered: true, id: data?.id ?? null }
    },
  }
}

let cached: NotificationProvider | null = null

/** The provider for this environment. Resend when configured, console otherwise. */
export function getNotificationProvider(): NotificationProvider {
  if (cached) return cached
  const apiKey = optionalServerEnv('RESEND_API_KEY')
  const from = optionalServerEnv('EMAIL_FROM') ?? 'RentEase <onboarding@resend.dev>'
  cached = apiKey ? createResendProvider(apiKey, from) : consoleProvider
  return cached
}

/** Test seam: lets a test install a fake provider. */
export function setNotificationProvider(provider: NotificationProvider | null): void {
  cached = provider
}
