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

      <section class="lux-about-hero">
        <div class="lux-hero-glow"></div>

        <div class="lux-overline">
          <span class="lux-dot"></span>
          ST TRACKER
        </div>

        <h2>
          Gujarat's roads.<br>
          <span>One smarter view.</span>
        </h2>

        <p>
          A modern live-bus tracking experience built to make Gujarat ST
          journeys easier to understand, faster to follow and better to plan.
        </p>

        <div class="lux-hero-meta">
          <span>${icon('navigation', 'i i-sm')} Live tracking</span>
          <span>${icon('route', 'i i-sm')} Route intelligence</span>
          <span>${icon('map-pin', 'i i-sm')} Nearby stations</span>
        </div>
      </section>

      <section class="lux-feature-grid">

        <article class="lux-feature">
          <div class="lux-feature-icon">${icon('map-pin', 'i')}</div>
          <div>
            <small>01</small>
            <h3>Live Bus Tracking</h3>
            <p>Follow the latest available position of a Gujarat ST bus.</p>
          </div>
        </article>

        <article class="lux-feature">
          <div class="lux-feature-icon">${icon('route', 'i')}</div>
          <div>
            <small>02</small>
            <h3>Routes & Stations</h3>
            <p>Understand routes, stops and the journey around you.</p>
          </div>
        </article>

        <article class="lux-feature">
          <div class="lux-feature-icon">${icon('navigation', 'i')}</div>
          <div>
            <small>03</small>
            <h3>Road Intelligence</h3>
            <p>Direction, movement and location context without the clutter.</p>
          </div>
        </article>

      </section>

      <section class="lux-founder">

        <div class="lux-founder-top">
          <div class="lux-monogram">DN</div>

          <div>
            <span class="lux-section-label">FOUNDER & LEAD DEVELOPER</span>
            <h3>Devam Namera</h3>
          </div>
        </div>

        <div class="lux-founder-line"></div>

        <p>
          ST Tracker is built around a simple everyday problem:
          understanding where your bus is and what is happening on your journey.
        </p>

        <p>
          The product is continuously being improved across tracking,
          route intelligence, ETA, reliability and the overall passenger experience.
        </p>

        <div class="lux-contact-row">

          <a href="mailto:devamxyz@gmail.com" class="lux-contact">
            ${icon('mail', 'i')}
            <span>
              <small>Email</small>
              <strong>devamxyz@gmail.com</strong>
            </span>
          </a>

          <a href="tel:+918780692285" class="lux-contact">
            ${icon('phone', 'i')}
            <span>
              <small>Support</small>
              <strong>8780692285</strong>
            </span>
          </a>

        </div>
      </section>

      <section class="lux-status">

        <div class="lux-status-head">
          <span class="lux-live-dot"></span>
          <span>PRODUCT STATUS</span>
        </div>

        <h3>Still improving. Built to keep getting better.</h3>

        <p>
          Some live information depends on data currently available from
          external GSRTC systems. Tracking, routes, ETA and reliability
          are continuously monitored and improved.
        </p>

        <div class="lux-status-actions">
          <a
            class="lux-primary-btn"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            ${icon('message', 'i i-sm')}
            Report an issue
          </a>

          <a
            class="lux-secondary-btn"
            href="mailto:devamxyz@gmail.com?subject=ST%20Tracker%20Feedback"
          >
            Send feedback
          </a>
        </div>
      </section>

      <section class="lux-build">

        <span class="lux-section-label">BUILD WITH DEVAM</span>

        <h3>
          Have an app, website<br>
          or product idea?
        </h3>

        <p>
          Mobile apps, websites, dashboards, tracking systems and custom
          digital products, designed and engineered as complete experiences.
        </p>

        <div class="lux-build-actions">
          <a
            class="lux-primary-btn"
            href="mailto:devamxyz@gmail.com?subject=Project%20Enquiry%20for%20Devam%20Namera"
          >
            Start a project
          </a>

          <a
            class="lux-secondary-btn"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            WhatsApp
          </a>
        </div>

      </section>

      <footer class="lux-footer">
        <strong>Devam Namera</strong>
        <span>Founder & Lead Developer</span>
        <small>Designed & engineered with purpose.</small>
      </footer>

    </div>
  `;
}
