import { allowedDomains, authSecret } from "@/lib/auth";
import { LoginForm } from "./form";
import { Logo } from "@/components/brand/Logo";

export const metadata = { title: "Sign in" };

// Signal nodes for the background constellation: [x%, y%, delay s].
const NODES: [number, number, number][] = [[8, 18, 0], [22, 64, 1.2], [36, 30, 2.4], [14, 86, 0.6], [48, 78, 1.8], [62, 12, 3], [78, 40, 0.9], [90, 74, 2.1], [70, 88, 1.5], [54, 48, 2.7]];
const LINKS: [number, number][] = [[0, 2], [2, 1], [1, 3], [2, 9], [9, 4], [9, 6], [5, 6], [6, 7], [7, 8], [4, 8], [5, 2]];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const domains = allowedDomains();
  const codes = Boolean(process.env.SMTP_URL?.trim());
  return (
    <div className="lg-root">
      <div className="lg-bg" aria-hidden>
        <div className="lg-aurora a1" />
        <div className="lg-aurora a2" />
        <div className="lg-aurora a3" />
        <div className="lg-grid" />
        <svg className="lg-net" viewBox="0 0 100 100" preserveAspectRatio="none">
          {LINKS.map(([a, b], i) => (
            <line key={i} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} style={{ animationDelay: `${i * 0.35}s` }} />
          ))}
        </svg>
        {NODES.map(([x, y, d], i) => (
          <span key={i} className="lg-node" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />
        ))}
        <div className="lg-noise" />
      </div>

      <main className="lg-wrap">
        <section className="lg-hero">
          <div className="lg-brand"><Logo size={46} tone="light" sub="Account intelligence" /></div>
          <h1 className="lg-headline">Know who&apos;s ready to buy <span>before they raise their hand.</span></h1>
          <p className="lg-lede">Research, buying signals, website visitors and drafted outreach for every target account, in one place.</p>
          <ul className="lg-points">
            <li><span className="lg-pulse" /> Buying signals with a source for every claim</li>
            <li><span className="lg-pulse p2" /> Website visitors matched to your accounts</li>
            <li><span className="lg-pulse p3" /> Emails drafted, checked and waiting for you</li>
          </ul>
        </section>

        <section className="lg-card" aria-label="Sign in">
          <LoginForm next={next ?? ""} domains={domains} codes={codes} ready={Boolean(authSecret())} />
        </section>
      </main>
    </div>
  );
}
