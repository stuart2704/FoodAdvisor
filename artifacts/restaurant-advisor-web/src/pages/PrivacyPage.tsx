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
        <p><strong>Draft for review — last updated 27 September 2026</strong></p>
        <p>
          <strong>Before publication:</strong> Confirm the lawful bases and retention
          periods below, and review this notice against the services actually
          offered. This draft is not yet a final privacy notice.
        </p>
        <p>
          Stuart Cornelius operates this restaurant discovery website and its
          owner tools under the trading name The Food Advisor (“we”). For privacy
          questions or requests, email{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
          This notice describes information handled when you use our services.
          It does not replace the privacy notices of restaurants or other
          websites you choose to visit.
        </p>

        <h2>Information we handle</h2>
        <ul>
          <li>
            <strong>Diners:</strong> If you make a booking request, we receive your
            name, email, chosen restaurant, date, time and party size. If you sign
            in, we associate your account identifier with reviews, favourites and
            rewards activity. Reviews include the rating and text you submit.
          </li>
          <li>
            <strong>Browsing and preferences:</strong> We handle search filters,
            restaurant interactions and basic usage events to operate and measure
            the directory. If you opt in to personalisation, a pseudonymous visitor
            identifier can be used with structured preferences, recent searches
            and clicks to tailor recommendations. Aggregate analytics do not need
            your raw search text.
          </li>
          <li>
            <strong>Location:</strong> If you choose a nearby feature and grant
            device permission, your device location is used to show nearby
            restaurants. You can deny or withdraw location access in your device
            or browser settings.
          </li>
          <li>
            <strong>Restaurant teams:</strong> We handle listing details, submitted
            descriptions and photos, claim and business contact details, messages
            about claims or outreach, and activity in the owner portal. For paid
            features, we keep subscription and transaction references; payment
            processing is handled by Stripe.
          </li>
          <li>
            <strong>Connected social accounts:</strong> When an authorised admin
            connects a Facebook, Instagram or TikTok account, we store protected
            account identifiers and encrypted publishing credentials so approved
            restaurant posts can be sent to the selected platform. We also record
            post status and provider IDs. Disconnecting removes the locally saved
            credentials, but does not itself revoke access at that platform.
          </li>
        </ul>

        <h2>Why we use it</h2>
        <p>
          We use information to deliver requested features (including search,
          bookings, accounts, claims and subscriptions), maintain accurate
          listings, prevent abuse, measure and improve the Service, and respond
          to business enquiries. Personalisation uses consent where requested.
          Other processing may rely on performing a requested service, legitimate
          interests in operating a secure and useful directory, or legal duties
          such as financial record-keeping. The operator must confirm the
          applicable lawful basis for each activity before publication.
        </p>

        <h2>Who receives information</h2>
        <p>
          Depending on the feature you use, information may be processed by
          authentication provider Clerk; payment provider Stripe; hosting and
          storage services; Google Maps/Places for restaurant data; AI provider
          OpenAI for selected search or content tools; email/outreach providers;
          and Facebook, Instagram or TikTok when an admin connects an account and
          approves a post. A booking request may need to be shared with the
          selected restaurant. We do not publish private owner contacts as
          directory listings.
        </p>

        <h2>Cookies, security and storage</h2>
        <p>
          Sign-in and admin sessions use cookies or similar browser storage to
          keep access working. The Service also uses technical records to secure
          and maintain its systems. Sensitive social credentials are encrypted.
          Some providers may process information outside your country; the
          operator must confirm locations and any applicable transfer safeguards
          before publishing this notice.
        </p>

        <h2>Retention and your choices</h2>
        <p>
          Information is kept for the time needed to provide the requested
          feature, handle disputes and meet legal requirements. Some temporary
          generated content and unreferenced photos are cleaned up automatically;
          other records may remain until they are no longer needed. The operator
          must set and publish specific retention periods or criteria before
          relying on this notice.
        </p>
        <p>
          You can remove saved favourites, change browser or device permissions,
          and disconnect a connected social account in the admin area. Depending
          on your location, you may also have rights to access, correct, erase,
          restrict or object to processing, withdraw consent, and complain to a
          data protection authority. Send requests to{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
        </p>

        <h2>Changes and contact</h2>
        <p>
          We will update this page when our practices change. For general site
          information, see the <Link to="/contact">Contact page</Link> and our{" "}
          <Link to="/terms">Terms of Service</Link>. For privacy enquiries, email{" "}
          <a href="mailto:stuart@thefoodadvisor.co.uk">stuart@thefoodadvisor.co.uk</a>.
        </p>
      </article>
    </PublicPage>
  );
}