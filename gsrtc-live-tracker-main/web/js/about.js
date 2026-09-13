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
    <div class="about-hero">
      <div class="about-kicker">ST TRACKER</div>
      <h2>Built for better journeys across Gujarat.</h2>
      <p class="about-lead">
        ST Tracker is a modern Gujarat ST bus tracking experience built to make live bus
        movement, routes and nearby stations easier to understand. The idea is simple:
        useful information, a clean interface and a dependable experience whenever you need
        to know where your bus is.
      </p>
    </div>

    <section class="about-card">
      <div class="about-eyebrow">THE PRODUCT</div>
      <h3>About ST Tracker</h3>
      <p>
        ST Tracker helps passengers track Gujarat ST buses using vehicle numbers, follow
        live bus movement, explore routes and discover nearby bus stations. The experience
        is designed around fast decisions, clear information and a mobile-first interface.
      </p>

      <div class="about-points">
        <div class="about-point">
          <span class="about-icon">${icon('map-pin', 'i')}</span>
          <div>
            <strong>Live bus tracking</strong>
            <span>Follow the latest available position of your bus.</span>
          </div>
        </div>

        <div class="about-point">
          <span class="about-icon">${icon('route', 'i')}</span>
          <div>
            <strong>Routes & stations</strong>
            <span>Understand routes, stops and useful nearby stations.</span>
          </div>
        </div>

        <div class="about-point">
          <span class="about-icon">${icon('navigation', 'i')}</span>
          <div>
            <strong>Made for the road</strong>
            <span>Fast, focused and comfortable to use on a phone.</span>
          </div>
        </div>
      </div>
    </section>

    <section class="about-card about-founder-card">
      <div class="about-eyebrow">THE FOUNDER</div>

      <div class="founder-head">
        <div class="founder-monogram">DN</div>
        <div>
          <h3>Devam Namera</h3>
          <div class="founder-role">Founder &amp; Lead Developer</div>
        </div>
      </div>

      <p>
        I build digital products with a focus on clean interfaces, useful technology and
        the details that make software feel premium. ST Tracker is built around a real
        everyday problem: helping passengers understand where their bus is and what is
        happening on their journey.
      </p>

      <p>
        My work includes mobile applications, websites, dashboards, backend systems and
        custom digital products. The goal is not simply to ship software, but to build
        experiences that people can understand, trust and enjoy using.
      </p>

      <div class="about-contact-grid">
        <a class="about-contact" href="tel:+918780692285">
          <span class="about-contact-icon">${icon('phone', 'i')}</span>
          <span>
            <small>Phone</small>
            <strong>8780692285</strong>
          </span>
        </a>

        <a class="about-contact" href="mailto:devamxyz@gmail.com">
          <span class="about-contact-icon">${icon('mail', 'i')}</span>
          <span>
            <small>Email</small>
            <strong>devamxyz@gmail.com</strong>
          </span>
        </a>
      </div>
    </section>

    <section class="about-card">
      <div class="about-eyebrow">SERVICE STATUS</div>
      <h3>We are still improving ST Tracker.</h3>
      <p>
        Some live information depends on the data currently available from external GSRTC
        systems. We continuously monitor the service and improve tracking, routes, ETA and
        reliability as new information becomes available.
      </p>
      <p>
        If something looks incorrect, a bus is missing, a route is not loading, or you have
        any question or suggestion, please contact us directly on WhatsApp. Every useful
        report helps us improve the experience for other passengers too.
      </p>
      <div class="about-cta-actions">
        <a class="btn"
           href="https://wa.me/918780692285"
           target="_blank"
           rel="noopener">
          ${icon('message', 'i i-sm')} WhatsApp support
        </a>
      </div>
    </section>
    <section class="about-card about-cta-card">
      <div class="about-eyebrow">BUILD WITH DEVAM</div>

      <h3>Have an app or website idea?</h3>

      <p>
        I work with individuals, businesses, startups and international clients to turn
        ideas into polished digital products. From planning and interface design to
        development, backend systems and launch, the project can be handled as a complete
        product rather than just a collection of screens.
      </p>

      <p>
        Projects can include mobile apps, websites, business dashboards, tracking systems,
        custom software and other digital experiences. Every project is different, so the
        final price is based on the required features, platform, complexity and timeline.
      </p>

      <div class="about-cta-actions">
        <a class="btn"
           href="mailto:devamxyz@gmail.com?subject=Project%20Enquiry%20for%20Devam%20Namera">
          Email for a project
        </a>

        <a class="btn ghost"
           href="https://wa.me/918780692285"
           target="_blank"
           rel="noopener">
          WhatsApp
        </a>
      </div>

      <div class="about-quote">
        <span>Available for</span>
        <strong>
          Mobile Apps Â· Websites Â· Dashboards Â· Custom Software Â· International Projects
        </strong>
      </div>
    </section>

    <div class="about-footer-brand">
      <strong>Devam Namera</strong>
      <span>Founder &amp; Lead Developer</span>
      <small>Designed, engineered and maintained with care.</small>
    </div>
  `;
}
