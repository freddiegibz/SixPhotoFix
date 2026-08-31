const Stripe = require('stripe');
const { Resend } = require('resend');

const PRODUCTS = {
  price_1U28fdB4uyQdSSUIZPo8Z9Fh: {
    key: 'six-photo-fix',
    name: 'The Six-Photo Fix',
    accessUrl: process.env.SIX_PHOTO_FIX_ACCESS_URL,
  },
  price_1U30lpB4uyQdSSUI1iI0ew5L: {
    key: 'openers',
    name: 'The First Message Formula',
    accessUrl: process.env.OPENERS_ACCESS_URL,
  },
  price_1U4717B4uyQdSSUIlBZQ9lM4: {
    key: 'bios-prompts',
    name: '7 Complete Dating Setups',
    accessUrl: process.env.BIOS_PROMPTS_ACCESS_URL,
  },
  price_1U45p8B4uyQdSSUIerMKeBk4: {
    key: 'match-to-date-system',
    name: 'The Match to Date System',
    accessUrl: process.env.MATCH_TO_DATE_ACCESS_URL,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createEmailHtml(products) {
  const accessItems = products
    .map(
      (product) => `
        <li style="margin: 0 0 16px;">
          <strong>${product.name}</strong><br>
          <a href="${product.accessUrl}">Open your access here</a>
        </li>`,
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h1 style="margin-bottom: 16px;">You&rsquo;re in.</h1>
      <p>Thanks for your purchase. Your access is ready below.</p>
      <ul style="padding-left: 20px;">${accessItems}</ul>
      <p>If you have any trouble accessing your purchase, reply to this email.</p>
      <p>— SixPhotoFix</p>
    </div>`;
}

function createEmailText(products) {
  const accessItems = products
    .map((product) => `${product.name}: ${product.accessUrl}`)
    .join('\n\n');

  return `You're in.\n\nThanks for your purchase. Your access is ready below.\n\n${accessItems}\n\nIf you have any trouble accessing your purchase, reply to this email.\n\n— SixPhotoFix`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET ||
    !process.env.RESEND_API_KEY ||
    !process.env.RESEND_FROM_EMAIL
  ) {
    return res.status(500).json({
      error:
        'Missing required configuration. Check STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, and RESEND_FROM_EMAIL.',
    });
  }

  const signature = req.headers['stripe-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing Stripe signature.' });
  }

  let event;

  try {
    const rawBody = await readRawBody(req);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    return res.status(400).json({
      error: `Webhook signature verification failed: ${error.message}`,
    });
  }

  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  ) {
    return res.status(200).json({ received: true, ignored: true });
  }

  const session = event.data.object;

  if (session.payment_status !== 'paid') {
    return res.status(200).json({ received: true, ignored: 'Payment is not paid.' });
  }

  if (session.metadata?.fulfillment_email_id) {
    return res.status(200).json({
      received: true,
      alreadyFulfilled: true,
      emailId: session.metadata.fulfillment_email_id,
    });
  }

  const email = session.customer_details?.email || session.customer_email;

  if (!email) {
    return res.status(400).json({ error: 'No customer email was collected by Stripe.' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
    });
    const products = lineItems.data
      .map((item) => PRODUCTS[item.price?.id])
      .filter(Boolean);

    if (!products.length) {
      return res.status(200).json({
        received: true,
        ignored: 'No configured deliverables were purchased.',
      });
    }

    const productsWithoutAccess = products.filter((product) => !product.accessUrl);

    if (productsWithoutAccess.length) {
      throw new Error(
        `Missing an access-link environment value for: ${productsWithoutAccess
          .map((product) => product.name)
          .join(', ')}.`,
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
      {
        from: process.env.RESEND_FROM_EMAIL,
        to: email,
        replyTo: 'adsbyalfred@protonmail.com',
        subject: 'Your SixPhotoFix access is ready',
        html: createEmailHtml(products),
        text: createEmailText(products),
      },
      { idempotencyKey: `stripe-checkout/${session.id}` },
    );

    if (error) {
      throw new Error(error.message || 'Resend rejected the email request.');
    }

    await stripe.checkout.sessions.update(session.id, {
      metadata: {
        fulfillment_email_id: data.id,
        fulfillment_email_sent_at: new Date().toISOString(),
        fulfillment_products: products.map((product) => product.key).join(','),
      },
    });

    return res.status(200).json({
      received: true,
      delivered: true,
      emailId: data.id,
      products: products.map((product) => product.key),
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not fulfil purchase.',
    });
  }
};
