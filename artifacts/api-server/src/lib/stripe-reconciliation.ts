import { pool } from "@workspace/db";

const reconciliationSql = `
CREATE OR REPLACE FUNCTION public.reconcile_stripe_checkout(
  p_status text, p_payment_status text, p_metadata jsonb, p_customer text, p_subscription text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_place_id text := NULLIF(trim(p_metadata->>'place_id'), '');
BEGIN
  IF v_place_id IS NULL OR p_status <> 'complete' OR p_payment_status <> 'paid'
     OR NULLIF(trim(p_subscription), '') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM stripe.subscriptions s
       WHERE s.id = p_subscription AND s.status IN ('active', 'trialing')
     ) THEN RETURN; END IF;
  UPDATE public.restaurants
  SET claim_status = 'active',
      claimed_at = COALESCE(claimed_at, now()),
      stripe_customer_id = COALESCE(NULLIF(p_customer, ''), stripe_customer_id),
      stripe_subscription_id = COALESCE(NULLIF(p_subscription, ''), stripe_subscription_id),
      suppressed_at = COALESCE(suppressed_at, now()),
      suppression_reason = COALESCE(suppression_reason, 'stripe_verified_listing'),
      outreach_status = 'suppressed'
  WHERE place_id = v_place_id;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_stripe_subscription(
  p_id text, p_status text, p_metadata jsonb, p_customer text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_place_id text := NULLIF(trim(p_metadata->>'place_id'), '');
BEGIN
  IF v_place_id IS NULL THEN RETURN; END IF;
  UPDATE public.restaurants
  SET stripe_subscription_id = COALESCE(NULLIF(p_id, ''), stripe_subscription_id),
      stripe_customer_id = COALESCE(NULLIF(p_customer, ''), stripe_customer_id),
      claim_status = CASE
        WHEN p_status IN ('active', 'trialing') THEN 'active'
        WHEN p_status = 'past_due' THEN 'past_due'
        WHEN p_status IN ('canceled', 'unpaid', 'incomplete_expired') THEN 'revoked'
        ELSE claim_status
      END,
      claimed_at = CASE
        WHEN p_status IN ('active', 'trialing') THEN COALESCE(claimed_at, now())
        ELSE claimed_at
      END,
      suppressed_at = CASE
        WHEN p_status IN ('active', 'trialing') THEN COALESCE(suppressed_at, now())
        ELSE suppressed_at
      END,
      suppression_reason = CASE
        WHEN p_status IN ('active', 'trialing') THEN COALESCE(suppression_reason, 'stripe_verified_listing')
        ELSE suppression_reason
      END,
      outreach_status = CASE
        WHEN p_status IN ('active', 'trialing') THEN 'suppressed'
        ELSE outreach_status
      END
  WHERE place_id = v_place_id;
END $$;

CREATE OR REPLACE FUNCTION public.on_stripe_checkout_reconciliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.reconcile_stripe_checkout(NEW.status, NEW.payment_status, NEW.metadata, NEW.customer, NEW.subscription);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.on_stripe_subscription_reconciliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.reconcile_stripe_subscription(NEW.id, NEW.status, NEW.metadata, NEW.customer);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stripe_checkout_reconciliation ON stripe.checkout_sessions;
CREATE TRIGGER stripe_checkout_reconciliation AFTER INSERT OR UPDATE ON stripe.checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.on_stripe_checkout_reconciliation();
DROP TRIGGER IF EXISTS stripe_subscription_reconciliation ON stripe.subscriptions;
CREATE TRIGGER stripe_subscription_reconciliation AFTER INSERT OR UPDATE ON stripe.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.on_stripe_subscription_reconciliation();

REVOKE ALL ON FUNCTION public.reconcile_stripe_checkout(text,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_stripe_subscription(text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.on_stripe_checkout_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.on_stripe_subscription_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_checkout(text,text,jsonb,text,text) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_subscription(text,text,jsonb,text) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.on_stripe_checkout_reconciliation() TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.on_stripe_subscription_reconciliation() TO CURRENT_USER;
`;

export async function installStripeReconciliation(): Promise<void> {
  await pool.query(reconciliationSql);
}

export async function reconcileExistingStripeRows(): Promise<void> {
  await pool.query(`
    SELECT public.reconcile_stripe_checkout(status, payment_status, metadata, customer, subscription)
    FROM stripe.checkout_sessions
  `);
  await pool.query(`
    SELECT public.reconcile_stripe_subscription(id, status, metadata, customer)
    FROM stripe.subscriptions
  `);
}