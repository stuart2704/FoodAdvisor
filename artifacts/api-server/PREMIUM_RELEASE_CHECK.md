# Premium release check

Before telling owners to upgrade on a published deployment, request
`GET https://<published-domain>/api/premium/readiness`. A `200` response
with `{"status":"ready"}` confirms that the deployment's Stripe credentials
can retrieve the selected **live, active £99 GBP monthly** price. A `503`
means **do not direct owners to checkout**; check the API's structured error
log for "Premium price readiness check failed", correct the live Stripe
configuration, and repeat the request. `/api/healthz` only checks that the
API is alive; it does not certify payments.

This check only retrieves the Stripe Price. It does not create a customer,
checkout session, subscription, or charge. Development uses the sandbox
price, while a production deployment requires live credentials and the
separately selected live price. The owner upgrade page also disables the
checkout button when the readiness check fails; the checkout API validates
the price again when called.