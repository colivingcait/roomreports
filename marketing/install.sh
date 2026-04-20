#!/usr/bin/env bash
# Install the RoomReport marketing site on the production droplet.
#
# Run from your laptop:
#   ssh root@68.183.111.240 'bash -s' < marketing/install.sh
#
# Writes the static site to /var/www/roomreport-marketing/, installs the
# roomreport.co Nginx server block, tests the config, and reloads Nginx.
set -euo pipefail

MARKETING_DIR="/var/www/roomreport-marketing"
NGINX_AVAILABLE="/etc/nginx/sites-available/roomreport.co"
NGINX_ENABLED="/etc/nginx/sites-enabled/roomreport.co"

if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root (got uid $(id -u))." >&2
    exit 1
fi

echo "==> Preparing ${MARKETING_DIR}"
mkdir -p "${MARKETING_DIR}"

echo "==> Writing index.html"
cat > "${MARKETING_DIR}/index.html" <<'ROOMREPORT_HTML_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RoomReport — Room-by-room inspections for property managers</title>
  <meta name="description" content="Run room inspections from your phone. Flag issues, snap photos, assign maintenance, and let residents document their own spaces. Built for co-living operators and small portfolio managers." />
  <meta name="keywords" content="room inspection software, property management inspections, co-living, maintenance tracking, move-in documentation, resident self-check, rental property inspection app" />
  <meta name="author" content="RoomReport" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="RoomReport — Know exactly what's happening in every room" />
  <meta property="og:description" content="Room-by-room inspections, resident self-checks, and maintenance tracking in one simple app." />
  <meta property="og:url" content="https://roomreport.co/" />
  <meta property="og:site_name" content="RoomReport" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="RoomReport — Know exactly what's happening in every room" />
  <meta name="twitter:description" content="Room-by-room inspections, resident self-checks, and maintenance tracking in one simple app." />

  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="canonical" href="https://roomreport.co/" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <link rel="stylesheet" href="styles.css" />
</head>
<body>

  <header class="nav" id="nav">
    <div class="nav__inner">
      <a href="#" class="nav__brand" aria-label="RoomReport home">
        <span class="nav__logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect width="32" height="32" rx="7" fill="#6B8F71"/>
            <path d="M7 11 L16 5 L25 11 L25 26 L7 26 Z" fill="#FAF8F5"/>
            <rect x="11" y="16" width="10" height="10" fill="#C4703F"/>
          </svg>
        </span>
        <span>RoomReport</span>
      </a>

      <nav class="nav__links" aria-label="Primary">
        <a href="#features">Features</a>
        <a href="#inspections">Inspections</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
      </nav>

      <div class="nav__cta">
        <a href="https://app.roomreport.co/signup" class="btn btn--primary">Start free</a>
      </div>

      <button class="nav__toggle" id="navToggle" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>

    <div class="nav__mobile" id="navMobile" hidden>
      <a href="#features">Features</a>
      <a href="#inspections">Inspections</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      <a href="https://app.roomreport.co/signup" class="btn btn--primary btn--block">Start free</a>
    </div>
  </header>

  <main>

    <!-- HERO -->
    <section class="hero">
      <div class="container hero__grid">
        <div class="hero__copy reveal">
          <span class="eyebrow">For co-living operators &amp; small portfolios</span>
          <h1 class="hero__title">Know exactly what's happening in every room.</h1>
          <p class="hero__sub">Run room inspections from your phone. Flag issues, snap photos, assign maintenance — and let residents document their own spaces too.</p>
          <div class="hero__ctas">
            <a href="https://app.roomreport.co/signup" class="btn btn--primary btn--lg">Start free</a>
            <a href="#features" class="btn btn--ghost btn--lg">See how it works</a>
          </div>
          <ul class="hero__meta">
            <li><span aria-hidden="true">✓</span> No credit card</li>
            <li><span aria-hidden="true">✓</span> Works offline</li>
            <li><span aria-hidden="true">✓</span> Set up in 10 min</li>
          </ul>
        </div>

        <!-- Phone mockup -->
        <div class="hero__phone reveal" aria-hidden="true">
          <div class="phone">
            <div class="phone__notch"></div>
            <div class="phone__screen">
              <div class="phone__bar">
                <span class="phone__time">9:41</span>
                <span class="phone__icons">
                  <span class="phone__signal"></span>
                  <span class="phone__battery"></span>
                </span>
              </div>

              <div class="phone__header">
                <div class="phone__crumb">Maple House · Room 3</div>
                <div class="phone__title">Room Inspection</div>
                <div class="phone__progress"><span></span></div>
                <div class="phone__progress-text">5 of 8 items</div>
              </div>

              <ul class="phone__list">
                <li class="phone__item phone__item--done">
                  <span class="check check--pass"></span>
                  <div>
                    <strong>Bed &amp; linens</strong>
                    <em>Clean, no stains</em>
                  </div>
                </li>
                <li class="phone__item phone__item--done">
                  <span class="check check--pass"></span>
                  <div>
                    <strong>Windows</strong>
                    <em>Open &amp; close smoothly</em>
                  </div>
                </li>
                <li class="phone__item phone__item--flag">
                  <span class="check check--flag">!</span>
                  <div>
                    <strong>Blinds</strong>
                    <em>Cord broken · photo attached</em>
                    <span class="phone__chip">Maintenance</span>
                  </div>
                </li>
                <li class="phone__item phone__item--done">
                  <span class="check check--pass"></span>
                  <div>
                    <strong>Outlets</strong>
                    <em>All working</em>
                  </div>
                </li>
                <li class="phone__item phone__item--active">
                  <span class="check"></span>
                  <div>
                    <strong>Floor &amp; baseboards</strong>
                    <em>Tap to pass or flag</em>
                  </div>
                </li>
              </ul>

              <div class="phone__cta">
                <button class="phone__btn">Continue to bathroom →</button>
              </div>
            </div>
          </div>
          <div class="phone__shadow"></div>
          <span class="phone__sticker phone__sticker--1">📸 photo attached</span>
          <span class="phone__sticker phone__sticker--2">✅ 5 passed</span>
        </div>
      </div>
    </section>

    <!-- LOGO STRIP -->
    <section class="strip">
      <div class="container strip__inner reveal">
        <span>Built for modern residential operators</span>
        <div class="strip__stats">
          <div><strong>15 min</strong><em>average inspection</em></div>
          <div><strong>&lt; 3 min</strong><em>resident self-check</em></div>
          <div><strong>100%</strong><em>offline capable</em></div>
        </div>
      </div>
    </section>

    <!-- FEATURES -->
    <section class="features" id="features">
      <div class="container">
        <header class="section-head reveal">
          <span class="eyebrow">Features</span>
          <h2>Everything you need to run a tight house.</h2>
          <p>Six tools that replace clipboards, group chats, and spreadsheets.</p>
        </header>

        <div class="features__grid">
          <article class="feature reveal">
            <div class="feature__num">01</div>
            <h3>Inspect every room in minutes</h3>
            <p>Walk the house room by room from your phone. Pass or flag, snap photos, generate a maintenance list.</p>
            <div class="feature__vis feature__vis--rooms">
              <span class="room-pill">Bedroom 1 <b>✓</b></span>
              <span class="room-pill">Bedroom 2 <b>✓</b></span>
              <span class="room-pill room-pill--flag">Kitchen <b>!</b></span>
              <span class="room-pill">Bathroom <b>✓</b></span>
              <span class="room-pill room-pill--active">Living room…</span>
            </div>
          </article>

          <article class="feature reveal">
            <div class="feature__num">02</div>
            <h3>Let your residents document their own space</h3>
            <p>Residents scan a QR code for move-in photos and monthly self-checks. No app, no login.</p>
            <div class="feature__vis feature__vis--qr">
              <div class="qr">
                <div class="qr__grid"></div>
              </div>
              <div class="qr__label">
                <strong>Scan to start</strong>
                <em>Takes 3 minutes</em>
              </div>
            </div>
          </article>

          <article class="feature reveal">
            <div class="feature__num">03</div>
            <h3>Your cleaners run the checklist, you review the report</h3>
            <p>Room turns and common area inspections done by your team. You approve and decide what becomes a task.</p>
            <div class="feature__vis feature__vis--review">
              <div class="review-row">
                <span class="dot dot--green"></span>
                <span>Maya completed Common Area</span>
                <em>2h ago</em>
              </div>
              <div class="review-row">
                <span class="dot dot--orange"></span>
                <span>Jon finished Room Turn · 3 flags</span>
                <em>Today</em>
              </div>
              <div class="review-row review-row--pending">
                <span class="dot dot--grey"></span>
                <span>Awaiting your review</span>
                <em>—</em>
              </div>
            </div>
          </article>

          <article class="feature reveal">
            <div class="feature__num">04</div>
            <h3>Track every maintenance item to resolution</h3>
            <p>Kanban board. Assign to team or vendors, track costs, attach invoices, generate work orders.</p>
            <div class="feature__vis feature__vis--kanban">
              <div class="kanban-col">
                <span class="kanban-col__title">New</span>
                <div class="kanban-card">Leaky faucet</div>
              </div>
              <div class="kanban-col">
                <span class="kanban-col__title">In progress</span>
                <div class="kanban-card kanban-card--amber">Broken blind</div>
              </div>
              <div class="kanban-col">
                <span class="kanban-col__title">Done</span>
                <div class="kanban-card kanban-card--green">Drain cleared</div>
              </div>
            </div>
          </article>

          <article class="feature reveal">
            <div class="feature__num">05</div>
            <h3>Protect yourself in deposit disputes</h3>
            <p>Timestamped move-in photos paired with room turn documentation. Side-by-side proof.</p>
            <div class="feature__vis feature__vis--compare">
              <div class="compare-card">
                <span class="compare-card__label">Move-in · Jan 3</span>
                <div class="compare-card__ph"></div>
              </div>
              <div class="compare-card compare-card--after">
                <span class="compare-card__label">Move-out · Oct 12</span>
                <div class="compare-card__ph compare-card__ph--damaged"></div>
              </div>
            </div>
          </article>

          <article class="feature reveal">
            <div class="feature__num">06</div>
            <h3>See your portfolio health at a glance</h3>
            <p>Property health grades, maintenance costs by room, inspection history, overdue alerts.</p>
            <div class="feature__vis feature__vis--dash">
              <div class="grade-card">
                <span>Maple House</span>
                <strong class="grade grade--a">A</strong>
              </div>
              <div class="grade-card">
                <span>Oak Street</span>
                <strong class="grade grade--b">B+</strong>
              </div>
              <div class="grade-card grade-card--alert">
                <span>Pine Duplex · 2 overdue</span>
                <strong class="grade grade--c">C</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- INSPECTIONS -->
    <section class="inspections" id="inspections">
      <div class="container">
        <header class="section-head reveal">
          <span class="eyebrow">Inspection types</span>
          <h2>Five inspections, one workflow.</h2>
          <p>Purpose-built checklists for every moment in the resident lifecycle.</p>
        </header>

        <div class="inspections__grid">
          <article class="insp-card reveal">
            <div class="insp-card__icon insp-card__icon--sage">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 10 L12 4 L20 10 V20 H4 Z"/><path d="M10 20 V14 H14 V20"/>
              </svg>
            </div>
            <h3>Room Inspection</h3>
            <p>Walk any bedroom or suite room-by-room. Pass, flag, and photograph issues on the spot.</p>
          </article>

          <article class="insp-card reveal">
            <div class="insp-card__icon insp-card__icon--terra">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12 H21"/><path d="M5 7 H19 V17 H5 Z"/><path d="M9 7 V17"/><path d="M15 7 V17"/>
              </svg>
            </div>
            <h3>Common Area</h3>
            <p>Kitchens, living rooms, laundry, hallways. Built for shared spaces that need daily eyes.</p>
          </article>

          <article class="insp-card reveal">
            <div class="insp-card__icon insp-card__icon--sage">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12 a9 9 0 1 1 -3 -6.7"/><polyline points="21 4 21 12 13 12"/>
              </svg>
            </div>
            <h3>Room Turn</h3>
            <p>Deep-clean checklist for between residents. Assign to cleaners, review what's ready to list.</p>
          </article>

          <article class="insp-card reveal">
            <div class="insp-card__icon insp-card__icon--terra">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12 l3 3 l5 -6"/>
              </svg>
            </div>
            <h3>Move-In</h3>
            <p>Resident-led photo documentation of the room on day one. Timestamped and stored forever.</p>
          </article>

          <article class="insp-card reveal">
            <div class="insp-card__icon insp-card__icon--sage">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4"/><path d="M4 21 c0 -4 4 -7 8 -7 s8 3 8 7"/>
              </svg>
            </div>
            <h3>Resident Self-Check</h3>
            <p>A light monthly check-in from the resident's phone. Keeps issues from piling up unnoticed.</p>
          </article>
        </div>
      </div>
    </section>

    <!-- MAINTENANCE -->
    <section class="maint">
      <div class="container maint__grid">
        <div class="maint__copy reveal">
          <span class="eyebrow">Maintenance</span>
          <h2>Every issue, tracked to resolution.</h2>
          <p>When an inspector flags something, it lands on your maintenance board. Decide if it's a task, assign it to your team or a vendor, track cost, attach the invoice, and close it out. Nothing falls through the cracks — and you have a clean paper trail when the resident asks what happened.</p>
          <ul class="maint__bullets">
            <li>Flag from any inspection</li>
            <li>Assign internally or to vendors</li>
            <li>Attach photos, quotes, and invoices</li>
            <li>Generate work orders in one click</li>
          </ul>
        </div>

        <div class="maint__board reveal">
          <div class="board">
            <div class="board__col">
              <header>New <span>3</span></header>
              <div class="board__card"><strong>Leaky faucet</strong><em>Maple · Kitchen</em></div>
              <div class="board__card"><strong>HVAC filter</strong><em>Oak · Hall</em></div>
              <div class="board__card"><strong>Loose outlet</strong><em>Pine · Room 2</em></div>
            </div>
            <div class="board__col">
              <header>In progress <span>2</span></header>
              <div class="board__card board__card--amber"><strong>Broken blind</strong><em>Assigned · Jon</em></div>
              <div class="board__card board__card--amber"><strong>Paint touch-up</strong><em>Vendor · Mira's Painting</em></div>
            </div>
            <div class="board__col">
              <header>Done <span>12</span></header>
              <div class="board__card board__card--green"><strong>Drain cleared</strong><em>$120 · invoice</em></div>
              <div class="board__card board__card--green"><strong>Shower head</strong><em>$40 · DIY</em></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="faq" id="faq">
      <div class="container faq__container">
        <header class="section-head reveal">
          <span class="eyebrow">FAQ</span>
          <h2>Answers before you ask.</h2>
        </header>

        <div class="faq__list reveal">
          <details class="faq-item">
            <summary>How long does an inspection take?</summary>
            <p>About 15 minutes for an 8-room house. Common area inspections typically run 10–15 minutes depending on how thorough you want to be.</p>
          </details>
          <details class="faq-item">
            <summary>Do my residents need to download an app?</summary>
            <p>No. Residents scan a QR code that opens in the browser. No login required, and most self-checks are done in under 3 minutes.</p>
          </details>
          <details class="faq-item">
            <summary>How does maintenance tracking work?</summary>
            <p>Flag an item during inspection → it appears in your review queue → you decide whether it becomes a task → assign it to team or a vendor → track through to close on a kanban board.</p>
          </details>
          <details class="faq-item">
            <summary>Can my cleaning team use this?</summary>
            <p>Yes. Invite team members, assign them to specific properties, and they see a simple Start button for whatever's on the schedule that day.</p>
          </details>
          <details class="faq-item">
            <summary>Does it work without wifi?</summary>
            <p>Yes. Full offline mode — complete the inspection, photos and all, and it syncs automatically when you're back online.</p>
          </details>
          <details class="faq-item">
            <summary>Is there a paper trail for lease violations?</summary>
            <p>Yes. Every flag, photo, and note is timestamped. The violation log captures the original issue and every follow-up, so you have dated evidence if disputes arise.</p>
          </details>
          <details class="faq-item">
            <summary>How much does it cost?</summary>
            <p>Three plans: $19/mo Starter (up to 2 properties), $39/mo Growth (up to 5), and $79/mo Unlimited. See the pricing section below for what's in each tier.</p>
          </details>
        </div>
      </div>
    </section>

    <!-- PRICING -->
    <section class="pricing" id="pricing">
      <div class="container">
        <header class="section-head reveal">
          <span class="eyebrow">Pricing</span>
          <h2>Simple plans that scale with your portfolio.</h2>
          <p>Start free. Upgrade when you're ready.</p>
        </header>

        <div class="pricing__grid">
          <article class="plan reveal">
            <header class="plan__head">
              <h3>Starter</h3>
              <p class="plan__blurb">For the first one or two properties.</p>
              <div class="plan__price"><strong>$19</strong><em>/ month</em></div>
              <span class="plan__cap">Up to 2 properties</span>
            </header>
            <ul class="plan__list">
              <li>All inspection types</li>
              <li>Maintenance tracking</li>
              <li>Resident self-check links</li>
              <li>Move-in documentation</li>
              <li>Offline mode</li>
            </ul>
            <a href="https://app.roomreport.co/signup" class="btn btn--ghost btn--block">Start free</a>
          </article>

          <article class="plan plan--featured reveal">
            <span class="plan__badge">Most popular</span>
            <header class="plan__head">
              <h3>Growth</h3>
              <p class="plan__blurb">For operators running a handful of houses.</p>
              <div class="plan__price"><strong>$39</strong><em>/ month</em></div>
              <span class="plan__cap">Up to 5 properties</span>
            </header>
            <ul class="plan__list">
              <li>Everything in Starter</li>
              <li>Vendor management</li>
              <li>Team roles &amp; permissions</li>
              <li>Custom inspection templates</li>
              <li>Portfolio reports</li>
            </ul>
            <a href="https://app.roomreport.co/signup" class="btn btn--primary btn--block">Start free</a>
          </article>

          <article class="plan reveal">
            <header class="plan__head">
              <h3>Unlimited</h3>
              <p class="plan__blurb">For growing portfolios and larger teams.</p>
              <div class="plan__price"><strong>$79</strong><em>/ month</em></div>
              <span class="plan__cap">Unlimited properties &amp; team</span>
            </header>
            <ul class="plan__list">
              <li>Everything in Growth</li>
              <li>Unlimited properties</li>
              <li>Unlimited team members</li>
              <li>Priority support</li>
              <li>Onboarding session</li>
            </ul>
            <a href="https://app.roomreport.co/signup" class="btn btn--ghost btn--block">Start free</a>
          </article>
        </div>
      </div>
    </section>

    <!-- CTA BANNER -->
    <section class="cta">
      <div class="container cta__inner reveal">
        <h2>Ready to know what's happening in every room?</h2>
        <p>Set up your first property in about ten minutes. No credit card required.</p>
        <a href="https://app.roomreport.co/signup" class="btn btn--primary btn--lg">Start free</a>
      </div>
    </section>

  </main>

  <footer class="footer">
    <div class="container footer__inner">
      <div class="footer__brand">
        <a href="#" class="nav__brand" aria-label="RoomReport home">
          <span class="nav__logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="24" height="24">
              <rect width="32" height="32" rx="7" fill="#6B8F71"/>
              <path d="M7 11 L16 5 L25 11 L25 26 L7 26 Z" fill="#FAF8F5"/>
              <rect x="11" y="16" width="10" height="10" fill="#C4703F"/>
            </svg>
          </span>
          <span>RoomReport</span>
        </a>
        <p>Room-by-room inspections for people who actually run houses.</p>
      </div>

      <div class="footer__cols">
        <div>
          <h4>Product</h4>
          <a href="#features">Features</a>
          <a href="#inspections">Inspections</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div>
          <h4>Company</h4>
          <a href="#faq">FAQ</a>
          <a href="mailto:hello@roomreport.co">Contact</a>
          <a href="https://app.roomreport.co/signup">Sign up</a>
        </div>
        <div>
          <h4>Legal</h4>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </div>
      </div>
    </div>
    <div class="footer__bar container">
      <small>© 2026 RoomReport. All rights reserved.</small>
      <small>Made for operators who care about the details.</small>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>
ROOMREPORT_HTML_EOF

echo "==> Writing styles.css"
cat > "${MARKETING_DIR}/styles.css" <<'ROOMREPORT_CSS_EOF'
/* ==========================================================================
   RoomReport — Marketing site styles
   Palette: sage #6B8F71 · terracotta #C4703F · cream #FAF8F5 · charcoal #4A4543
   ========================================================================== */

:root {
  --sage: #6B8F71;
  --sage-dark: #567059;
  --sage-soft: #E3ECDF;
  --terra: #C4703F;
  --terra-dark: #A85A2C;
  --terra-soft: #F3DFCF;
  --cream: #FAF8F5;
  --cream-2: #F3EFE8;
  --charcoal: #4A4543;
  --charcoal-soft: #6E6764;
  --line: #E9E3DA;
  --white: #FFFFFF;
  --shadow-sm: 0 2px 6px rgba(74, 69, 67, 0.06);
  --shadow-md: 0 10px 30px rgba(74, 69, 67, 0.08);
  --shadow-lg: 0 30px 60px rgba(74, 69, 67, 0.12);
  --radius-sm: 8px;
  --radius: 14px;
  --radius-lg: 22px;
  --radius-xl: 32px;
  --ease: cubic-bezier(.2,.7,.2,1);
  --container: 1180px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--cream);
  color: var(--charcoal);
  font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 17px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

img, svg { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }

h1, h2, h3, h4 {
  font-family: 'Fraunces', Georgia, serif;
  color: var(--charcoal);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin: 0 0 0.4em;
}

h1 { font-size: clamp(2.4rem, 5.2vw, 4rem); font-weight: 600; letter-spacing: -0.02em; }
h2 { font-size: clamp(1.9rem, 3.4vw, 2.8rem); }
h3 { font-size: 1.3rem; }
h4 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.1em; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--charcoal-soft); }

p { margin: 0 0 1em; color: var(--charcoal-soft); }

.container {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 24px;
}

.eyebrow {
  display: inline-block;
  font-size: 0.8rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--sage-dark);
  background: var(--sage-soft);
  padding: 6px 12px;
  border-radius: 999px;
  margin-bottom: 16px;
}

.section-head {
  text-align: center;
  max-width: 720px;
  margin: 0 auto 56px;
}
.section-head p { font-size: 1.1rem; }

/* ========= Buttons ========= */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 22px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.95rem;
  font-family: inherit;
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: transform .2s var(--ease), box-shadow .2s var(--ease), background-color .2s var(--ease), color .2s var(--ease);
  white-space: nowrap;
}
.btn--primary { background: var(--terra); color: var(--white); border-color: var(--terra); box-shadow: 0 4px 14px rgba(196,112,63,.28); }
.btn--primary:hover { background: var(--terra-dark); border-color: var(--terra-dark); transform: translateY(-1px); box-shadow: 0 8px 20px rgba(196,112,63,.3); }
.btn--ghost { background: transparent; color: var(--charcoal); border-color: var(--line); }
.btn--ghost:hover { border-color: var(--charcoal); transform: translateY(-1px); }
.btn--lg { padding: 15px 28px; font-size: 1rem; }
.btn--block { display: flex; width: 100%; }

/* ========= Nav ========= */
.nav {
  position: sticky;
  top: 0;
  z-index: 40;
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  background: rgba(250, 248, 245, 0.78);
  border-bottom: 1px solid transparent;
  transition: border-color .25s var(--ease), background-color .25s var(--ease);
}
.nav--scrolled { border-bottom-color: var(--line); background: rgba(250, 248, 245, 0.92); }

.nav__inner {
  max-width: var(--container);
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.nav__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 1.15rem;
  color: var(--charcoal);
}
.nav__logo { display: inline-flex; }
.nav__links {
  margin-left: auto;
  display: flex;
  gap: 28px;
  font-weight: 500;
  font-size: 0.95rem;
}
.nav__links a { color: var(--charcoal-soft); transition: color .2s; }
.nav__links a:hover { color: var(--charcoal); }
.nav__cta .btn { padding: 10px 18px; }

.nav__toggle {
  display: none;
  margin-left: auto;
  background: transparent;
  border: 0;
  width: 44px;
  height: 44px;
  cursor: pointer;
  padding: 10px;
}
.nav__toggle span {
  display: block;
  height: 2px;
  background: var(--charcoal);
  border-radius: 2px;
  margin: 5px 0;
  transition: transform .25s var(--ease), opacity .2s var(--ease);
}
.nav__toggle[aria-expanded="true"] span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.nav__toggle[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
.nav__toggle[aria-expanded="true"] span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.nav__mobile {
  display: none;
  flex-direction: column;
  gap: 16px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--line);
  background: var(--cream);
}
.nav__mobile a { color: var(--charcoal); font-weight: 500; padding: 8px 0; }

/* ========= Hero ========= */
.hero {
  position: relative;
  padding: 72px 0 96px;
  overflow: hidden;
}
.hero::before {
  content: "";
  position: absolute;
  inset: -120px -10% auto auto;
  width: 780px;
  height: 780px;
  background: radial-gradient(closest-side, rgba(107,143,113,0.18), transparent 70%);
  z-index: 0;
  pointer-events: none;
}
.hero::after {
  content: "";
  position: absolute;
  inset: auto auto -180px -20%;
  width: 520px;
  height: 520px;
  background: radial-gradient(closest-side, rgba(196,112,63,0.15), transparent 70%);
  z-index: 0;
  pointer-events: none;
}
.hero__grid {
  position: relative;
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 56px;
  align-items: center;
  z-index: 1;
}
.hero__title { margin-top: 8px; margin-bottom: 18px; }
.hero__sub { font-size: 1.2rem; max-width: 560px; color: var(--charcoal-soft); margin-bottom: 32px; }
.hero__ctas { display: flex; flex-wrap: wrap; gap: 12px; }
.hero__meta {
  margin: 32px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 20px 28px;
  list-style: none;
  color: var(--charcoal-soft);
  font-size: 0.95rem;
}
.hero__meta li { display: inline-flex; align-items: center; gap: 8px; }
.hero__meta span { color: var(--sage-dark); font-weight: 700; }

/* Phone mockup */
.hero__phone {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 560px;
}
.phone {
  position: relative;
  width: 300px;
  background: var(--charcoal);
  border-radius: 44px;
  padding: 10px;
  box-shadow: var(--shadow-lg), inset 0 0 0 1px rgba(255,255,255,.05);
  transform: rotate(-2deg);
  z-index: 2;
}
.phone__notch {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: 86px;
  height: 22px;
  background: #0b0b0b;
  border-radius: 14px;
  z-index: 3;
}
.phone__screen {
  background: var(--cream);
  border-radius: 34px;
  padding: 44px 16px 16px;
  overflow: hidden;
}
.phone__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--charcoal);
  padding: 0 6px 10px;
}
.phone__icons { display: inline-flex; gap: 5px; align-items: center; }
.phone__signal, .phone__battery {
  display: inline-block;
  width: 14px; height: 8px;
  background: var(--charcoal);
  border-radius: 2px;
}
.phone__battery { width: 20px; border-radius: 3px; }

.phone__header { padding: 4px 6px 12px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.phone__crumb { font-size: 0.7rem; color: var(--charcoal-soft); text-transform: uppercase; letter-spacing: 0.1em; }
.phone__title { font-family: 'Fraunces', serif; font-size: 1.15rem; margin: 4px 0 10px; color: var(--charcoal); font-weight: 600; }
.phone__progress { background: var(--line); height: 6px; border-radius: 999px; overflow: hidden; }
.phone__progress span { display: block; width: 62%; height: 100%; background: var(--sage); border-radius: 999px; }
.phone__progress-text { font-size: 0.72rem; color: var(--charcoal-soft); margin-top: 6px; }

.phone__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.phone__item {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 10px;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.phone__item strong { display: block; font-size: 0.82rem; color: var(--charcoal); font-weight: 600; }
.phone__item em { display: block; font-style: normal; font-size: 0.72rem; color: var(--charcoal-soft); }
.phone__item--done { background: var(--sage-soft); border-color: transparent; }
.phone__item--flag { background: var(--terra-soft); border-color: transparent; }
.phone__item--active { border-color: var(--sage); box-shadow: 0 0 0 3px rgba(107,143,113,0.15); }

.check {
  display: inline-block;
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--charcoal-soft);
  margin-top: 2px;
  position: relative;
}
.check--pass { background: var(--sage); border-color: var(--sage); }
.check--pass::after {
  content: "";
  position: absolute;
  inset: 3px 0 0 5px;
  width: 5px; height: 9px;
  border: solid var(--white);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.check--flag {
  background: var(--terra); border-color: var(--terra);
  color: var(--white);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
  line-height: 18px;
}

.phone__chip {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.65rem;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--terra);
  color: var(--white);
  font-weight: 600;
}

.phone__cta { margin-top: 14px; }
.phone__btn {
  width: 100%;
  background: var(--sage);
  color: var(--white);
  border: 0;
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  font-family: inherit;
}

.phone__shadow {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 240px;
  height: 24px;
  background: rgba(74,69,67,0.25);
  filter: blur(16px);
  border-radius: 50%;
  z-index: 1;
}
.phone__sticker {
  position: absolute;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--charcoal);
  box-shadow: var(--shadow-md);
  z-index: 3;
}
.phone__sticker--1 { top: 18%; left: -4%; transform: rotate(-6deg); }
.phone__sticker--2 { bottom: 14%; right: -4%; transform: rotate(4deg); }

/* ========= Strip ========= */
.strip { padding: 8px 0 24px; }
.strip__inner {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 40px;
  align-items: center;
  padding: 28px 32px;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.strip__inner > span {
  font-weight: 600;
  color: var(--charcoal);
  font-size: 0.95rem;
  letter-spacing: -0.01em;
}
.strip__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  text-align: left;
}
.strip__stats strong {
  display: block;
  font-family: 'Fraunces', serif;
  font-size: 1.6rem;
  color: var(--charcoal);
  font-weight: 600;
}
.strip__stats em {
  font-style: normal;
  font-size: 0.85rem;
  color: var(--charcoal-soft);
}

/* ========= Features ========= */
.features { padding: 96px 0; }
.features__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.feature {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 32px;
  transition: transform .3s var(--ease), box-shadow .3s var(--ease), border-color .3s var(--ease);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 360px;
}
.feature:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: transparent;
}
.feature__num {
  display: inline-block;
  font-family: 'Fraunces', serif;
  font-size: 0.95rem;
  color: var(--terra);
  font-weight: 600;
  margin-bottom: 14px;
  letter-spacing: 0.02em;
}
.feature h3 { margin-bottom: 10px; font-size: 1.25rem; }
.feature p { font-size: 0.98rem; }
.feature__vis {
  margin-top: auto;
  padding-top: 20px;
}

.feature__vis--rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.room-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--cream-2);
  font-size: 0.82rem;
  color: var(--charcoal);
  font-weight: 500;
}
.room-pill b { color: var(--sage-dark); font-weight: 700; }
.room-pill--flag { background: var(--terra-soft); }
.room-pill--flag b { color: var(--terra-dark); }
.room-pill--active {
  background: var(--sage-soft); color: var(--sage-dark);
  border: 1px dashed var(--sage);
}

.feature__vis--qr {
  display: flex;
  align-items: center;
  gap: 16px;
}
.qr {
  width: 88px; height: 88px;
  background: var(--white);
  border: 2px solid var(--charcoal);
  border-radius: 10px;
  padding: 8px;
  flex-shrink: 0;
}
.qr__grid {
  width: 100%; height: 100%;
  background:
    conic-gradient(from 90deg at 50% 50%, var(--charcoal) 0 25%, transparent 0 100%),
    repeating-linear-gradient(0deg, var(--charcoal) 0 4px, transparent 4px 8px),
    repeating-linear-gradient(90deg, var(--charcoal) 0 4px, transparent 4px 8px);
  background-blend-mode: xor;
  mask:
    linear-gradient(#000 0 0),
    radial-gradient(circle at top left, #000 14px, transparent 15px),
    radial-gradient(circle at top right, #000 14px, transparent 15px),
    radial-gradient(circle at bottom left, #000 14px, transparent 15px);
  -webkit-mask-composite: source-over;
          mask-composite: add;
}
.qr__label strong { display: block; color: var(--charcoal); font-weight: 600; }
.qr__label em { font-style: normal; color: var(--charcoal-soft); font-size: 0.9rem; }

.feature__vis--review { display: flex; flex-direction: column; gap: 8px; }
.review-row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  background: var(--cream-2);
  border-radius: 10px;
  font-size: 0.88rem;
  color: var(--charcoal);
}
.review-row em { font-style: normal; color: var(--charcoal-soft); font-size: 0.8rem; }
.review-row--pending { background: transparent; border: 1px dashed var(--line); color: var(--charcoal-soft); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.dot--green { background: var(--sage); }
.dot--orange { background: var(--terra); }
.dot--grey { background: var(--line); }

.feature__vis--kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.kanban-col {
  background: var(--cream-2);
  border-radius: 10px;
  padding: 10px;
}
.kanban-col__title {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--charcoal-soft);
  font-weight: 600;
  margin-bottom: 8px;
}
.kanban-card {
  background: var(--white);
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 500;
  border-left: 3px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.kanban-card--amber { border-left-color: var(--terra); }
.kanban-card--green { border-left-color: var(--sage); }

.feature__vis--compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.compare-card {
  background: var(--cream-2);
  border-radius: 10px;
  padding: 10px;
}
.compare-card__label {
  display: block;
  font-size: 0.72rem;
  color: var(--charcoal-soft);
  margin-bottom: 6px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.compare-card__ph {
  height: 54px;
  background: linear-gradient(135deg, var(--sage-soft), var(--white));
  border-radius: 6px;
}
.compare-card__ph--damaged {
  background: linear-gradient(135deg, var(--terra-soft), var(--white));
  position: relative;
}
.compare-card__ph--damaged::after {
  content: "";
  position: absolute;
  top: 30%; left: 20%;
  width: 38%; height: 10%;
  background: rgba(74,69,67,0.35);
  border-radius: 4px;
  transform: rotate(-6deg);
}

.feature__vis--dash { display: flex; flex-direction: column; gap: 6px; }
.grade-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--cream-2);
  border-radius: 10px;
  font-size: 0.92rem;
  color: var(--charcoal);
  font-weight: 500;
}
.grade-card--alert { background: var(--terra-soft); }
.grade {
  font-family: 'Fraunces', serif;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--charcoal);
}
.grade--a { color: var(--sage-dark); }
.grade--b { color: var(--sage-dark); }
.grade--c { color: var(--terra-dark); }

/* ========= Inspections ========= */
.inspections {
  padding: 96px 0;
  background: linear-gradient(180deg, var(--cream) 0%, var(--cream-2) 100%);
}
.inspections__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 18px;
}
.insp-card {
  background: var(--white);
  border-radius: var(--radius-lg);
  padding: 28px 22px;
  border: 1px solid var(--line);
  transition: transform .3s var(--ease), box-shadow .3s var(--ease);
  min-height: 260px;
  display: flex;
  flex-direction: column;
}
.insp-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
}
.insp-card__icon {
  width: 52px; height: 52px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  color: var(--white);
}
.insp-card__icon svg { width: 26px; height: 26px; }
.insp-card__icon--sage { background: var(--sage); }
.insp-card__icon--terra { background: var(--terra); }
.insp-card h3 { font-size: 1.15rem; margin-bottom: 6px; }
.insp-card p { font-size: 0.92rem; margin: 0; }

/* ========= Maintenance ========= */
.maint {
  padding: 96px 0;
  background: var(--charcoal);
  color: var(--cream);
}
.maint h2, .maint h3 { color: var(--cream); }
.maint p { color: rgba(250,248,245,0.75); }
.maint .eyebrow {
  background: rgba(107,143,113,0.25);
  color: var(--sage-soft);
}
.maint__grid {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 56px;
  align-items: center;
}
.maint__bullets {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.maint__bullets li {
  position: relative;
  padding-left: 28px;
  color: var(--cream);
  font-size: 1rem;
}
.maint__bullets li::before {
  content: "";
  position: absolute;
  left: 0; top: 8px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--terra);
}
.maint__bullets li::after {
  content: "";
  position: absolute;
  left: 4px; top: 11px;
  width: 3px; height: 6px;
  border: solid var(--white);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-lg);
}
.board__col {
  background: rgba(250,248,245,0.05);
  border-radius: 14px;
  padding: 14px 12px;
  min-height: 280px;
}
.board__col header {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(250,248,245,0.65);
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-weight: 600;
}
.board__col header span {
  background: rgba(250,248,245,0.1);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  letter-spacing: 0;
}
.board__card {
  background: var(--cream);
  color: var(--charcoal);
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 8px;
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--line);
}
.board__card strong { display: block; font-size: 0.9rem; font-weight: 600; }
.board__card em { font-style: normal; font-size: 0.78rem; color: var(--charcoal-soft); }
.board__card--amber { border-left-color: var(--terra); }
.board__card--green { border-left-color: var(--sage); }

/* ========= FAQ ========= */
.faq { padding: 96px 0; }
.faq__container { max-width: 820px; }
.faq__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.faq-item {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 4px 22px;
  transition: border-color .2s, box-shadow .2s;
}
.faq-item[open] {
  border-color: transparent;
  box-shadow: var(--shadow-md);
}
.faq-item summary {
  list-style: none;
  cursor: pointer;
  padding: 18px 0;
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--charcoal);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after {
  content: "+";
  font-family: 'Fraunces', serif;
  font-size: 1.6rem;
  color: var(--sage);
  transition: transform .3s var(--ease);
  line-height: 1;
}
.faq-item[open] summary::after { transform: rotate(45deg); }
.faq-item p {
  margin: 0 0 18px;
  color: var(--charcoal-soft);
  font-size: 0.98rem;
}

/* ========= Pricing ========= */
.pricing {
  padding: 96px 0;
  background: var(--cream-2);
}
.pricing__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  align-items: stretch;
}
.plan {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 32px;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: transform .3s var(--ease), box-shadow .3s var(--ease);
}
.plan:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
}
.plan--featured {
  background: var(--charcoal);
  color: var(--cream);
  border-color: transparent;
  box-shadow: var(--shadow-lg);
  transform: translateY(-12px);
}
.plan--featured:hover { transform: translateY(-16px); }
.plan--featured h3,
.plan--featured .plan__price strong { color: var(--cream); }
.plan--featured .plan__blurb,
.plan--featured .plan__price em,
.plan--featured .plan__cap { color: rgba(250,248,245,0.7); }
.plan--featured .plan__list li { color: var(--cream); }
.plan--featured .plan__list li::before { background: var(--terra); }

.plan__badge {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--terra);
  color: var(--white);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}
.plan__head { margin-bottom: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.plan--featured .plan__head { border-bottom-color: rgba(250,248,245,0.14); }
.plan h3 { margin-bottom: 6px; }
.plan__blurb { font-size: 0.95rem; margin-bottom: 18px; min-height: 2.8em; }
.plan__price { display: flex; align-items: baseline; gap: 6px; margin-bottom: 10px; }
.plan__price strong {
  font-family: 'Fraunces', serif;
  font-size: 3rem;
  font-weight: 600;
  color: var(--charcoal);
  line-height: 1;
}
.plan__price em { font-style: normal; color: var(--charcoal-soft); font-size: 0.95rem; }
.plan__cap { display: inline-block; font-size: 0.9rem; color: var(--charcoal-soft); font-weight: 500; }
.plan__list { list-style: none; padding: 0; margin: 0 0 26px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.plan__list li {
  position: relative;
  padding-left: 24px;
  color: var(--charcoal);
  font-size: 0.95rem;
}
.plan__list li::before {
  content: "";
  position: absolute;
  left: 0; top: 8px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--sage);
}
.plan__list li::after {
  content: "";
  position: absolute;
  left: 3px; top: 10px;
  width: 3px; height: 6px;
  border: solid var(--white);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* ========= CTA banner ========= */
.cta { padding: 80px 0; }
.cta__inner {
  max-width: 820px;
  text-align: center;
  padding: 64px 40px;
  background: linear-gradient(135deg, var(--sage) 0%, var(--sage-dark) 100%);
  border-radius: var(--radius-xl);
  color: var(--cream);
  position: relative;
  overflow: hidden;
}
.cta__inner::before {
  content: "";
  position: absolute;
  inset: -40% auto auto -20%;
  width: 360px; height: 360px;
  background: radial-gradient(closest-side, rgba(196,112,63,0.35), transparent 70%);
  pointer-events: none;
}
.cta__inner h2 { color: var(--cream); margin-bottom: 12px; position: relative; z-index: 1; }
.cta__inner p { color: rgba(250,248,245,0.85); margin-bottom: 28px; position: relative; z-index: 1; }
.cta__inner .btn { position: relative; z-index: 1; }

/* ========= Footer ========= */
.footer {
  padding: 72px 0 24px;
  background: var(--cream);
  border-top: 1px solid var(--line);
}
.footer__inner {
  display: grid;
  grid-template-columns: 1.4fr 2fr;
  gap: 56px;
  margin-bottom: 40px;
}
.footer__brand p {
  max-width: 320px;
  margin-top: 14px;
  font-size: 0.95rem;
}
.footer__cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
}
.footer__cols a {
  display: block;
  color: var(--charcoal-soft);
  font-size: 0.95rem;
  padding: 4px 0;
  transition: color .2s;
}
.footer__cols a:hover { color: var(--charcoal); }
.footer__cols h4 { margin-bottom: 10px; }
.footer__bar {
  border-top: 1px solid var(--line);
  padding-top: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--charcoal-soft);
  flex-wrap: wrap;
  gap: 8px;
}

/* ========= Reveal animation ========= */
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity .7s var(--ease), transform .7s var(--ease);
}
.reveal.is-visible {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
  html { scroll-behavior: auto; }
}

/* ========= Responsive ========= */
@media (max-width: 960px) {
  .hero { padding: 48px 0 64px; }
  .hero__grid { grid-template-columns: 1fr; gap: 32px; }
  .hero__phone { min-height: 520px; }
  .features__grid { grid-template-columns: 1fr 1fr; }
  .inspections__grid { grid-template-columns: 1fr 1fr; }
  .maint__grid { grid-template-columns: 1fr; gap: 32px; }
  .pricing__grid { grid-template-columns: 1fr; max-width: 440px; margin: 0 auto; }
  .plan--featured { transform: none; }
  .plan--featured:hover { transform: translateY(-4px); }
  .strip__inner { grid-template-columns: 1fr; gap: 20px; text-align: left; }
  .footer__inner { grid-template-columns: 1fr; gap: 32px; }
}

@media (max-width: 720px) {
  body { font-size: 16px; }
  .nav__links, .nav__cta { display: none; }
  .nav__toggle { display: block; }
  .nav__mobile.is-open { display: flex; }
  .features__grid { grid-template-columns: 1fr; }
  .inspections__grid { grid-template-columns: 1fr; }
  .footer__cols { grid-template-columns: 1fr 1fr; gap: 24px; }
  .features, .inspections, .maint, .faq, .pricing { padding: 72px 0; }
  .section-head { margin-bottom: 40px; }
  .cta__inner { padding: 44px 24px; }
  .strip__stats { grid-template-columns: 1fr; gap: 12px; }
  .phone { width: 260px; }
}

@media (max-width: 480px) {
  .footer__cols { grid-template-columns: 1fr; }
  .phone__sticker--1 { left: 2%; }
  .phone__sticker--2 { right: 2%; }
  .hero__sub { font-size: 1.05rem; }
}
ROOMREPORT_CSS_EOF

echo "==> Writing script.js"
cat > "${MARKETING_DIR}/script.js" <<'ROOMREPORT_JS_EOF'
(function () {
  'use strict';

  // Sticky nav shadow on scroll
  const nav = document.getElementById('nav');
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('nav--scrolled', window.scrollY > 8);
  };
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile nav toggle
  const toggle = document.getElementById('navToggle');
  const mobile = document.getElementById('navMobile');
  if (toggle && mobile) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      if (!open) {
        mobile.hidden = false;
        // next frame so display registers before class toggles
        requestAnimationFrame(() => mobile.classList.add('is-open'));
      } else {
        mobile.classList.remove('is-open');
        mobile.hidden = true;
      }
    });

    // close mobile nav when a link is tapped
    mobile.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'false');
        mobile.classList.remove('is-open');
        mobile.hidden = true;
      });
    });
  }

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  // FAQ accordion: only one open at a time
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (item.open) {
        faqItems.forEach((other) => {
          if (other !== item) other.open = false;
        });
      }
    });
  });
})();
ROOMREPORT_JS_EOF

echo "==> Writing favicon.svg"
cat > "${MARKETING_DIR}/favicon.svg" <<'ROOMREPORT_SVG_EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#6B8F71"/>
  <path d="M14 22 L32 10 L50 22 L50 52 L14 52 Z" fill="#FAF8F5" stroke="#4A4543" stroke-width="2" stroke-linejoin="round"/>
  <rect x="22" y="32" width="20" height="20" fill="#C4703F"/>
  <path d="M24 38 L27 41 L33 35" stroke="#FAF8F5" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
ROOMREPORT_SVG_EOF

echo "==> Setting ownership and permissions"
chown -R www-data:www-data "${MARKETING_DIR}"
find "${MARKETING_DIR}" -type d -exec chmod 755 {} \;
find "${MARKETING_DIR}" -type f -exec chmod 644 {} \;

echo "==> Installing Nginx config for roomreport.co"
cat > "${NGINX_AVAILABLE}" <<'ROOMREPORT_NGINX_EOF'
# HTTP → HTTPS redirects (both apex and www)
server {
    listen 80;
    listen [::]:80;
    server_name roomreport.co www.roomreport.co;
    return 301 https://$host$request_uri;
}

# HTTPS www → apex redirect
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name www.roomreport.co;

    ssl_certificate /etc/letsencrypt/live/roomreport.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/roomreport.co/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://roomreport.co$request_uri;
}

# HTTPS apex — marketing site + public resident routes
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name roomreport.co;

    ssl_certificate /etc/letsencrypt/live/roomreport.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/roomreport.co/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 10M;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    root /var/www/roomreport-marketing;
    index index.html;

    # Public resident inspection routes — served by the React SPA on the app server
    # so they share the same assets and API surface.
    location ~ ^/(movein|selfcheck|report|flyer|join)/ {
        root /var/www/roomreport/client/dist;
        try_files /index.html =404;
    }

    # Public API endpoints — proxy to the Express app (runs on :3000)
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Shared SPA assets for the public resident routes
    location /assets/ {
        root /var/www/roomreport/client/dist;
        try_files $uri =404;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Marketing site (static) — falls through to index.html for any other path
    location / {
        try_files $uri $uri/ /index.html;
    }
}
ROOMREPORT_NGINX_EOF

echo "==> Enabling site"
ln -sf "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"

echo "==> Testing Nginx config"
nginx -t

echo "==> Reloading Nginx"
systemctl reload nginx

echo
echo "==> Marketing site deployed."
echo "    Files: ${MARKETING_DIR}"
echo "    Nginx: ${NGINX_AVAILABLE}"
echo "    Visit: https://roomreport.co"
