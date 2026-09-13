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
    <div class="st-about-premium">

      <!-- HERO -->

      <section class="st-about-hero">

        <div class="st-about-grid"></div>

        <div class="st-about-orbit orbit-one"></div>
        <div class="st-about-orbit orbit-two"></div>

        <div class="st-about-kicker">
          <span class="st-about-pulse"></span>
          GUJARAT ST • LIVE INTELLIGENCE
        </div>

        <h2>
          Track the road.<br>
          <span>Own the journey.</span>
        </h2>

        <p class="st-about-lead">
          ST Tracker is a modern Gujarat ST bus tracking experience built to
          make live bus movement, routes and nearby stations easier to understand.
          The idea is simple: useful information, a clean interface and a
          dependable experience whenever you need to know where your bus is.
        </p>

        <div class="st-slogan">
          <span>CRAFTED FOR THE ROAD</span>
          <strong>“Know your bus. Know your route. Know your journey.”</strong>
        </div>

        <div class="st-hero-stats">
          <div>
            <strong>LIVE</strong>
            <span>Bus tracking</span>
          </div>

          <div>
            <strong>ROUTE</strong>
            <span>Journey intelligence</span>
          </div>

          <div>
            <strong>NEARBY</strong>
            <span>Station discovery</span>
          </div>
        </div>

      </section>


      <!-- PRODUCT -->

      <section class="st-about-card st-product-card">

        <div class="st-card-head">
          <div>
            <span class="st-eyebrow">THE PRODUCT</span>
            <h3>About ST Tracker</h3>
          </div>

          <div class="st-card-number">01</div>
        </div>

        <p>
          ST Tracker helps passengers track Gujarat ST buses using vehicle
          numbers, follow live bus movement, explore routes and discover
          nearby bus stations. The experience is designed around fast
          decisions, clear information and a mobile-first interface.
        </p>

        <p>
          Instead of forcing passengers to understand complicated transport
          data, ST Tracker turns available information into a simple visual
          experience. The goal is to answer the question that actually matters:
          <strong>“Where is my bus right now?”</strong>
        </p>

        <div class="st-feature-grid">

          <article class="st-feature">
            <span class="st-feature-icon">${icon('map-pin', 'i')}</span>
            <div>
              <strong>Live bus tracking</strong>
              <span>Follow the latest available position of your bus.</span>
            </div>
          </article>

          <article class="st-feature">
            <span class="st-feature-icon">${icon('route', 'i')}</span>
            <div>
              <strong>Routes & stations</strong>
              <span>Understand routes, stops and useful nearby stations.</span>
            </div>
          </article>

          <article class="st-feature">
            <span class="st-feature-icon">${icon('navigation', 'i')}</span>
            <div>
              <strong>Bus direction</strong>
              <span>See the direction in which a tracked bus is moving.</span>
            </div>
          </article>

          <article class="st-feature">
            <span class="st-feature-icon">${icon('clock', 'i')}</span>
            <div>
              <strong>Freshness awareness</strong>
              <span>Understand whether location information is recent.</span>
            </div>
          </article>

          <article class="st-feature">
            <span class="st-feature-icon">${icon('search', 'i')}</span>
            <div>
              <strong>Smart search</strong>
              <span>Find buses, routes and stations without unnecessary steps.</span>
            </div>
          </article>

          <article class="st-feature">
            <span class="st-feature-icon">${icon('navigation', 'i')}</span>
            <div>
              <strong>Nearby discovery</strong>
              <span>Find useful bus stations around your current area.</span>
            </div>
          </article>

        </div>
      </section>


      <!-- JOURNEY PHILOSOPHY -->

      <section class="st-about-card st-journey-card">

        <div class="st-card-head">
          <div>
            <span class="st-eyebrow">THE EXPERIENCE</span>
            <h3>More than a moving dot.</h3>
          </div>

          <div class="st-card-number">02</div>
        </div>

        <p>
          A bus tracker should not simply place a marker on a map and call
          the job finished. ST Tracker is designed to provide context around
          that movement: direction, route, nearby stops, freshness and the
          information passengers need to make a decision.
        </p>

        <p>
          The long-term vision is to make the experience feel less like a
          transport database and more like a personal journey companion.
        </p>

        <div class="st-journey-line">

          <div class="st-journey-step">
            <span>01</span>
            <strong>Find</strong>
            <small>your bus</small>
          </div>

          <div class="st-journey-connector"></div>

          <div class="st-journey-step">
            <span>02</span>
            <strong>Follow</strong>
            <small>its movement</small>
          </div>

          <div class="st-journey-connector"></div>

          <div class="st-journey-step">
            <span>03</span>
            <strong>Understand</strong>
            <small>your route</small>
          </div>

          <div class="st-journey-connector"></div>

          <div class="st-journey-step">
            <span>04</span>
            <strong>Arrive</strong>
            <small>with confidence</small>
          </div>

        </div>

      </section>


      <!-- FOUNDER -->

      <section class="st-about-card st-founder-card">

        <div class="st-card-head">
          <div>
            <span class="st-eyebrow">THE FOUNDER</span>
            <h3>Devam Namera</h3>
          </div>

          <div class="st-founder-badge">DN</div>
        </div>

        <div class="st-founder-role">
          Founder & Lead Developer
        </div>

        <p>
          I build digital products with a focus on clean interfaces, useful
          technology and the details that make software feel premium.
          ST Tracker is built around a real everyday problem: helping
          passengers understand where their bus is and what is happening
          on their journey.
        </p>

        <p>
          My work includes mobile applications, websites, dashboards,
          backend systems and custom digital products. The goal is not
          simply to ship software, but to build experiences that people
          can understand, trust and enjoy using.
        </p>

        <p>
          ST Tracker is continuously evolving. Tracking quality, route
          intelligence, ETA, reliability and passenger experience are all
          areas being improved as the platform grows.
        </p>

        <div class="st-contact-grid">

          <a class="st-contact" href="tel:+918780692285">
            <span class="st-contact-icon">${icon('phone', 'i')}</span>
            <span>
              <small>Direct support</small>
              <strong>8780692285</strong>
            </span>
          </a>

          <a class="st-contact" href="mailto:devamxyz@gmail.com">
            <span class="st-contact-icon">${icon('mail', 'i')}</span>
            <span>
              <small>Email</small>
              <strong>devamxyz@gmail.com</strong>
            </span>
          </a>

        </div>

      </section>


      <!-- STATUS -->

      <section class="st-about-card st-status-card">

        <div class="st-status-top">
          <span class="st-status-live"></span>
          SERVICE STATUS
        </div>

        <h3>Still improving ST Tracker.</h3>

        <p>
          Some live information depends on the data currently available from
          external GSRTC systems. We continuously monitor the service and
          improve tracking, routes, ETA and reliability as new information
          becomes available.
        </p>

        <p>
          If something looks incorrect, a bus is missing, a route is not
          loading, or you have any question or suggestion, please contact
          us directly on WhatsApp. Every useful report helps us improve the
          experience for other passengers too.
        </p>

        <div class="st-action-row">

          <a
            class="st-gold-button"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            ${icon('message', 'i i-sm')}
            WhatsApp support
          </a>

          <a
            class="st-dark-button"
            href="mailto:devamxyz@gmail.com?subject=ST%20Tracker%20Feedback"
          >
            Send feedback
          </a>

        </div>

      </section>


      <!-- BUILD WITH DEVAM -->

      <section class="st-build-card">

        <div class="st-build-glow"></div>

        <span class="st-eyebrow">BUILD WITH DEVAM</span>

        <h3>
          Have an app,<br>
          website or product idea?
        </h3>

        <p>
          I work with individuals, businesses, startups and international
          clients to turn ideas into polished digital products. From planning
          and interface design to development, backend systems and launch,
          the project can be handled as a complete product rather than just
          a collection of screens.
        </p>

        <p>
          Projects can include mobile apps, websites, business dashboards,
          tracking systems, custom software and other digital experiences.
          Every project is different, so the final price is based on the
          required features, platform, complexity and timeline.
        </p>

        <div class="st-build-list">
          <span>Mobile Apps</span>
          <span>Websites</span>
          <span>Dashboards</span>
          <span>Tracking Systems</span>
          <span>Custom Software</span>
          <span>International Projects</span>
        </div>

        <div class="st-action-row">

          <a
            class="st-gold-button"
            href="mailto:devamxyz@gmail.com?subject=Project%20Enquiry%20for%20Devam%20Namera"
          >
            Start a project
          </a>

          <a
            class="st-dark-button"
            href="https://wa.me/918780692285"
            target="_blank"
            rel="noopener"
          >
            WhatsApp
          </a>

        </div>

      </section>


      <!-- FINAL BRAND -->

      <footer class="st-about-footer">

        <div class="st-footer-mark">ST</div>

        <strong>ST TRACKER</strong>

        <span>
          Crafted for Gujarat. Engineered for the journey.
        </span>

        <small>
          Designed & engineered by Devam Namera
        </small>

        <small>
          Founder & Lead Developer
        </small>

      </footer>

    </div>
  `;
}
