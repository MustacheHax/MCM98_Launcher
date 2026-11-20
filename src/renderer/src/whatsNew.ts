/**
 * Highlights shown on the library page after a notable release. Keep this
 * short and human: a handful of core changes, not a changelog. Bump `version`
 * when the card should reappear for people who dismissed the previous one.
 */
export const WHATS_NEW = {
  version: '0.4.8',
  eyebrow: "What's new",
  title: 'Your library, with a memory',
  items: [
    {
      title: 'Saves you can put back',
      text: 'Open the drawer to see every save archive with its date and size. Restore one over the current folder after a confirmation; it is blocked while the game is running.'
    },
    {
      title: 'Patch notes in the drawer',
      text: 'Each product now lists its ten newest releases with the real notes, version and date, newest expanded — no detour to GitHub.'
    },
    {
      title: 'Pick a version, roll one back',
      text: 'Install any published release from the version menu. The build you replaced stays on disk, so Roll back swaps it back in one click.'
    },
    {
      title: 'Update checks that tell the truth',
      text: 'A release without a comparable version no longer looks like an update, and an unversioned dev build still recognises a numbered release.'
    }
  ]
} as const
