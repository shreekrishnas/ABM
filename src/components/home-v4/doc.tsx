
// Home's document, built on the taste-skill kit (public/assets): its stylesheets and scripts, not the
// app shell's globals.css and design.css.
// deal: hero collage, palette cool-white-slate, type geist, radius soft, nav-mega, footer-columns,
// close-word, rhythm surface-pairs, buttons solid, mark dots, ground sage, moment word-highlight.



const CSS = ["system.css", "ui/cards.css", "motion/motion.css", "backgrounds/backgrounds.css", "layout/layout.css", "icons/icon.css", "ui/base.css", "ui/window/fragment.css", "ui/doc/fragment.css", "ui/pipeline-board/fragment.css", "ui/notify/fragment.css", "ui/stat/fragment.css", "moments/word-highlight/moment.css", "home.css"];

export function HomeDoc({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-type="software" data-radius="soft" data-ground="sage" data-buttons="solid" data-motion="">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>ABM Intelligence: account intelligence for B2B sales teams</title>
        <meta name="description" content="Decisions waiting today, where target companies stop in the flow and what changed this week, for the client in view." />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="ABM Intelligence: account intelligence for B2B sales teams" />
        <meta property="og:description" content="Today's decisions and the company flow for the client in view." />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#f7f9fa" />
        <meta name="site-kind" content="software" />
        <meta name="page-type" content="software" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..500&display=swap" rel="stylesheet" />
        {CSS.map((f) => <link key={f} rel="stylesheet" href={`/assets/${f}`} />)}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500)" }} />
        <script src="/assets/backgrounds/backgrounds.js" />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
        <link rel="modulepreload" href="/assets/moments/word-highlight/moment.js" />
      </head>
      <body>
        {children}
        <script type="module" src="/assets/system.js" />
        <script type="module" src="/assets/motion/motion.js" />
        <script type="module" src="/assets/layout/layout.js" />
      </body>
    </html>
  );
}
