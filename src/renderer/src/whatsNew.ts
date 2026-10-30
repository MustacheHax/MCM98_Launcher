/**
 * Highlights shown on the library page after a notable release. Keep this
 * short and human: a handful of core changes, not a changelog. Bump `version`
 * when the card should reappear for people who dismissed the previous one.
 */
export const WHATS_NEW = {
  version: '0.3',
  eyebrow: "What's new",
  title: 'The 0.3 release',
  items: [
    {
      title: 'Graffiti theme',
      text: 'A new default from the MCM98 wordmark, in dark and light.'
    },
    {
      title: 'Compact shell',
      text: 'A smaller Paradox-style window; Full is one click away.'
    },
    {
      title: 'Settings, rebuilt',
      text: 'Tabbed preferences for startup, updates, safety, and appearance.'
    },
    {
      title: 'Text size and relay health',
      text: 'Scale text in Appearance; relay health lives in the bottom bar.'
    }
  ]
} as const
