import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Cpu,
  Waves,
  Share2,
  Clock,
  ShieldCheck,
  Download,
  FileAudio,
  Languages,
  Apple,
} from "lucide-react";
import {
  siteConfig,
  LANGUAGE_COUNT,
  SUPPORTED_TICKER,
  STT_COUNT,
  TTT_COUNT,
  TOTAL_PROVIDERS,
} from "../data/siteConfig";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { Reveal } from "../components/Reveal";

const iconMap = {
  mic: Mic,
  cpu: Cpu,
  waves: Waves,
  share: Share2,
  clock: Clock,
  shield: ShieldCheck,
} as const;

function Counter({ target, suffix }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setVal(target);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          obs.disconnect();
          const t0 = performance.now();
          const dur = 1400;
          const tick = (now: number) => {
            const p = Math.min((now - t0) / dur, 1);
            setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return (
    <div ref={ref} className="stat-number">
      {val}
      {suffix ?? ""}
    </div>
  );
}

function Waveform() {
  const bars = Array.from({ length: 48 });
  return (
    <div className="waveform" id="hero-waveform" aria-hidden="true">
      {bars.map((_, i) => {
        const amp = `${20 + ((i * 37) % 80)}%`;
        const dur = `${(0.8 + ((i * 13) % 10) / 10).toFixed(2)}s`;
        const d = `${(((i * 17) % 15) / 10).toFixed(2)}s`;
        return (
          <span
            key={i}
            style={
              { "--amp": amp, "--dur": dur, "--d": d } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function Ticker() {
  const langs = SUPPORTED_TICKER;
  return (
    <div className="ticker-track" id="language-ticker" aria-hidden="true">
      {[...langs, ...langs].map((l, i) => (
        <span key={i} className="ticker-item">
          {l}
        </span>
      ))}
    </div>
  );
}

function LiveLabel() {
  const [label, setLabel] = useState("Ready");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const states = ["Ready", "Listening", "Transcribing", "Translating"];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % states.length;
      setLabel(states[i]);
    }, 2400);
    return () => clearInterval(id);
  }, []);
  return <span id="live-label">{label}</span>;
}

function formatLimit(n: number) {
  if (n === Infinity) return "Unlimited";
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

export default function Landing() {
  const { free, premium, usd } = siteConfig.pricing;
  return (
    <>
      <Nav />
      <section className="hero">
        <div className="container">
          <Reveal>
            <span className="hero-badge">
              <span className="dot"></span>
              <LiveLabel />
              <span className="badge-sep">·</span> v{siteConfig.app.version}
            </span>
          </Reveal>
          <Reveal>
            <h1>
              Voice notes,
              <br />
              <span className="gradient">translated instantly.</span>
            </h1>
          </Reveal>
          <Reveal>
            <p>{siteConfig.app.description}</p>
          </Reveal>
          <Reveal>
            <div className="waveform-wrap" aria-hidden="true">
              <Waveform />
              <div className="waveform-caption">
                <span className="wave-label">Now translating</span>
                <span className="wave-arrow">→</span>
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="hero-actions">
              <a
                href={siteConfig.links.download}
                className="btn btn-primary"
                data-download-primary
              >
                <Download size={18} /> Download for Android
              </a>
              <span
                className="btn btn-secondary btn-pending"
                role="button"
                aria-disabled="true"
              >
                <Apple size={18} /> iOS — Coming soon
              </span>
            </div>
          </Reveal>
          <Reveal>
            <p className="hero-note">
              Free to start · No card required · {LANGUAGE_COUNT} languages
            </p>
          </Reveal>
        </div>
      </section>

      <section className="ticker-section" aria-label="Supported languages">
        <div className="ticker">
          <Ticker />
        </div>
      </section>

      <section id="languages" className="section">
        <div className="container">
          <Reveal>
            <div className="section-label">
              <span className="label-line"></span>Languages
            </div>
            <h2 className="section-title">
              One voice,{" "}
              <span className="gradient">{LANGUAGE_COUNT} languages.</span>
            </h2>
            <p className="section-desc">
              From Arabic to Bengali, French to Hindi — speak in your language,
              and let {siteConfig.app.name} carry the meaning everywhere.
            </p>
          </Reveal>
          <div className="stats-row">
            <Reveal>
              <div className="stat-block">
                <Counter target={LANGUAGE_COUNT} />
                <div className="stat-label">Languages supported</div>
              </div>
            </Reveal>
            <Reveal>
              <div className="stat-block">
                <div className="stat-number">{STT_COUNT}</div>
                <div className="stat-label">Speech engines</div>
              </div>
            </Reveal>
            <Reveal>
              <div className="stat-block">
                <div className="stat-number">{TTT_COUNT}</div>
                <div className="stat-label">Translation models</div>
              </div>
            </Reveal>
            <Reveal>
              <div className="stat-block">
                <Counter target={free.dailyTranslateLimit} />
                <div className="stat-label">Free translations daily</div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="tech" className="section">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <div className="section-label">
                <span className="label-line"></span>Technology
              </div>
              <h2 className="section-title">
                Built on a{" "}
                <span className="gradient">resilient AI pipeline.</span>
              </h2>
              <p className="section-desc">
                {STT_COUNT} speech engines, {TTT_COUNT} translation models, and
                automatic failover — if one ever stumbles, another takes over.
                Your words keep moving, no matter what.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="arch">
              <div className="arch-col">
                <div className="arch-card arch-mobile">
                  <div className="arch-title">
                    <span className="arch-dot"></span>Mobile app
                  </div>
                  <p>Record, import &amp; process audio</p>
                </div>
                <div className="arch-sub">
                  Native C++ audio core · Opus + VAD on-device
                </div>
              </div>
              <div className="arch-arrow" aria-hidden="true">
                →
              </div>
              <div className="arch-col">
                <div className="arch-card arch-worker">
                  <div className="arch-title">
                    <span className="arch-dot"></span>Cloud worker
                  </div>
                  <p>Route, orchestrate &amp; failover</p>
                </div>
                <div className="arch-sub">Automatic provider selection</div>
              </div>
              <div className="arch-arrow" aria-hidden="true">
                →
              </div>
              <div className="arch-col">
                <div className="arch-card arch-ai">
                  <div className="arch-title">
                    <span className="arch-dot"></span>
                    {TOTAL_PROVIDERS} AI engines
                  </div>
                  <p>Transcribe &amp; translate with automatic failover</p>
                </div>
                <div className="arch-sub">
                  Speech-to-text × {STT_COUNT} · Translation × {TTT_COUNT}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="how-it-works" className="section">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <div className="section-label">
                <span className="label-line"></span>How it works
              </div>
              <h2 className="section-title">
                Three steps. <span className="gradient">Zero friction.</span>
              </h2>
            </div>
          </Reveal>
          <Reveal>
            <div className="steps">
              <div className="step">
                <div className="step-num">01</div>
                <div className="step-icon">
                  <Mic size={24} color="#fff" />
                </div>
                <h3>Record or import</h3>
                <p>
                  Hold to record, or share any audio straight from WhatsApp,
                  Telegram, Signal, WeChat, or your files.
                </p>
              </div>
              <div className="step-line" aria-hidden="true"></div>
              <div className="step">
                <div className="step-num">02</div>
                <div className="step-icon">
                  <FileAudio size={24} color="#fff" />
                </div>
                <h3>Transcribe</h3>
                <p>
                  {STT_COUNT} speech engines convert your voice to text in
                  seconds — whichever is fastest wins.
                </p>
              </div>
              <div className="step-line" aria-hidden="true"></div>
              <div className="step">
                <div className="step-num">03</div>
                <div className="step-icon">
                  <Languages size={24} color="#fff" />
                </div>
                <h3>Translate &amp; share</h3>
                <p>
                  Get instant translations in {LANGUAGE_COUNT} languages.
                  Replay, copy, or export anytime.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="features" className="section">
        <div className="container">
          <Reveal>
            <div className="section-header">
              <div className="section-label">
                <span className="label-line"></span>Features
              </div>
              <h2 className="section-title">Built for real conversations</h2>
              <p className="section-desc">
                Everything you need to translate voice notes across languages,
                with privacy and speed.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="features-grid">
              {siteConfig.features.map((f) => {
                const Icon = iconMap[f.icon];
                return (
                  <div key={f.title} className="feature-card">
                    <div className="feature-icon">
                      <Icon size={20} color="#09090B" />
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.description}</p>
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section works-with-section">
        <div className="container">
          <Reveal>
            <div className="section-header">
              <div className="section-label">
                <span className="label-line"></span>Compatibility
              </div>
              <h2 className="section-title">
                Works with <span className="gradient">every messaging app</span>
              </h2>
              <p className="section-desc">
                Share voice notes directly from any app on your phone.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="works-with-grid">
              {[
                { icon: "💬", name: "WhatsApp" },
                { icon: "✈️", name: "Telegram" },
                { icon: "🔒", name: "Signal" },
                { icon: "💬", name: "WeChat" },
                { icon: "📸", name: "Instagram" },
                { icon: "📁", name: "Any file" },
              ].map((w) => (
                <div key={w.name} className="works-with-item">
                  <span className="works-with-icon">{w.icon}</span>
                  <span>{w.name}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="section">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <div className="section-label">
                <span className="label-line"></span>Pricing
              </div>
              <h2 className="section-title">
                Simple, <span className="gradient">transparent pricing.</span>
              </h2>
              <p className="section-desc">
                Start for free, upgrade when you need more translations.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="pricing-grid">
              <div className="arch-card pricing-card">
                <div className="pricing-title">Free</div>
                <div className="pricing-tag">
                  Core translation tools, supported by ads.
                </div>
                <h3 className="pricing-amount">
                  $0<span className="pricing-per">/forever</span>
                </h3>
                <ul className="pricing-list">
                  <li>
                    ✓ {formatLimit(free.dailyTranslateLimit)} translations per
                    day
                  </li>
                  <li>
                    ✓ {formatLimit(free.dailyTranscribeMinutesLimit)} minutes
                    transcription per day
                  </li>
                  <li>
                    ✓ Standard voices ({formatLimit(free.dailySpeechCharsLimit)}{" "}
                    chars/day)
                  </li>
                  <li>
                    ✓ Voice notes up to{" "}
                    {Math.round(free.dictationDurationMs / 60000)} min
                  </li>
                  <li>✓ {free.historyRemoteTtlDays}-day cloud history</li>
                  <li>✓ Ad-supported</li>
                  <li className="muted">× Automatic language detection</li>
                  <li className="muted">× Live dictation</li>
                  <li className="muted">× Custom avatar icons</li>
                  <li className="muted">× Auto-copy translations</li>
                </ul>
              </div>
              <div className="arch-card pricing-card paid">
                <div className="pricing-title paid-title">Paid</div>
                <div className="pricing-tag">
                  Unlimited translation, transcription &amp; speech, with no
                  ads.
                </div>
                <h3 className="pricing-amount">
                  ${usd.monthly.amount}
                  <span className="pricing-per">/month</span>
                </h3>
                <ul className="pricing-list">
                  <li>✓ Unlimited translations</li>
                  <li>✓ Unlimited audio transcription</li>
                  <li>✓ Unlimited speech with Standard &amp; Studio voices</li>
                  <li>✓ No daily usage caps</li>
                  <li>
                    ✓ Live dictation (
                    {Math.round(premium.maxStreamDurationMs / 60000)}{" "}
                    min/session,{" "}
                    {formatLimit(premium.monthlyStreamMinutesLimit)} min/month)
                  </li>
                  <li>
                    ✓ Voice notes up to{" "}
                    {Math.round(premium.dictationDurationMs / 60000)} min
                  </li>
                  <li>✓ {premium.historyRemoteTtlDays}-day cloud history</li>
                  <li>✓ No ads</li>
                  <li>✓ Automatic language detection</li>
                  <li>✓ Custom avatar icons</li>
                  <li>✓ Auto-copy translations</li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="download" className="cta-section">
        <div className="container">
          <Reveal>
            <div className="cta-box">
              <h2>Ready to start?</h2>
              <p>
                Download {siteConfig.app.name} free and start translating in
                seconds — no daily cap, no card required.
              </p>
              <div className="platform-badge">
                <span className="platform-badge-icon">📱</span> Android · iOS
                coming soon
              </div>
              <div className="cta-actions">
                <a
                  href={siteConfig.links.download}
                  className="btn btn-primary"
                  data-download-primary
                >
                  <Download size={18} /> Download APK for Android
                </a>
                <span
                  className="btn btn-secondary btn-pending"
                  role="button"
                  aria-disabled="true"
                >
                  <Apple size={18} /> iOS — Coming soon
                </span>
              </div>
              <div className="version-badge">v{siteConfig.app.version}</div>
            </div>
          </Reveal>
        </div>
      </section>
      <Footer />
    </>
  );
}
