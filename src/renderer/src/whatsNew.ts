/**
 * Highlights shown on the library page after a notable release. Keep this
 * short and human: a handful of core changes, not a changelog. Bump `version`
 * when the card should reappear for people who dismissed the previous one.
 */
export const WHATS_NEW = {
  version: '0.4.9',
  eyebrow: "What's new",
  title: 'New projects, found automatically',
  items: [
    {
      title: 'Release it and it appears',
      text: 'The relay now discovers every repository on your account with a published build, so a new project shows up on its first release without editing a catalog.'
    },
    {
      title: 'No baked-in product list',
      text: 'The relay no longer carries a fixed product list. Products come from your releases, with an optional catalog file for pinning a name or asset rule.'
    },
    {
      title: 'Your last library stays put',
      text: 'If the relay or GitHub is unavailable, the launcher keeps the last catalog it saw instead of replacing it with an empty one.'
    }
  ]
} as const
