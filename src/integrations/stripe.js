'use strict';

const fs = require('fs');
const path = require('path');

async function applyStripe(targetDir) {
  // 1. Write services/stripe.js
  const servicesDir = path.join(targetDir, 'services');
  fs.mkdirSync(servicesDir, { recursive: true });

  const stripeServiceContent = `'use strict';

// Stripe payment service
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createPaymentIntent(amount, currency, metadata) {
  return stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
  });
} // END createPaymentIntent

async function createCustomer(email, name, metadata) {
  return stripe.customers.create({
    email,
    name,
    metadata,
  });
} // END createCustomer

async function attachPaymentMethod(customerId, paymentMethodId) {
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  return stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
} // END attachPaymentMethod

async function retrieveSubscription(subscriptionId) {
  return stripe.subscriptions.retrieve(subscriptionId);
} // END retrieveSubscription

module.exports = {
  createPaymentIntent,
  createCustomer,
  attachPaymentMethod,
  retrieveSubscription,
};
`;

  fs.writeFileSync(path.join(servicesDir, 'stripe.js'), stripeServiceContent);

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  const envAdditions = `
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=
`;
  fs.appendFileSync(envTemplatePath, envAdditions);

  // 3. Append stripe to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['stripe'] = '17.7.0';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
} // END applyStripe

module.exports = { applyStripe };
