import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function PrivacyPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Privacy Policy"
      description="How The Food Advisor uses information when you browse restaurants, use an account, or manage a listing."
    >
      <article className="terms-content">
        <p><strong>Last updated: 28 September 2026</strong></p>
        <p>
          Stuart Cornelius operates this restaurant discovery website and its
          owner tools under the trading name The Food Advisor (“we”). We are the
          contact for questions about how this service handles personal information:
          email{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
          This notice describes information handled when you use our services.
          It does not replace the privacy notices of restaurants or other
          websites you choose to visit.
        </p>

        <h2>Information we collect and where it comes from</h2>
        <ul>
          <li>
            <strong>Diners:</strong> If you make a booking request, we receive your
            name, email, chosen restaurant, date, time and party size. If you sign
            in, your account identifier can be associated with reviews and rewards
            activity. Reviews include the rating and text you submit, which may
            be displayed publicly. Booking requests can be made without an account.
          </li>
          <li>
            <strong>Browsing and preferences:</strong> We process search filters,
            restaurant interactions and basic usage events to operate and measure
            the directory. Your browser may save recently viewed restaurants on
            your device. Where a visitor profile is used for recommendations, we
            associate a pseudonymous identifier with structured preferences such
            as city, cuisine and price range, recent searches and restaurant clicks.
            Aggregate reporting does not require your raw search text.
          </li>
          <li>
            <strong>Location:</strong> If you choose a nearby feature and grant
            device permission, your device location is used to sort nearby
            restaurants. You can deny or withdraw location access in your device
            or browser settings.
          </li>
          <li>
            <strong>Restaurant teams:</strong> We handle listing details, submitted
            descriptions and photos, claim and business contact details, messages
            about claims or outreach, and activity in the owner portal. For paid
            features, we keep subscription and transaction references. Stripe
            handles payment-card processing; we do not ask for card numbers on
            this website.
          </li>
          <li>
            <strong>Connected social accounts:</strong> When an authorised admin
            connects a Facebook Page, Instagram account or TikTok account, we
            store its account identifier, display name and encrypted publishing
            credentials. We also keep post content, status and platform post IDs
            for publishing and troubleshooting. Disconnecting deletes the locally
            stored credential, but does not itself revoke access at that platform
            or erase historical post records.
          </li>
          <li>
            <strong>Technical information:</strong> Our systems and service
            providers process session identifiers, basic device and request
            information, and operational logs needed to run and protect the site.
          </li>
        </ul>

        <h2>Why we use it and our legal bases</h2>
        <ul>
          <li><strong>Providing a requested service or taking steps you ask for:</strong> We use booking details, account identifiers, reviews, rewards, owner claims, subscriptions and connected social accounts to provide the relevant feature or respond to your request. This is generally necessary for a contract or steps before one.</li>
          <li><strong>Operating and protecting the directory:</strong> We use technical logs, basic usage measurements, fraud-prevention information and business contact details to keep the service secure, maintain listings, assess how features work and respond to relevant business enquiries. We rely on legitimate interests in running a useful and secure directory, balanced against your rights. You can object to this use by contacting us.</li>
          <li><strong>Optional features:</strong> Where we ask for consent to use a visitor profile for personalisation, or your device asks permission to use location, you can decline or withdraw that choice without losing general access to the directory.</li>
          <li><strong>Legal requirements:</strong> We retain information needed to meet applicable financial, tax and other legal obligations.</li>
        </ul>

        <h2>Who receives information</h2>
        <p>
          Depending on the feature, information is handled by our hosting, database
          and storage providers; Clerk for account sign-in; Stripe for payments;
          Google services for maps, restaurant data or authorised email features;
          OpenAI for selected AI search or content tools; and email, outreach or
          contact-enrichment providers such as Instantly and BetterContact for
          business communications. Facebook, Instagram or TikTok receive content
          when an admin authorises a connection and publishes to that platform.
          We may share the details of a booking request with the restaurant
          concerned. Submitted reviews and approved listing information may be
          public; private owner contact details are not directory listings.
        </p>

        <h2>Cookies, storage and transfers</h2>
        <p>
          Sign-in and admin sessions use cookies or similar browser storage to
          keep access working; recently viewed restaurants can be stored in your
          browser. You can clear browser storage through your browser settings,
          though doing so may sign you out. Social publishing credentials are
          encrypted in our systems. Some service providers may process information
          outside your country. You can contact us for details about a particular
          provider and any applicable international-transfer safeguards.
        </p>

        <h2>How long we keep information</h2>
        <p>
          We do not apply a single fixed deletion date to every record. Account,
          booking, review, rewards, claim and business-contact records may be kept
          while needed to provide the service, handle an active relationship or
          request, resolve a dispute, or meet a legal obligation. They are not all
          automatically deleted when you stop using the site. Payment and
          transaction references may need to be retained for financial record-keeping.
          Disconnecting a social account removes its locally stored publishing
          credential; related post history may remain until reviewed for deletion.
          Our operational event logs are cleaned up after seven days. You can ask
          us to review and delete information we no longer need to keep.
        </p>

        <h2>Your choices and rights</h2>
        <p>
          You can clear locally saved browsing history, change device location
          permissions and disconnect a connected social account in the admin area.
          Depending on applicable law and the circumstances, you can ask to access,
          correct, erase or receive your information, restrict or object to its
          processing, and withdraw consent where consent applies. These requests
          are handled by email rather than an automatic account-deletion button.
          Send requests to{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
          {" "}For instructions on deleting information connected to this service,
          see our <a data-testid="link-user-data-deletion" href="/data-deletion.html">User data deletion page</a>.
          You may also complain to your data protection authority; in the UK,
          that is the <a href="https://ico.org.uk/make-a-complaint/">Information Commissioner's Office</a>.
        </p>

        <h2>Changes and contact</h2>
        <p>
          We will update this page when our practices change. For general site
          information, see the <Link to="/contact">Contact page</Link> and our{" "}
          <Link to="/terms">Terms of Service</Link>. For privacy enquiries, email{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
        </p>
        <p>This notice explains how this service handles information; it is not legal advice to visitors.</p>
      </article>
    </PublicPage>
  );
}