/**
 * Highlights shown on the library page after a notable release. Keep this
 * short and human: a handful of core changes, not a changelog. Bump `version`
 * when the card should reappear for people who dismissed the previous one.
 */
export const WHATS_NEW = {
  version: '0.4.92',
  eyebrow: "What's new",
  title: 'The catalog has a front row',
  items: [
    {
      title: 'Newest!',
      text: 'The newest repository takes the first banner and keeps it until another repository is created, so a fresh project stays visible for months.'
    },
    {
      title: 'Recently Updated',
      text: 'The second banner follows the latest release from an older repository, so it changes whenever one of them ships something new.'
    },
    {
      title: 'Straight to the details',
      text: 'Click either banner to open that product, read its release notes, and install or update it.'
    }
  ]
} as const
