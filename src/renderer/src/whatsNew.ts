/**
 * Highlights shown on the library page after a notable release. Keep this
 * short and human: a handful of core changes, not a changelog. Bump `version`
 * when the card should reappear for people who dismissed the previous one.
 */
export const WHATS_NEW = {
  version: '0.4.7',
  eyebrow: "What's new",
  title: 'Everything since 0.3',
  items: [
    {
      title: 'Update checks you can trust',
      text: 'A new release now shows up on the next check. The relay and the launcher had both been caching the self-update answer, which could hide a release for hours.'
    },
    {
      title: 'Twenty-two themes, eleven families',
      text: 'Vapor, Terminal, Arcade, Night and Mono join the original families. Each one changes type, corners and texture, not just colour; Mono doubles as a high-contrast option.'
    },
    {
      title: 'Sessions and play history',
      text: 'Last played, total playtime and launch counts per product. A game stays "playing" after a launcher restart, so updates and uninstalls cannot race it.'
    },
    {
      title: 'Downloads that resume',
      text: 'A dropped transfer continues from its partial file with an HTTP range request, including private assets streamed through the relay. Cancel keeps the partial; Discard partial frees it.'
    },
    {
      title: 'A library you can search',
      text: 'Search across names and repositories, sort by name, recently played or size, filter to updates only, then use Update all. Skip a version and it stops prompting; Repair restores a missing executable.'
    },
    {
      title: 'Your saves, handled',
      text: 'Each install finds its save folder, opens it, and archives it to a .tar.gz backup in one click.'
    },
    {
      title: 'Works while the relay sleeps',
      text: 'The last catalog is cached, so the library still opens offline and says so in the status bar.'
    },
    {
      title: 'Keyboard first',
      text: 'Ctrl/Cmd + K opens the command palette for any view, product or maintenance action; Ctrl/Cmd + 1-4 jumps between views.'
    },
    {
      title: 'Nothing to configure',
      text: 'The launcher now dials its built-in relay automatically, so the old Connection tab is gone; the address lives in Settings → About. Window size and position are remembered per layout.'
    }
  ]
} as const
