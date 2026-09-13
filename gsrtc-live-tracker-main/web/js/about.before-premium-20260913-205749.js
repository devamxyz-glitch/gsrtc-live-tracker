import { icon } from './icons.js';

let rendered = false;

export function init() {
  render();
}

export function onShow() {
  render();
}

export function onHide() {}

function render() {
  const root = document.querySelector('#about-body');
  if (!root || rendered) return;

  rendered = true;

  root.innerHTML = `
    <div class="lux-about">

      <!-- HERO -->
      <section class="lux-about-hero">
        <div class="lux-hero-glow"></div>

        <div class="lux-eyebrow">
          <span class="lux-eyebrow-dot"></span>
          ST TRACKER
        </div>

        <h2>
          Better journeys.
          <span>Better understood.</span>
        </h2>

        <p class="lux-hero-copy">
          A premium live-tracking experience for Gujarat ST passengers.
          Follow your bus, understand its movement and make better travel
          decisions without the usual clutter.
        </p>

        <div class="lux-hero-meta">
          <span>GUJARAT</span>
          <i></i>
          <span>LIVE TRANSIT</span>
          <i></i>
          <span>DEVAM NAMERA</span>
        </div>

        <div class="lux-hero-orb">
          <div class="lux-orb-ring lux-ring-1"></div>
          <div class="lux-orb-ring lux-ring-2"></div>
          <div class="lux-orb-ring lux-ring-3"></div>
          <div class="lux-orb-core">
            ${icon('bus', 'i')}
          </div>
        </div>
      </section>

      <!-- PRODUCT -->
      <section class="lux-section">
        <div class="lux-section-head">
          <div>
            <span class="lux-label">THE PRODUCT</span>
            <h3>Built around the journey.</h3>
          </div>
          <span class="lux-index">01</span>
        </div>

        <p class="lux-section-copy">
          ST Tracker turns live Gujarat ST information into something
          passengers can actually understand. The focus is simple:
          speed, clarity and useful information at the right moment.
        </p>

        <div class="lux-feature-grid">

          <article class="lux-feature">
            <div class="lux-feature-top">
              <span class="lux-feature-icon">
                ${icon('map-pin', 'i')}
              </span>
              <span>01</span>
            </div>
            <h4>Live movement</h4>
            <p>
              See the latest available position of your bus and follow
              its movement across Gujarat.
            </p>
          </article>

          <article class="lux-feature">
            <div class="lux-feature-top">
              <span class="lux-feature-icon">
                ${icon('route', 'i')}
              </span>
              <span>02</span>
            </div>
            <h4>Routes & stations</h4>
            <p>
              Understand stops, routes and nearby stations without
              digging through unnecessary screens.
            </p>
          </article>

          <article class="lux-feature">
            <div class="lux-feature-top">
              <span class="lux-feature-icon">
                ${icon('navigation', 'i')}
              </span>
              <span>03</span>
            </div>
            <h4>Made for the road</h4>
            <p>
              Designed mobile-first for the moment when you are actually
              standing at a bus stop waiting.
            </p>
          </article>

        </div>
      </section>

      <!-- FOUNDER -->
      <section class="lux-founder">

        <div class="lux-founder-noise"></div>

        <div class="lux-section-head lux-founder-head">
          <div>
            <span class="lux-label">THE FOUNDER</span>
            <h3>Built by Devam.</h3>
          </div>
          <span class="lux-index">02</span>
        </div>

        <div class="lux-founder-main">

          <div class="lux-founder-avatar">
            <span>DN</span>
            <div class="lux-avatar-ring"></div>
          </div>

          <div class="lux-founder-name">
            <h4>Devam Namera</h4>
            <span>Founder &amp; Lead Developer</span>
          </div>

        </div>

        <div class="lux-founder-line"></div>

        <p class="lux-founder-copy">
          I build digital products with a focus on clean interfaces,
          useful technology and the details that make software feel
          considered rather than simply functional.
        </p>

        <p class="lux-founder-copy muted">
          My work spans mobile applications, websites, dashboards,
          backend systems and custom digital products. The goal is
          always the same: build something people can understand,
          trust and enjoy using.
        </p>

        <div class="lux-contact-grid">

          <a class="lux-contact" href="tel:+918780692285">
            <span class="lux-contact-icon">
              ${icon('phone', 'i')}
            </span>
            <span>
              <small>PHONE</small>
              <strong>8780692285</strong>
            </span>
            <span class="lux-contact-arrow">↗</span>
          </a>

          <a class="lux-contact" href="mailto:devamxyz@gmail.com">
            <span class="lux-contact-icon">
              ${icon('mail', 'i')}
            </span>
            <span>
              <small>EMAIL</small>
              <strong>devamxyz@gmail.com</strong>
            </span>
            <span class="lux-contact-arrow">↗</span>
          </a>

        </div>
      </section>

      <!-- SERVICE -->
      <section class="lux-section">

        <div class="lux-section-head">
          <div>
            <span class="lux-label">SERVICE STATUS</span>
            <h3>Always being improved.</h3>
          </div>

          <span class="lux-live-pill">
            <i></i>
            ACTIVE
          </span>
        </div>

        <div class="lux-status-card">
          <div class="lux-status-icon">
            <span></span>
          </div>

          <div>
            <strong>ST Tracker is actively evolving.</strong>
            <p>
              Some live information depends on external GSRTC systems.
              Tracking, routes, ETA and reliability are continuously
              improved as better information becomes available.
            </p>
          </div>
        </div>

        <div class="lux-report">
          <div>
            <span class="lux-label">FOUND SOMETHING?</span>
            <strong>Help make the next journey better.</strong>
            <p>
              Missing bus, incorrect route or something that does not
              look right? Send a report and help improve the experience.
            </p>
          </div>

          <a
            class="lux-gold-button"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            ${icon('message', 'i i-sm')}
            WhatsApp
          </a>
        </div>

      </section>

      <!-- BUILD WITH DEVAM -->
      <section class="lux-build">

        <div class="lux-build-number">03</div>

        <span class="lux-label">BUILD WITH DEVAM</span>

        <h3>
          Have an idea?
          <span>Let's build it properly.</span>
        </h3>

        <p>
          Mobile apps, websites, dashboards, tracking systems,
          custom software and complete digital products.
          From idea to launch, every part can be built as one
          polished experience.
        </p>

        <div class="lux-build-actions">
          <a
            class="lux-gold-button"
            href="mailto:devamxyz@gmail.com?subject=Project%20Enquiry%20for%20Devam%20Namera"
          >
            Email for a project
            <span>↗</span>
          </a>

          <a
            class="lux-outline-button"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            WhatsApp
          </a>
        </div>

        <div class="lux-services">
          <span>Mobile Apps</span>
          <i></i>
          <span>Websites</span>
          <i></i>
          <span>Dashboards</span>
          <i></i>
          <span>Custom Software</span>
          <i></i>
          <span>International Projects</span>
        </div>

      </section>

      <!-- FOOTER BRAND -->
      <footer class="lux-footer">

        <div class="lux-footer-mark">DN</div>

        <div>
          <strong>Devam Namera</strong>
          <span>Founder &amp; Lead Developer</span>
        </div>

        <small>
          ST Tracker · Designed &amp; engineered with care.
        </small>

      </footer>

    </div>
  `;
}
