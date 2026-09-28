import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function TermsPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Terms of Service"
      description="The terms for using The Food Advisor website and its restaurant services."
    >
      <article className="terms-content">
        <p><strong>Last updated: 27 September 2026</strong></p>
        <p>
          These terms apply when you use The Food Advisor website, restaurant directory,
          owner tools, and related services (the “Service”). By using the Service, you
          agree to these terms. If you do not agree, please do not use it.
        </p>

        <h2>1. What the Service does</h2>
        <p>
          The Food Advisor helps people discover restaurants and provides tools for
          restaurant teams to manage their listings. Restaurant details, availability,
          prices, menus, offers, and opening times may change. Check directly with the
          restaurant before making plans or purchases. We are not a party to an
          arrangement you make directly with a restaurant.
        </p>

        <h2>2. Your use of the Service</h2>
        <p>
          Use the Service lawfully and do not interfere with it or other users. Do not
          submit misleading information, impersonate anyone, attempt to access another
          person’s account, or upload content you do not have the right to use.
          Keep any account credentials or private owner links secure, and let us know
          if you suspect unauthorised access.
        </p>

        <h2>3. Restaurant listings and submitted content</h2>
        <p>
          If you claim a restaurant or submit text, images, menus, or other content,
          you confirm that you are authorised to do so and that your content does not
          infringe anyone else’s rights. You retain ownership of your content. You
          grant us permission to store, display, format, and distribute it as needed
          to operate and promote the Service and your restaurant listing. We may
          review, decline, correct, or remove content that is inaccurate, unlawful,
          or contrary to these terms.
        </p>

        <h2>4. Third-party services</h2>
        <p>
          The Service may link to restaurant websites, booking providers, payment
          services, or social platforms. Their own terms and privacy practices apply
          when you use them. We do not control third-party services.
        </p>

        <h2>5. Paid services</h2>
        <p>
          If you choose a paid restaurant feature, its price and applicable billing
          terms will be shown before you confirm payment. Any cancellation or
          refund rights required by law still apply.
        </p>

        <h2>6. Availability and responsibility</h2>
        <p>
          We work to keep the Service available and information useful, but cannot
          guarantee uninterrupted access or that every third-party listing is
          accurate. Nothing in these terms limits rights you have under applicable
          consumer law, or liability that cannot legally be limited.
        </p>

        <h2>7. Changes to the Service or these terms</h2>
        <p>
          We may update the Service and these terms. We will publish updated terms
          here with a new date. If a change materially affects you, we will provide
          additional notice where required by law. Your continued use after changes
          take effect means you accept the updated terms.
        </p>

        <h2>8. Questions</h2>
        <p>
          For questions about these terms, visit our <Link to="/contact">Contact page</Link>.
        </p>
      </article>
    </PublicPage>
  );
}